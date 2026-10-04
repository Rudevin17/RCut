# Export to Disk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Desktop exports stream straight into a `.part` file next to the destination as they render. The file is renamed when the export succeeds and deleted when it fails or is cancelled. Memory stays flat for any video length.

**Architecture:**
- **Native side:** four Tauri commands (`export_stream_open`, `export_stream_write`, `export_stream_finish`, `export_stream_abort`) work on open files held in managed state.
- **Web side:** a small `ExportSink` interface with two implementations:
  - a **disk sink** that writes a mediabunny `StreamTarget` through those commands;
  - a **buffer sink** for the browser-only Downloads path.
- **Exporter:** `SceneExporter` opens one sink target per encode attempt. It aborts the target on failure or cancel and commits it after `finalize`.
- **MP4 layout:** streamed MP4s use `fastStart: false`, which puts the index at the end. That is mediabunny's lowest-memory mode.

**Tech Stack:** Rust (Tauri v2 commands, `std::fs`), TypeScript, mediabunny 1.41 (`StreamTarget`, `BufferTarget`, `Mp4OutputFormat`), bun:test, cargo test.

**Approved design (user):**
- Stream to `<name>.part`, rename on success, delete on failure or cancel.
- A disk error mid-export is a clear error. The old "saved to Downloads instead" fallback is removed for desktop exports.

## Global Constraints

**Repo and commits**
- Work in `D:\OpenCut` on branch `main`.
- **Commit messages must NOT contain any Co-Authored-By line or Claude attribution.**

**Editing**
- Change files only with the Edit/Write tools. Use no scripts or heredocs, except `git commit -F -`.

**Style**
- TypeScript: tabs, double quotes, object-parameter functions, `bun:test` in `__tests__/`.
- Rust: rustfmt defaults; tests in the module's `#[cfg(test)]`.

**Baselines**
- `cd /d/OpenCut && bun test` → 289 pass / 4 fail (the 4 are pre-existing wasm load errors).
- tsc → `0`.
- `cd /d/OpenCut/apps/desktop/src-tauri && cargo test` → 10 pass.

**Existing behaviour to keep**
- Folder exports never overwrite: unique names `<stem> (n).mp4` via `create_unique_export_file`.
- "Export as…" writes the exact chosen path. The dialog already confirmed any overwrite.
- Only `.mp4` is accepted.
- File names must be a single path component (`validate_file_name`).
- `reveal_in_folder` is unchanged.

**IPC conventions:** the same as the existing raw-body commands.
- Binary goes in a raw `Uint8Array` body.
- Metadata goes in `x-rcut-*` headers, `encodeURIComponent`-encoded on the web side and decoded with the existing `header()` helper.

---

## Task 1: Native streaming export commands

**Files:**
- Modify: `apps/desktop/src-tauri/src/export_files.rs`
- Modify: `apps/desktop/src-tauri/src/main.rs`

**Interfaces (Task 2 relies on these exact names):**

| Command | Request | Returns |
|---|---|---|
| `export_stream_open` | headers: either `x-rcut-folder` + `x-rcut-file-name`, or `x-rcut-path`; no body | the stream id as a number |
| `export_stream_write` | headers `x-rcut-stream-id` and `x-rcut-position` (byte offset, decimal); raw body = bytes | `()` |
| `export_stream_finish` | args `{ id: number }` | final path string |
| `export_stream_abort` | args `{ id: number }` | `()`. Idempotent: an unknown id is `Ok`. |

**Remove:** `save_export_to_folder` and `save_export_as`, plus their registrations. The web side stops using them in Task 2.

- [ ] **Step 1: Failing tests.** Add these to the `tests` module:
```rust
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
    fn destinations_are_validated() {
        let dir = temp_dir("stream-validate");
        assert!(OpenExport::create(Destination::Folder { dir: dir.clone(), file_name: "../x.mp4".into() }).is_err());
        assert!(OpenExport::create(Destination::Path(dir.join("x.exe"))).is_err());
    }
```
Update the `use super::{...}` list to include `Destination` and `OpenExport`.

Run `cd /d/OpenCut/apps/desktop/src-tauri && cargo test 2>&1 | tail -3`. It must fail to compile, because the types don't exist yet.

- [ ] **Step 2: Implement.** Add the following to `export_files.rs`, after `validate_reveal_path`:
```rust
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

    /// Flushes and moves the part file to its final name.
    pub fn finish(self) -> Result<PathBuf, String> {
        let Self { file, part_path, destination } = self;
        file.sync_all()
            .map_err(|error| format!("Could not save {}: {error}", part_path.display()))?;
        drop(file);
        let final_path = match destination {
            Destination::Folder { dir, file_name } => {
                // Reserve a unique name atomically, then replace the empty placeholder.
                let (path, placeholder) = create_unique_export_file(&dir, &file_name)?;
                drop(placeholder);
                path
            }
            Destination::Path(path) => path,
        };
        std::fs::rename(&part_path, &final_path).map_err(|error| {
            let _ = std::fs::remove_file(&part_path);
            format!("Could not save {}: {error}", final_path.display())
        })?;
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
    let destination = match header(&request, "x-rcut-path") {
        Ok(path) => Destination::Path(PathBuf::from(path)),
        Err(_) => Destination::Folder {
            dir: PathBuf::from(header(&request, "x-rcut-folder")?),
            file_name: header(&request, "x-rcut-file-name")?,
        },
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
```
Then make these changes:
- **Imports:** extend them to `use std::io::{ErrorKind, Seek, SeekFrom, Write};`.
- **Remove the old commands:** delete `save_export_to_folder` and `save_export_as`. Keep `create_unique_export_file`, the validators, `header` and `raw_body`.
- **`main.rs`:**
  - Register `export_files::export_stream_open`, `export_stream_write`, `export_stream_finish` and `export_stream_abort` in place of the two removed commands.
  - Add `.manage(export_files::ExportStreams::default())` to the builder.
  - Read `main.rs` first.

- [ ] **Step 3: Verify.**
  - `cargo test 2>&1 | grep "test result"` → 14 pass (10 existing, 4 new).
  - `cargo clippy 2>&1 | tail -3` → no new warnings in `export_files.rs`.

- [ ] **Step 4: Commit** (no Co-Authored-By): `feat(desktop): stream exports into a .part file and rename on finish`

---

## Task 2: Web export sinks and exporter plumbing

**Files:**
- Create: `apps/web/src/export/sink.ts` (types only)
- Create: `apps/web/src/services/export-destination/sinks.ts`
- Modify: `apps/web/src/services/export-destination/index.ts`. Remove `saveExportToFolder` and `saveExportAs`.
- Modify: `apps/web/src/services/renderer/scene-exporter.ts`
- Modify: `apps/web/src/core/managers/renderer-manager.ts`
- Modify: `apps/web/src/core/managers/project-manager.ts`
- Modify: `apps/web/src/export/index.ts`. `ExportResult.buffer` is replaced by `output`.
- Modify: `apps/web/src/components/editor/export-button.tsx`
- Test: `apps/web/src/services/export-destination/__tests__/sinks.test.ts`

**Interfaces:**

`export/sink.ts`:
```ts
import type { Target } from "mediabunny";

/** Where a finished export ended up. */
export type ExportOutput = { kind: "file"; path: string } | { kind: "buffer"; buffer: ArrayBuffer };

/** One encode attempt's destination. */
export interface ExportSinkAttempt {
	target: Target;
	/** MP4 Fast Start mode for this target. */
	fastStart: false | "in-memory";
	/** Call after output.finalize() succeeds. */
	commit(): Promise<ExportOutput>;
	/** Call when the attempt fails or is cancelled; removes anything written. Never throws. */
	abort(): Promise<void>;
}

export interface ExportSink {
	/** Opens a fresh destination for one encode attempt. */
	open(): Promise<ExportSinkAttempt>;
}
```

`ExportResult` in `export/index.ts` becomes `{ success: boolean; output?: ExportOutput; error?: string; cancelled?: boolean }`. Remove `buffer`.

`services/export-destination/sinks.ts` exports:
- `createBufferSink(): ExportSink`. It uses `new BufferTarget()` with `fastStart: "in-memory"`. `commit` returns `{ kind: "buffer", buffer: target.buffer }`, or throws if the buffer is null. `abort` is a no-op.
- `createDiskSink({ destination }: { destination: { kind: "folder"; folder: string; fileName: string } | { kind: "file"; path: string } }): ExportSink`. On `open()`:
  1. Call `invoke<number>("export_stream_open", undefined, { headers })` with either `x-rcut-folder` + `x-rcut-file-name` or `x-rcut-path`, each `encodeURIComponent`ed. Read the `invoke` docs in `@tauri-apps/api/core` to confirm how to pass headers with no body. If headers need a body, pass `new Uint8Array(0)`.
  2. Create `new StreamTarget(new WritableStream<StreamTargetChunk>({ write: (chunk) => invoke("export_stream_write", chunk.data, { headers: { "x-rcut-stream-id": String(id), "x-rcut-position": String(chunk.position) } }) }), { chunked: true })`, with `fastStart: false`.
  3. `commit` → `{ kind: "file", path: await invoke<string>("export_stream_finish", { id }) }`.
  4. `abort` → `invoke("export_stream_abort", { id }).catch(() => {})`.

**Test** (`sinks.test.ts`): mock `@tauri-apps/api/core` with bun's `mock.module`. Before writing it, check that `mock.module` works for this import in this repo: grep existing tests for `mock.module`. Assert:
- `open()` sends the folder and file-name headers and returns an attempt with `fastStart: false`;
- writing two chunks through `attempt.target`'s writable calls `export_stream_write` in order, with position headers `"0"` and `"16"`. Get the writable from your own constructor argument by factoring a `createStreamWritable({ id, invoke })` helper you can test directly;
- `commit` returns the path from `export_stream_finish`;
- `abort` calls `export_stream_abort` and swallows a rejection.

If mocking the module is impractical, inject `invoke` as a parameter with a default, and test with a fake. Report which approach you chose.

**Exporter changes:**

`scene-exporter.ts`:
- `export({ rootNode, sink })` returns `Promise<ExportOutput | null>`.
- In `encodeVideo`, replace `new BufferTarget()` with an attempt from `await sink.open()`. Construct the Output with `target: attempt.target` and `format: new Mp4OutputFormat({ fastStart: attempt.fastStart })`.
- On every failure or cancel path of that attempt, call `await attempt.abort()` **after** the existing `cancelOutput` race. Put `attempt.abort()` inside the same 2 s race, because a stuck output must not block cleanup.
- After the guarded finalize, `return await attempt.commit()`. Wrap the commit in `guard` with the stall message `"Saving the export stopped responding. Try exporting again."`.
- The retry path opens a fresh attempt automatically, because `encodeVideo` calls `sink.open()` itself.
- Remove the `BufferTarget` import.
- Rename the local `buffer` variables to `output`.

`renderer-manager.ts`:
- `exportProject({ settings, sink, onProgress, onCancel })` passes `sink` through.
- It returns `{ success: true, output }`. The "Export failed to produce buffer" message becomes `"Export produced no output"`.

`project-manager.ts`: `export({ settings, sink })` passes `sink` through.

`export-button.tsx`:
- Remove the old `saveExport` function and its buffer and Downloads fallback.
- Build the sink from the destination:
  - `folder` → `createDiskSink({ destination: { kind: "folder", folder, fileName } })`;
  - `file` → `createDiskSink({ destination: { kind: "file", path } })`;
  - `download` (non-native) → `createBufferSink()`.
- On success:
  - `output.kind === "file"` → the existing "Exported to <path>" toast, with the "Show in folder" action;
  - `output.kind === "buffer"` → `downloadBuffer({ buffer, filename: fileName, mimeType: EXPORT_MIME_TYPE })`.
- Failures already show through `ExportError`, so no extra toast is needed.
- Keep `setLastSettings` on success.

`services/export-destination/index.ts`: remove `saveExportToFolder` and `saveExportAs`, and grep that nothing else uses them.

- [ ] **Steps (TDD):**
  1. Write `sinks.test.ts`, then run it and confirm it fails (RED).
  2. Implement `sink.ts` and `sinks.ts`, then run the test again and confirm it passes (GREEN).
  3. Plumb the exporter, managers and button.
  4. Verify:
     - tsc → `0`;
     - root `bun test` → no new failures, plus the new tests;
     - `bun run build:web` → succeeds.
  5. Commit (no Co-Authored-By): `feat(export): stream desktop exports straight to disk`.

---

## Task 3: Real-export verification (controller)

- [ ] Build the release and profiling exes.
- [ ] Export the user's 2-hour project to the default folder.
  - Sample WebView2 memory for 2–3 minutes. Expect it to stay flat (no ~1.4 MB/s growth).
  - Confirm a `.part` file grows in the folder.
  - Cancel. Expect the `.part` file to be gone and no final file.
- [ ] Export the test project:
  - to the folder twice → `X.mp4` and `X (2).mp4`. ffprobe both for video and AAC.
  - with "Export as…" through the exact-path command, called directly with a scratch path.
- [ ] Error: export into a folder that doesn't exist. Expect a clear error, and no stray file anywhere.
- [ ] User review.
