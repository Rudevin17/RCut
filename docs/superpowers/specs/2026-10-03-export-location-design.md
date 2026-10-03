# Export Location — Design

**Date:** 2026-10-03
**Status:** Approved
**Builds on:** `2026-10-03-rcut-design.md`, `2026-10-03-linked-media-design.md`

## Problem

Export currently uses a browser download (`downloadBuffer` → `<a download>`). Inside RCut, WebView2 saves the file silently to `Downloads`, so the user can't see where it went or change the destination.

## Goal

In the desktop app:

- A remembered **export folder** is shown in the export popover, with a **Change…** button. The default is the user's Downloads folder.
- **Export** renders the video and saves it to the export folder as `<project name>.<ext>`. It never overwrites an existing file: it uses `<name> (2).<ext>`, `(3)`, and so on.
- **Export as…** opens the Windows Save dialog **before** rendering. The dialog starts in the export folder with the default name. Cancelling the dialog cancels the export. The OS dialog handles overwrite confirmation.
- After saving, a toast reads "Exported to `<full path>`" and offers a **Show in folder** action, which opens Explorer with the file selected.
- In browser dev mode (no Tauri), export behaves as it does today: a browser download.

## Non-goals

- Streaming the render to disk. The export is still rendered fully in memory, as it is today; only the save step changes.
- Per-project export folders.
- Remembering the last "Export as…" location separately from the export folder.

## Design

### Desktop (Rust)

- Add the official `tauri-plugin-dialog` v2. Register it, and add `"dialog:default"` to `capabilities/default.json`.
- New module `src/export_files.rs`:
  - `unique_export_path(dir: &Path, file_name: &str) -> PathBuf`: returns `dir/file_name` if it doesn't exist, otherwise `dir/<stem> (n).<ext>` with the smallest free n ≥ 2. It is pure and has unit tests.
  - Command `save_export_to_folder(request: tauri::ipc::Request) -> Result<String, String>`:
    - Reads a raw bytes body (`InvokeBody::Raw`) plus the headers `x-rcut-folder` and `x-rcut-file-name`. Header values are percent-encoded UTF-8.
    - Writes to `unique_export_path` and returns the final path.
  - Command `save_export_as(request) -> Result<String, String>`: reads the raw body and the header `x-rcut-path`, writes exactly that path, and returns it.
  - Command `default_export_folder(app) -> Result<String, String>`: returns `app.path().download_dir()`.
  - Command `reveal_in_folder(path: String) -> Result<(), String>`: runs `explorer /select,"<path>"`.
- New dependency: `percent-encoding = "2"`, which is already in the lock file through Tauri.

### Web

- `apps/web/src/export/export-file-name.ts` (pure, tested): `getExportFileName({ projectName, extension })`.
  - Replaces the Windows-invalid characters `<>:"/\|?*` and control characters with `_`.
  - Trims trailing dots and spaces.
  - Falls back to `"Untitled"` when the name ends up empty.
  - Appends the extension, e.g. `".mp4"`.
- `apps/web/src/export/export-settings-store.ts`: a zustand `persist` store named `"rcut-export-settings"`, holding `{ exportFolder: string | null; setExportFolder }`.
- `apps/web/src/services/export-destination/index.ts`:
  - `isNativeExportAvailable()`
  - `getDefaultExportFolder()`
  - `pickExportFolder({ currentFolder })` — dialog `open({ directory: true })`
  - `pickExportFile({ folder, fileName, extension })` — dialog `save`
  - `saveExportToFolder({ buffer, folder, fileName })`
  - `saveExportAs({ buffer, path })`
  - `revealInFolder({ path })`
  - It uses `@tauri-apps/api/core` `invoke` with a raw `Uint8Array` body and headers, and dynamically imports `@tauri-apps/plugin-dialog`. The JS package versions must match the Rust crates' major.minor (`@tauri-apps/api` 2.12.x for `tauri` 2.12).
- `components/editor/export-button.tsx`:
  - A "Save to" row with the folder and **Change…**.
  - The **Export** and **Export as…** buttons.
  - The destination is resolved before rendering, and the file is saved after rendering.
  - Success and failure toasts.
  - When native export is unavailable, the browser download fallback is used.

## Error handling

| Situation | Behavior |
| --- | --- |
| Export folder no longer exists / not writable | Error toast with the OS message; the rendered video is discarded; the user can change the folder and export again. |
| Save dialog cancelled | Nothing is rendered. |
| Folder picker cancelled | Folder unchanged. |

## Testing

- **Rust unit tests:** `unique_export_path` covers a free name, a taken name → `(2)`, and `(2)` taken → `(3)`. Also a name without an extension.
- **bun:test:** `getExportFileName` covers a plain name, invalid characters, trailing dots and spaces, and an empty name.
- **Manual in `rcut.exe`:**
  1. Change the folder.
  2. Export twice → `(2)`.
  3. Export as… to a new name.
  4. Cancel Export as… and check nothing renders.
  5. Show in folder.
  6. Restart and check the folder is remembered.
