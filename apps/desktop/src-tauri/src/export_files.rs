//! Saving rendered exports to disk and revealing them in Explorer.

use std::ffi::OsStr;
use std::fs::{File, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

use percent_encoding::percent_decode_str;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager};

const EXPORT_EXTENSIONS: [&str; 2] = ["mp4", "webm"];

/// Candidate paths for an export: `dir/file_name`, then
/// `dir/<stem> (n).<ext>` for n = 2, 3, ...
fn export_path_candidates<'a>(
    dir: &'a Path,
    file_name: &'a str,
) -> impl Iterator<Item = PathBuf> + 'a {
    let name = Path::new(file_name);
    let stem = name
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or(file_name);
    let extension = name.extension().and_then(|extension| extension.to_str());

    std::iter::once(dir.join(file_name)).chain((2..).map(move |n| match extension {
        Some(extension) => dir.join(format!("{stem} ({n}).{extension}")),
        None => dir.join(format!("{stem} ({n})")),
    }))
}

/// Creates `dir/file_name`, or `dir/<stem> (n).<ext>` with the smallest free
/// n >= 2 when that file already exists. Exports never overwrite files: each
/// candidate is opened with `create_new`, so the existence check and the
/// creation are a single atomic step.
pub fn create_unique_export_file(dir: &Path, file_name: &str) -> Result<(PathBuf, File), String> {
    for path in export_path_candidates(dir, file_name) {
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => return Ok((path, file)),
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Could not save {}: {error}", path.display())),
        }
    }
    unreachable!("export path candidates never run out")
}

/// Accepts only a single, non-empty path component, so the name cannot
/// point outside the export folder.
fn validate_file_name(file_name: &str) -> Result<(), String> {
    if file_name.is_empty() || Path::new(file_name).file_name() != Some(OsStr::new(file_name)) {
        return Err(format!("Invalid export file name: {file_name:?}"));
    }
    Ok(())
}

/// Accepts only the export formats RCut produces (.mp4, .webm), in any case.
fn validate_export_extension(path: &Path) -> Result<(), String> {
    let supported = path
        .extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| {
            EXPORT_EXTENSIONS
                .iter()
                .any(|allowed| extension.eq_ignore_ascii_case(allowed))
        });
    if !supported {
        return Err(format!(
            "Exports must be saved as .mp4 or .webm: {}",
            path.display()
        ));
    }
    Ok(())
}

/// Rejects paths that would break out of the quoted explorer argument, and
/// paths that do not exist.
fn validate_reveal_path(path: &str) -> Result<(), String> {
    if path.contains('"') {
        return Err(format!("Invalid path: {path}"));
    }
    if !Path::new(path).exists() {
        return Err(format!("File not found: {path}"));
    }
    Ok(())
}

/// Saves the raw export bytes into a folder without overwriting existing files.
#[tauri::command]
pub async fn save_export_to_folder(request: Request<'_>) -> Result<String, String> {
    let folder = header(&request, "x-rcut-folder")?;
    let file_name = header(&request, "x-rcut-file-name")?;
    validate_file_name(&file_name)?;
    let bytes = raw_body(&request)?;
    let (path, mut file) = create_unique_export_file(Path::new(&folder), &file_name)?;
    file.write_all(bytes)
        .map_err(|error| format!("Could not save {}: {error}", path.display()))?;
    Ok(path.to_string_lossy().into_owned())
}

/// Saves the raw export bytes to an exact path chosen in the Save dialog.
#[tauri::command]
pub async fn save_export_as(request: Request<'_>) -> Result<String, String> {
    let path = PathBuf::from(header(&request, "x-rcut-path")?);
    validate_export_extension(&path)?;
    let bytes = raw_body(&request)?;
    std::fs::write(&path, bytes)
        .map_err(|error| format!("Could not save {}: {error}", path.display()))?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn default_export_folder(app: AppHandle) -> Result<String, String> {
    app.path()
        .download_dir()
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn reveal_in_folder(path: String) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    validate_reveal_path(&path)?;
    std::process::Command::new("explorer")
        .raw_arg(format!("/select,\"{path}\""))
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn header(request: &Request<'_>, name: &str) -> Result<String, String> {
    let value = request
        .headers()
        .get(name)
        .ok_or_else(|| format!("missing {name} header"))?
        .to_str()
        .map_err(|error| error.to_string())?;

    percent_decode_str(value)
        .decode_utf8()
        .map(|value| value.into_owned())
        .map_err(|error| error.to_string())
}

fn raw_body<'a>(request: &'a Request<'_>) -> Result<&'a [u8], String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw export bytes".into());
    };
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::{
        create_unique_export_file, validate_export_extension, validate_file_name,
        validate_reveal_path,
    };
    use std::fs;
    use std::path::{Path, PathBuf};

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("rcut-export-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn created_path(dir: &Path, file_name: &str) -> PathBuf {
        create_unique_export_file(dir, file_name).unwrap().0
    }

    #[test]
    fn uses_the_name_when_free() {
        let dir = temp_dir("free");
        assert_eq!(
            created_path(&dir, "My project.mp4"),
            dir.join("My project.mp4")
        );
    }

    #[test]
    fn appends_2_when_the_name_is_taken() {
        let dir = temp_dir("taken");
        fs::write(dir.join("My project.mp4"), b"x").unwrap();
        assert_eq!(
            created_path(&dir, "My project.mp4"),
            dir.join("My project (2).mp4")
        );
        assert_eq!(fs::read(dir.join("My project.mp4")).unwrap(), b"x");
    }

    #[test]
    fn skips_to_the_next_free_number() {
        let dir = temp_dir("next");
        fs::write(dir.join("clip.mp4"), b"x").unwrap();
        fs::write(dir.join("clip (2).mp4"), b"x").unwrap();
        assert_eq!(created_path(&dir, "clip.mp4"), dir.join("clip (3).mp4"));
    }

    #[test]
    fn handles_names_without_an_extension() {
        let dir = temp_dir("noext");
        fs::write(dir.join("clip"), b"x").unwrap();
        assert_eq!(created_path(&dir, "clip"), dir.join("clip (2)"));
    }

    #[test]
    fn creating_twice_gives_two_files() {
        let dir = temp_dir("twice");
        assert_eq!(created_path(&dir, "clip.mp4"), dir.join("clip.mp4"));
        assert_eq!(created_path(&dir, "clip.mp4"), dir.join("clip (2).mp4"));
    }

    #[test]
    fn accepts_a_plain_file_name() {
        assert!(validate_file_name("My project.mp4").is_ok());
    }

    #[test]
    fn rejects_file_names_that_are_not_one_component() {
        for name in [
            "",
            ".",
            "..",
            "../clip.mp4",
            "sub/clip.mp4",
            "sub\\clip.mp4",
            "C:\\clip.mp4",
            "C:clip.mp4",
            "clip.mp4/",
        ] {
            assert!(validate_file_name(name).is_err(), "{name:?} was accepted");
        }
    }

    #[test]
    fn accepts_mp4_and_webm_in_any_case() {
        for path in [
            "C:\\out\\a.mp4",
            "C:\\out\\a.MP4",
            "C:\\out\\a.webm",
            "C:\\out\\a.WebM",
        ] {
            assert!(validate_export_extension(Path::new(path)).is_ok(), "{path}");
        }
    }

    #[test]
    fn rejects_other_extensions() {
        for path in [
            "C:\\out\\a.exe",
            "C:\\out\\a",
            "C:\\out\\a.mp4.bat",
            "C:\\out\\mp4",
        ] {
            assert!(
                validate_export_extension(Path::new(path)).is_err(),
                "{path}"
            );
        }
    }

    #[test]
    fn rejects_reveal_paths_with_quotes_or_that_do_not_exist() {
        let dir = temp_dir("reveal");
        let file = dir.join("clip.mp4");
        fs::write(&file, b"x").unwrap();
        assert!(validate_reveal_path(file.to_str().unwrap()).is_ok());
        assert!(validate_reveal_path(dir.join("missing.mp4").to_str().unwrap()).is_err());
        assert!(validate_reveal_path("C:\\a\" /select,\"C:\\b").is_err());
    }
}
