//! Saving rendered exports to disk and revealing them in Explorer.

use std::path::{Path, PathBuf};

use percent_encoding::percent_decode_str;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager};

/// Returns `dir/file_name`, or `dir/<stem> (n).<ext>` with the smallest free
/// n >= 2 when that file already exists. Exports never overwrite files.
pub fn unique_export_path(dir: &Path, file_name: &str) -> PathBuf {
    let candidate = dir.join(file_name);
    if !candidate.exists() {
        return candidate;
    }

    let name = Path::new(file_name);
    let stem = name
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or(file_name);
    let extension = name.extension().and_then(|extension| extension.to_str());

    (2..)
        .map(|n| match extension {
            Some(extension) => dir.join(format!("{stem} ({n}).{extension}")),
            None => dir.join(format!("{stem} ({n})")),
        })
        .find(|candidate| !candidate.exists())
        .expect("an unused export file name exists")
}

/// Saves the raw export bytes into a folder without overwriting existing files.
#[tauri::command]
pub async fn save_export_to_folder(request: Request<'_>) -> Result<String, String> {
    let folder = header(&request, "x-rcut-folder")?;
    let file_name = header(&request, "x-rcut-file-name")?;
    let path = unique_export_path(Path::new(&folder), &file_name);
    write_body(&request, &path)?;
    Ok(path.to_string_lossy().into_owned())
}

/// Saves the raw export bytes to an exact path chosen in the Save dialog.
#[tauri::command]
pub async fn save_export_as(request: Request<'_>) -> Result<String, String> {
    let path = PathBuf::from(header(&request, "x-rcut-path")?);
    write_body(&request, &path)?;
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

fn write_body(request: &Request<'_>, path: &Path) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw export bytes".into());
    };

    std::fs::write(path, bytes)
        .map_err(|error| format!("Could not save {}: {error}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::unique_export_path;
    use std::fs;
    use std::path::PathBuf;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("rcut-export-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn uses_the_name_when_free() {
        let dir = temp_dir("free");
        assert_eq!(
            unique_export_path(&dir, "My project.mp4"),
            dir.join("My project.mp4")
        );
    }

    #[test]
    fn appends_2_when_the_name_is_taken() {
        let dir = temp_dir("taken");
        fs::write(dir.join("My project.mp4"), b"x").unwrap();
        assert_eq!(
            unique_export_path(&dir, "My project.mp4"),
            dir.join("My project (2).mp4")
        );
    }

    #[test]
    fn skips_to_the_next_free_number() {
        let dir = temp_dir("next");
        fs::write(dir.join("clip.mp4"), b"x").unwrap();
        fs::write(dir.join("clip (2).mp4"), b"x").unwrap();
        assert_eq!(
            unique_export_path(&dir, "clip.mp4"),
            dir.join("clip (3).mp4")
        );
    }

    #[test]
    fn handles_names_without_an_extension() {
        let dir = temp_dir("noext");
        fs::write(dir.join("clip"), b"x").unwrap();
        assert_eq!(unique_export_path(&dir, "clip"), dir.join("clip (2)"));
    }
}
