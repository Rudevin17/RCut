# Linked Media — Design

**Date:** 2026-10-03
**Status:** Approved (pending spec review)
**Builds on:** `2026-10-03-rcut-design.md`

## Problem

On import, the editor copies every media file into WebView2 browser storage (OPFS) so projects survive restarts. That storage lives on `C:` (`%LOCALAPPDATA%\com.rcut.app\EBWebView`) and its quota is derived by WebView2 from that drive. With 12 GB free on `C:`, importing a 19 GB recording fails with "Not enough browser storage". Even with space, every import duplicates the file.

## Goal

In the desktop app, media files that exist on disk are **linked, not copied**: the project stores the file's path and reads the original directly. No storage quota applies, imports are instant, and RCut never modifies or deletes the original.

## Non-goals

- Changing playback, timeline, renderer, export, or audio code. They keep consuming `File`.
- Migrating existing copied assets to links.
- Linking in the browser dev mode (`bun dev:web`), which keeps copying.
- Watching files for changes while a project is open.

## Verified facts (spikes, 2026-10-03, WebView2 runtime 154.0.4258.53, Tauri 2.12.1, webview2-com 0.39.1)

1. **Path → disk-backed `File`.** In Rust, `ICoreWebView2Environment14::CreateWebFileSystemFileHandle(path, COREWEBVIEW2_FILE_SYSTEM_HANDLE_PERMISSION_READ_ONLY)`. Wrap the handle in `CreateObjectCollection` and send it with `ICoreWebView2_23::PostWebMessageAsJsonWithAdditionalObjects`. The page receives a `FileSystemFileHandle` in `event.additionalObjects` on `window.chrome.webview` `"message"`.
   - `queryPermission({ mode: "read" })` returns `"granted"` with no prompt.
   - `getFile()` on an 18.87 GiB file took 0.3 ms and does not copy.
   - `slice()` reads in the middle and at the end take ms.
   - `URL.createObjectURL(file)` in a `<video>` loads metadata (3501 s, 1920×1080) and seeks.
2. **Picked or dropped `File` → path.** The page calls `window.chrome.webview.postMessageWithAdditionalObjects(message, files)`.
   - In Rust, an extra `add_WebMessageReceived` handler casts args to `ICoreWebView2WebMessageReceivedEventArgs2`, reads `AdditionalObjects()`, casts each to `ICoreWebView2File`, and calls `Path()`.
   - Verified for `<input type="file">` and for drag-and-drop from Explorer, with `dragDropEnabled: false`, so in-app HTML5 drag-and-drop is unaffected.
   - Tauri's existing IPC handler coexists; our messages use a distinct prefix.
3. Both APIs are exposed by `webview2-com-sys` 0.39.1 and reachable via Tauri's `WebviewWindow::with_webview` → `PlatformWebview::{controller, environment}` on Windows.

## Behavior

- **Import (button or drag from Explorer), desktop app.**
  - A file with a resolvable path becomes a *linked* asset: metadata stores `sourcePath`, nothing is written to OPFS, and the storage capacity check is skipped.
  - A file without a path (clipboard paste), or any file when linking is unavailable, uses the existing copy flow.
- **Open project.**
  - Linked assets are opened from `sourcePath`.
  - If a file no longer exists, the asset is listed as **Missing** in the media panel with a **Locate file** button.
  - A toast says how many media files are missing.
  - Timeline elements that use a missing asset behave as they already do for an absent asset (render nothing) until it is relinked.
- **Locate file (relink).**
  - The user picks a file. It must be the same media type (video/audio/image); otherwise an error toast is shown.
  - The asset's `sourcePath`, `size`, and `lastModified` are updated. The asset moves from missing to loaded and all its timeline elements work again, keeping the same asset id.
- **Remove asset / delete project.** Linked assets only lose their metadata. The original file is never touched.
- **Duplicate project / undo remove.** These re-save assets through `saveMediaAsset`. Linked assets stay linked (`sourcePath` preserved). Missing assets are duplicated as missing (metadata copied).

## Design

### 1. Desktop — `apps/desktop/src-tauri/src/linked_files.rs` (Windows only)

New dependencies, pinned to the versions already in `Cargo.lock`: `webview2-com = "0.39"`, `windows = "0.62"`.

All page↔host messages are JSON with a `type` field prefixed `rcut:`.

- **Resolve paths.**
  - Page → host: `postMessageWithAdditionalObjects(JSON.stringify({ type: "rcut:resolve-paths", requestId }), files)`.
  - The host `WebMessageReceived` handler ignores messages without that type. Otherwise it reads each additional object's `ICoreWebView2File::Path()`.
  - Host → page: `PostWebMessageAsJson({ type: "rcut:resolved-paths", requestId, paths: (string | null)[] })`.
- **Open linked file.**
  - Page → host: Tauri command `open_linked_file({ requestId, path })`.
  - If `path` does not exist or is not a file, host → page: `PostWebMessageAsJson({ type: "rcut:linked-file", requestId, status: "missing" })`.
  - Otherwise the host creates a read-only handle and sends `PostWebMessageAsJsonWithAdditionalObjects({ type: "rcut:linked-file", requestId, status: "ok" }, [handle])`.
  - On COM failure (e.g. an older runtime without `ICoreWebView2Environment14`), it sends `status: "error"` with a `message`.
- Registered from `main.rs` in `.setup()` and `invoke_handler`. On non-Windows targets the module compiles to nothing; macOS/Linux are non-goals.

### 2. Web bridge — `apps/web/src/services/linked-files/`

- `bridge.ts`: request/response correlation over an injected transport (`post`, `invoke`, `onMessage`). It keeps a map of pending `requestId → resolver` with a 10 s timeout. Unit-tested with a fake transport.
- `index.ts`: binds the bridge to `window.chrome.webview` and `window.__TAURI_INTERNALS__.invoke`, and exports:
  - `isLinkingAvailable(): boolean` — true only when both `__TAURI_INTERNALS__` and `chrome.webview.postMessageWithAdditionalObjects` exist.
  - `resolveFilePaths({ files }: { files: File[] }): Promise<(string | null)[]>` — returns all `null` when linking is unavailable, on timeout, or on error.
  - `openLinkedFile({ path }: { path: string }): Promise<LinkedFileResult>`, where `LinkedFileResult = { status: "ok"; file: File } | { status: "missing" } | { status: "error"; message: string }`. Timeout maps to `error`.

### 3. Storage — `apps/web/src/services/storage/`

- `MediaAssetData` gains `sourcePath?: string`. `MediaAsset` inherits it.
- `saveMediaAsset`:
  - If `mediaAsset.sourcePath` is set, it writes metadata only, including `sourcePath`, and skips the OPFS write.
  - Otherwise it behaves as today.
- `loadMediaAsset`:
  - If metadata has `sourcePath`, it calls `openLinkedFile`.
  - `ok` → returns the asset with that `File`.
  - `missing`/`error` → returns a missing marker.
  - Otherwise it behaves as today.
- `loadAllMediaAssets` returns `{ assets: MediaAsset[]; missing: MissingMediaAsset[] }`, where `MissingMediaAsset = MediaAssetData & { sourcePath: string; reason: "missing" | "error" }`. Its callers (media manager, project duplication) are updated. Project duplication also re-saves missing assets' metadata.
- `deleteMediaAsset` / `deleteProjectMedia` for linked assets remove metadata only, and never call anything that could touch the original path.
- New `updateMediaAssetLink({ projectId, id, sourcePath, size, lastModified })` for relink.

### 4. Import — `apps/web/src/media/processing.ts`

- `processMediaAssets` calls `resolveFilePaths` once for the whole batch.
- A pure function `planMediaImport({ path })` returns `{ mode: "link", sourcePath } | { mode: "copy" }` and is unit-tested.
- The `link` mode skips `canStoreFile` and sets `sourcePath` on the `ProcessedMediaAsset`. Thumbnail and metadata extraction is unchanged; it reads from the `File`, which is disk-backed.

### 5. Media manager + UI

- `MediaManager` gains `missingAssets: MissingMediaAsset[]`, `getMissingAssets()`, and `relinkMediaAsset({ projectId, id, file }): Promise<void>`.
- `relinkMediaAsset` resolves the picked file's path, checks the media type matches, calls `openLinkedFile`, persists via `updateMediaAssetLink`, moves the asset into `assets`, and notifies.
- `loadProjectMedia` fills both lists and shows a toast when `missing.length > 0`.
- Media panel (`components/editor/panels/assets/views/assets.tsx`): renders missing items after loaded ones, with a "Missing" badge, the original path as a tooltip, and a "Locate file" button. The button opens a hidden `<input type="file">` and calls `relinkMediaAsset`.

## Error handling

| Situation | Behavior |
| --- | --- |
| Path resolution times out or fails during import | File is copied (existing flow, existing quota message if too large). |
| Linked file missing on open | Asset listed as Missing; toast with count. |
| Handle creation fails (COM error) | Asset listed as Missing with reason `error`; toast. Locate retries. |
| Relink to a different media type | Error toast; nothing changes. |
| Relinked file cannot be opened | Error toast; asset stays missing. |

## Testing

- **Unit (`bun:test`):**
  - bridge request/response correlation, timeout, and ignoring unrelated messages (fake transport);
  - `planMediaImport`;
  - `MediaManager` missing/relink state transitions with a stubbed storage/linked-files layer.
- **Manual (in `rcut.exe`):**
  1. Import the 19 GB recording via the button and via drag.
  2. Edit it, close, and reopen: the project and edits are intact.
  3. Rename the file: it shows as Missing. Use Locate: the clips work again.
  4. Remove the asset: the original file still exists.
  5. Duplicate the project: the duplicate stays linked.
  6. Export an MP4 from the linked 19 GB source.
  7. Paste an image: still works (copied).

## Risks

- Requires WebView2 runtime ≥ 1.0.2420 (APIs `ICoreWebView2Environment14`, `ICoreWebView2_23`). The installed runtime is 154 (Evergreen, auto-updating). On older runtimes, handle creation reports `error`, and imports fall back to copy when path resolution fails.
- Tauri's own IPC handler also receives our page→host messages. The spike showed no interference; this is re-verified in the manual test.
