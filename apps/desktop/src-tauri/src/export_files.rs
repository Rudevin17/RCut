//! Saving rendered exports to disk and revealing them in Explorer.

use std::ffi::OsStr;
use std::fs::{File, OpenOptions};
use std::io::{ErrorKind, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use percent_encoding::percent_decode_str;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager};

const EXPORT_EXTENSIONS: [&str; 1] = ["mp4"];

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

/// Accepts only the export format RCut produces (.mp4), in any case.
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
            "Exports must be saved as .mp4: {}",
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

/// Where a streamed export ends up.
pub enum Destination {
    /// A folder plus a file name; the final name is made unique.
    Folder { dir: PathBuf, file_name: String },
    /// The exact path chosen in the Save dialog.
    Path(PathBuf),
}

/// An export being streamed into `<destination>.<id>.part`.
pub struct OpenExport {
    file: File,
    pub part_path: PathBuf,
    destination: Destination,
}

impl OpenExport {
    pub fn create(destination: Destination) -> Result<Self, String> {
        let (dir, base) = match &destination {
            Destination::Folder { dir, file_name } => {
                validate_file_name(file_name)?;
                validate_export_extension(Path::new(file_name))?;
                (dir.clone(), file_name.clone())
            }
            Destination::Path(path) => {
                validate_export_extension(path)?;
                let dir = path.parent().map(Path::to_path_buf).unwrap_or_default();
                let base = path.file_name().and_then(OsStr::to_str).unwrap_or("export.mp4").to_string();
                (dir, base)
            }
        };
        for n in 0u32.. {
            let part_path = dir.join(format!("{base}.{n}.part"));
            match OpenOptions::new().write(true).create_new(true).open(&part_path) {
                Ok(file) => return Ok(Self { file, part_path, destination }),
                Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(format!("Could not create {}: {error}", part_path.display())),
            }
        }
        unreachable!("part file candidates never run out")
    }

    pub fn write_at(&mut self, position: u64, bytes: &[u8]) -> Result<(), String> {
        self.file
            .seek(SeekFrom::Start(position))
            .and_then(|_| self.file.write_all(bytes))
            .map_err(|error| format!("Could not write {}: {error}", self.part_path.display()))
    }

    /// Flushes and moves the part file to its final name. On failure, nothing
    /// is left behind: the part file and any reserved placeholder are removed.
    pub fn finish(self) -> Result<PathBuf, String> {
        let Self { file, part_path, destination } = self;
        let discard = |error: String| {
            let _ = std::fs::remove_file(&part_path);
            error
        };
        let synced = file.sync_all();
        drop(file);
        if let Err(error) = synced {
            return Err(discard(format!("Could not save {}: {error}", part_path.display())));
        }
        let (final_path, placeholder) = match destination {
            Destination::Folder { dir, file_name } => {
                // Reserve a unique name atomically, then replace the empty placeholder.
                match create_unique_export_file(&dir, &file_name) {
                    Ok((path, placeholder)) => {
                        drop(placeholder);
                        (path.clone(), Some(path))
                    }
                    Err(error) => return Err(discard(error)),
                }
            }
            Destination::Path(path) => (path, None),
        };
        if let Err(error) = std::fs::rename(&part_path, &final_path) {
            if let Some(placeholder) = &placeholder {
                let _ = std::fs::remove_file(placeholder);
            }
            return Err(discard(format!("Could not save {}: {error}", final_path.display())));
        }
        Ok(final_path)
    }

    pub fn abort(self) {
        let Self { file, part_path, .. } = self;
        drop(file);
        let _ = std::fs::remove_file(&part_path);
    }
}

/// Exports currently being streamed, by id.
#[derive(Default)]
pub struct ExportStreams {
    next_id: std::sync::atomic::AtomicU32,
    open: std::sync::Mutex<std::collections::HashMap<u32, OpenExport>>,
}

#[tauri::command]
pub async fn export_stream_open(
    request: Request<'_>,
    streams: tauri::State<'_, ExportStreams>,
) -> Result<u32, String> {
    // Folder mode only when no path header was sent; a malformed path header reports its own error.
    let destination = if request.headers().contains_key("x-rcut-path") {
        Destination::Path(PathBuf::from(header(&request, "x-rcut-path")?))
    } else {
        Destination::Folder {
            dir: PathBuf::from(header(&request, "x-rcut-folder")?),
            file_name: header(&request, "x-rcut-file-name")?,
        }
    };
    let open = OpenExport::create(destination)?;
    let id = streams.next_id.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    streams.open.lock().map_err(|error| error.to_string())?.insert(id, open);
    Ok(id)
}

#[tauri::command]
pub async fn export_stream_write(
    request: Request<'_>,
    streams: tauri::State<'_, ExportStreams>,
) -> Result<(), String> {
    let id: u32 = header(&request, "x-rcut-stream-id")?
        .parse()
        .map_err(|_| "invalid x-rcut-stream-id".to_string())?;
    let position: u64 = header(&request, "x-rcut-position")?
        .parse()
        .map_err(|_| "invalid x-rcut-position".to_string())?;
    let bytes = raw_body(&request)?;
    let mut open = streams.open.lock().map_err(|error| error.to_string())?;
    let export = open.get_mut(&id).ok_or_else(|| format!("unknown export stream {id}"))?;
    export.write_at(position, bytes)
}

#[tauri::command]
pub async fn export_stream_finish(
    id: u32,
    streams: tauri::State<'_, ExportStreams>,
) -> Result<String, String> {
    let export = streams
        .open
        .lock()
        .map_err(|error| error.to_string())?
        .remove(&id)
        .ok_or_else(|| format!("unknown export stream {id}"))?;
    export.finish().map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn export_stream_abort(
    id: u32,
    streams: tauri::State<'_, ExportStreams>,
) -> Result<(), String> {
    let export = streams.open.lock().map_err(|error| error.to_string())?.remove(&id);
    if let Some(export) = export {
        export.abort();
    }
    Ok(())
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
        validate_reveal_path, Destination, OpenExport,
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
    fn accepts_mp4_in_any_case() {
        for path in ["C:\\out\\a.mp4", "C:\\out\\a.MP4"] {
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
            "C:\\out\\a.webm",
            "C:\\out\\a.WebM",
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

    #[test]
    fn part_file_is_created_next_to_the_destination_and_finished_with_a_unique_name() {
        let dir = temp_dir("stream-folder");
        fs::write(dir.join("clip.mp4"), b"old").unwrap();
        let destination = Destination::Folder { dir: dir.clone(), file_name: "clip.mp4".into() };
        let mut open = OpenExport::create(destination).unwrap();
        assert!(open.part_path.starts_with(&dir));
        assert!(open.part_path.to_string_lossy().ends_with(".part"));
        open.write_at(0, b"hello").unwrap();
        open.write_at(5, b" world").unwrap();
        open.write_at(0, b"J").unwrap();
        let path = open.finish().unwrap();
        assert_eq!(path, dir.join("clip (2).mp4"));
        assert_eq!(fs::read(&path).unwrap(), b"Jello world");
        assert_eq!(fs::read(dir.join("clip.mp4")).unwrap(), b"old");
        assert!(fs::read_dir(&dir).unwrap().all(|entry| !entry.unwrap().path().to_string_lossy().ends_with(".part")));
    }

    #[test]
    fn exact_path_destination_replaces_the_chosen_file() {
        let dir = temp_dir("stream-path");
        let target = dir.join("chosen.mp4");
        fs::write(&target, b"old").unwrap();
        let mut open = OpenExport::create(Destination::Path(target.clone())).unwrap();
        open.write_at(0, b"new").unwrap();
        assert_eq!(open.finish().unwrap(), target);
        assert_eq!(fs::read(&target).unwrap(), b"new");
    }

    #[test]
    fn abort_deletes_the_part_file() {
        let dir = temp_dir("stream-abort");
        let mut open = OpenExport::create(Destination::Folder { dir: dir.clone(), file_name: "clip.mp4".into() }).unwrap();
        open.write_at(0, b"partial").unwrap();
        let part = open.part_path.clone();
        open.abort();
        assert!(!part.exists());
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 0);
    }

    #[test]
    fn failed_finish_removes_the_part_file() {
        let dir = temp_dir("stream-finish-fail");
        // A directory at the chosen path makes the final rename fail.
        let target = dir.join("taken.mp4");
        fs::create_dir(&target).unwrap();
        let mut open = OpenExport::create(Destination::Path(target.clone())).unwrap();
        open.write_at(0, b"data").unwrap();
        let part = open.part_path.clone();
        assert!(open.finish().is_err());
        assert!(!part.exists());
        assert!(target.is_dir());
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
    }

    #[test]
    fn failed_folder_finish_removes_the_reserved_placeholder() {
        let dir = temp_dir("stream-finish-placeholder");
        let mut open = OpenExport::create(Destination::Folder { dir: dir.clone(), file_name: "clip.mp4".into() }).unwrap();
        open.write_at(0, b"data").unwrap();
        // Losing the part file makes the final rename fail after the name was reserved.
        fs::remove_file(&open.part_path).unwrap();
        assert!(open.finish().is_err());
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 0);
    }

    #[test]
    fn destinations_are_validated() {
        let dir = temp_dir("stream-validate");
        assert!(OpenExport::create(Destination::Folder { dir: dir.clone(), file_name: "../x.mp4".into() }).is_err());
        assert!(OpenExport::create(Destination::Path(dir.join("x.exe"))).is_err());
    }
}
