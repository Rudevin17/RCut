# Export Location Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the RCut desktop app, exports go to a remembered export folder that defaults to Downloads and can be changed in the export popover. "Export as…" opens a Save dialog. The app confirms where each file was saved and offers "Show in folder".

**Architecture:** The rendered export (an in-memory `ArrayBuffer`, as today) is sent to new Rust commands as a raw IPC body, and the Rust side writes it to disk. The official Tauri dialog plugin provides the folder picker and the Save dialog. A small zustand persist store remembers the folder. Browser dev mode keeps the existing browser download.

**Tech Stack:** Tauri 2.12 + tauri-plugin-dialog 2, Rust 1.97, percent-encoding 2, Next.js 16 static export, React 19, zustand, `@tauri-apps/api` 2.12, `@tauri-apps/plugin-dialog` 2, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-10-03-export-location-design.md`

## Global Constraints

- Work on branch `rcut-v1` in `D:\OpenCut`. Git identity is configured.
- Every commit message ends with a blank line, then exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Command names are exactly: `save_export_to_folder`, `save_export_as`, `default_export_folder`, `reveal_in_folder`.
- Header names are exactly `x-rcut-folder`, `x-rcut-file-name` and `x-rcut-path`. Values are `encodeURIComponent`-encoded on the JS side and percent-decoded as UTF-8 on the Rust side.
- "Export" never overwrites. If `<name>.<ext>` exists, it uses `<name> (n).<ext>` with the smallest free n ≥ 2.
- The persisted store name is exactly `"rcut-export-settings"`.
- JS package versions must match the Rust crates' major.minor: `@tauri-apps/api` 2.12.x for `tauri` 2.12, and `@tauri-apps/plugin-dialog` must match the `tauri-plugin-dialog` crate's major.minor.
- Browser dev mode (no `__TAURI_INTERNALS__`) keeps today's browser-download export.
- Rendering code is not modified. Only the save step changes.
- Code style follows the repo:
  - TS: tabs, double quotes, object-parameter functions `fn({ a, b })`, and `bun:test` tests in `__tests__/` next to the code.
  - Rust: rustfmt defaults.
- Do NOT use `sed -i` on existing files, because it strips CRLF in Git Bash. Use a file-edit tool.
- Current baseline:
  - `bun test` from the repo root: 199 pass, 4 fail. The 4 failures are pre-existing `opencut-wasm` import failures.
  - `bunx tsc --noEmit` in `apps/web`: 0 errors.

---

## Task 1: Desktop — export file commands and dialog plugin

**Files:**
- Create: `apps/desktop/src-tauri/src/export_files.rs`
- Modify: `apps/desktop/src-tauri/src/main.rs`
- Modify: `apps/desktop/src-tauri/Cargo.toml` (via `cargo add`)
- Modify: `apps/desktop/src-tauri/capabilities/default.json`

**Interfaces:**
- Produces Tauri commands:
  - `save_export_to_folder`. Raw `Uint8Array` body; headers `x-rcut-folder` and `x-rcut-file-name`. Returns the final saved path as a `string` and never overwrites.
  - `save_export_as`. Raw body; header `x-rcut-path`. Returns that path and overwrites it if it exists (the OS dialog already confirmed).
  - `default_export_folder`. No args; returns the Downloads folder path as a `string`.
  - `reveal_in_folder`. Args `{ path: string }`; opens Explorer with the file selected.
- Produces the dialog plugin commands, allowed via the `"dialog:default"` capability.

- [ ] **Step 1: Add dependencies**

```bash
cd /d/OpenCut/apps/desktop/src-tauri && cargo add tauri-plugin-dialog@2 percent-encoding@2
```
Expected: both appear under `[dependencies]` in `Cargo.toml`.

- [ ] **Step 2: Write `export_files.rs` with failing tests first**

Create `apps/desktop/src-tauri/src/export_files.rs` containing only the test module and a stub that returns the wrong path, so the tests fail:

```rust
//! Saving rendered exports to disk and revealing them in Explorer.

use std::path::{Path, PathBuf};

pub fn unique_export_path(dir: &Path, file_name: &str) -> PathBuf {
    dir.join(file_name)
}

#[cfg(test)]
mod tests {
    use super::unique_export_path;
    use std::fs;
    use std::path::PathBuf;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "rcut-export-test-{name}-{}",
            std::process::id()
        ));
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
```

Add `mod export_files;` to `main.rs` above `mod linked_files;` so the tests compile.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd /d/OpenCut/apps/desktop/src-tauri && cargo test export_files 2>&1 | grep -E "^test |test result"`
Expected: `uses_the_name_when_free` passes and the other three FAIL. `apps/web/out` must exist; if it doesn't, run `bun run build:web` from the repo root.

- [ ] **Step 4: Implement the module**

Replace the stub `unique_export_path` (keep the `#[cfg(test)] mod tests` block unchanged) so the file above the tests reads:

```rust
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
```

The save commands are `async` so that writing a large file doesn't block the UI thread. Tauri requires async commands with borrowed inputs (`Request<'_>`) to return `Result`, which these do.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /d/OpenCut/apps/desktop/src-tauri && cargo test export_files 2>&1 | grep -E "^test |test result"`
Expected: 4 passed, 0 failed.

- [ ] **Step 6: Register the plugin and commands**

Replace `apps/desktop/src-tauri/src/main.rs` with:

```rust
// Hide the console window in release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod export_files;
mod linked_files;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            linked_files::open_linked_file,
            export_files::save_export_to_folder,
            export_files::save_export_as,
            export_files::default_export_folder,
            export_files::reveal_in_folder,
        ])
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .expect("main window is defined in tauri.conf.json");
            linked_files::register(&window)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running RCut");
}
```

In `apps/desktop/src-tauri/capabilities/default.json`, change:
```json
	"permissions": ["core:default"]
```
to:
```json
	"permissions": ["core:default", "dialog:default"]
```

- [ ] **Step 7: Build, format, and commit**

Run: `cd /d/OpenCut/apps/desktop/src-tauri && cargo build 2>&1 | grep -E "^(warning|error)|-->|Finished"`
Expected: `Finished`, with no warnings or errors from `src/`.

Run: `cd /d/OpenCut/apps/desktop/src-tauri && cargo fmt --check`
Expected: no output. If there is output, run `cargo fmt` and re-check.

Run: `cd /d/OpenCut/apps/desktop/src-tauri && grep -A1 'name = "tauri-plugin-dialog"' Cargo.lock`
Write the version down. Task 2 must install the matching `@tauri-apps/plugin-dialog` major.minor.

```bash
cd /d/OpenCut && git add apps/desktop/src-tauri && git commit -q -F - <<'EOF'
feat(desktop): add export file commands and dialog plugin

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Task 2: Web — export file name helpers, settings store, destination service

**Files:**
- Create: `apps/web/src/export/export-file-name.ts`
- Test: `apps/web/src/export/__tests__/export-file-name.test.ts`
- Create: `apps/web/src/export/export-settings-store.ts`
- Create: `apps/web/src/services/export-destination/index.ts`
- Modify: `apps/web/package.json`, `bun.lock` (dependencies)

**Interfaces:**
- Consumes: the Task 1 commands and the dialog plugin.
- Produces:
  - `getExportFileName({ projectName, extension }: { projectName: string; extension: string }): string`, where `extension` includes the dot, e.g. `".mp4"`.
  - `joinExportPath({ folder, fileName }: { folder: string; fileName: string }): string`
  - `useExportSettingsStore` (zustand), with state `{ exportFolder: string | null; setExportFolder: ({ folder }: { folder: string }) => void }`
  - From `@/services/export-destination`:
    - `isNativeExportAvailable(): boolean`
    - `getDefaultExportFolder(): Promise<string>`
    - `pickExportFolder({ currentFolder }: { currentFolder: string | null }): Promise<string | null>`
    - `pickExportFile({ folder, fileName, extension }: { folder: string; fileName: string; extension: string }): Promise<string | null>`, where `extension` has no dot, e.g. `"mp4"`
    - `saveExportToFolder({ buffer, folder, fileName }: { buffer: ArrayBuffer; folder: string; fileName: string }): Promise<string>`
    - `saveExportAs({ buffer, path }: { buffer: ArrayBuffer; path: string }): Promise<string>`
    - `revealInFolder({ path }: { path: string }): Promise<void>`

- [ ] **Step 1: Install the JS packages**

The plugin's major.minor must match the crate version recorded in Task 1 Step 7. For example, crate `2.4.x` means `@tauri-apps/plugin-dialog@~2.4.0`.

```bash
cd /d/OpenCut/apps/web && bun add @tauri-apps/api@~2.12.1 @tauri-apps/plugin-dialog@~<crate major.minor>.0
```
Expected: both appear in `apps/web/package.json` `dependencies`.

- [ ] **Step 2: Write the failing tests**

`apps/web/src/export/__tests__/export-file-name.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import {
	getExportFileName,
	joinExportPath,
} from "@/export/export-file-name";

describe("getExportFileName", () => {
	test("appends the extension to the project name", () => {
		expect(
			getExportFileName({ projectName: "My project", extension: ".mp4" }),
		).toBe("My project.mp4");
	});

	test("replaces characters Windows does not allow", () => {
		expect(
			getExportFileName({
				projectName: 'a<b>:c"d/e\\f|g?h*i',
				extension: ".mp4",
			}),
		).toBe("a_b__c_d_e_f_g_h_i.mp4");
	});

	test("removes trailing dots and spaces", () => {
		expect(
			getExportFileName({ projectName: "Final cut. . ", extension: ".webm" }),
		).toBe("Final cut.webm");
	});

	test("falls back to Untitled for empty names", () => {
		expect(getExportFileName({ projectName: "   ", extension: ".mp4" })).toBe(
			"Untitled.mp4",
		);
		expect(getExportFileName({ projectName: "...", extension: ".mp4" })).toBe(
			"Untitled.mp4",
		);
	});
});

describe("joinExportPath", () => {
	test("joins with a backslash", () => {
		expect(joinExportPath({ folder: "D:\\Exports", fileName: "a.mp4" })).toBe(
			"D:\\Exports\\a.mp4",
		);
	});

	test("does not double a trailing separator", () => {
		expect(joinExportPath({ folder: "D:\\", fileName: "a.mp4" })).toBe(
			"D:\\a.mp4",
		);
	});
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd /d/OpenCut && bun test apps/web/src/export/__tests__/export-file-name.test.ts`
Expected: FAIL, because `@/export/export-file-name` cannot be resolved.

- [ ] **Step 4: Implement `apps/web/src/export/export-file-name.ts`**

```ts
// Characters Windows forbids in file names, plus ASCII control characters.
const INVALID_FILE_NAME_CHARACTERS = /[<>:"/\\|?*\x00-\x1f]/g;

export function getExportFileName({
	projectName,
	extension,
}: {
	projectName: string;
	extension: string;
}): string {
	const baseName = projectName
		.replace(INVALID_FILE_NAME_CHARACTERS, "_")
		.replace(/[. ]+$/, "")
		.trim();

	return `${baseName || "Untitled"}${extension}`;
}

export function joinExportPath({
	folder,
	fileName,
}: {
	folder: string;
	fileName: string;
}): string {
	return /[\\/]$/.test(folder)
		? `${folder}${fileName}`
		: `${folder}\\${fileName}`;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /d/OpenCut && bun test apps/web/src/export/__tests__/export-file-name.test.ts`
Expected: 6 pass, 0 fail.

- [ ] **Step 6: Create `apps/web/src/export/export-settings-store.ts`**

```ts
"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ExportSettingsState {
	exportFolder: string | null;
	setExportFolder: ({ folder }: { folder: string }) => void;
}

export const useExportSettingsStore = create<ExportSettingsState>()(
	persist(
		(set) => ({
			exportFolder: null,
			setExportFolder: ({ folder }) => set({ exportFolder: folder }),
		}),
		{ name: "rcut-export-settings" },
	),
);
```

- [ ] **Step 7: Create `apps/web/src/services/export-destination/index.ts`**

```ts
import { invoke } from "@tauri-apps/api/core";
import { joinExportPath } from "@/export/export-file-name";

export function isNativeExportAvailable(): boolean {
	return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function getDefaultExportFolder(): Promise<string> {
	return invoke<string>("default_export_folder");
}

export async function pickExportFolder({
	currentFolder,
}: {
	currentFolder: string | null;
}): Promise<string | null> {
	const { open } = await import("@tauri-apps/plugin-dialog");
	const folder = await open({
		directory: true,
		defaultPath: currentFolder ?? undefined,
		title: "Choose export folder",
	});
	return typeof folder === "string" ? folder : null;
}

export async function pickExportFile({
	folder,
	fileName,
	extension,
}: {
	folder: string;
	fileName: string;
	extension: string;
}): Promise<string | null> {
	const { save } = await import("@tauri-apps/plugin-dialog");
	return save({
		defaultPath: joinExportPath({ folder, fileName }),
		filters: [{ name: `${extension.toUpperCase()} video`, extensions: [extension] }],
		title: "Export as",
	});
}

export async function saveExportToFolder({
	buffer,
	folder,
	fileName,
}: {
	buffer: ArrayBuffer;
	folder: string;
	fileName: string;
}): Promise<string> {
	return invoke<string>("save_export_to_folder", new Uint8Array(buffer), {
		headers: {
			"x-rcut-folder": encodeURIComponent(folder),
			"x-rcut-file-name": encodeURIComponent(fileName),
		},
	});
}

export async function saveExportAs({
	buffer,
	path,
}: {
	buffer: ArrayBuffer;
	path: string;
}): Promise<string> {
	return invoke<string>("save_export_as", new Uint8Array(buffer), {
		headers: { "x-rcut-path": encodeURIComponent(path) },
	});
}

export async function revealInFolder({ path }: { path: string }): Promise<void> {
	await invoke("reveal_in_folder", { path });
}
```

- [ ] **Step 8: Verify and commit**

Run: `cd /d/OpenCut/apps/web && bunx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `0`.

Run: `cd /d/OpenCut && bun test 2>&1 | grep -E "^ *[0-9]+ (pass|fail)"`
Expected: 205 pass, 4 fail.

```bash
cd /d/OpenCut && git add apps/web/package.json bun.lock apps/web/src/export apps/web/src/services/export-destination && git commit -q -F - <<'EOF'
feat: add export destination service and settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Task 3: Export popover — folder row, Export / Export as…, confirmation

**Files:**
- Modify: `apps/web/src/components/editor/export-button.tsx`

**Interfaces:**
- Consumes everything Task 2 produces, plus the existing `getExportFileExtension`, `getExportMimeType` and `downloadBuffer` from `@/export`.

This is UI wiring over tested helpers. It is verified by tsc, the build, and the manual checks in Task 4.

- [ ] **Step 1: Imports**

In `apps/web/src/components/editor/export-button.tsx`:

Replace `import { useState } from "react";` with:
```ts
import { useEffect, useState } from "react";
import { toast } from "sonner";
```

Add after `import { DEFAULT_EXPORT_OPTIONS } from "@/export/defaults";`:
```ts
import { getExportFileName } from "@/export/export-file-name";
import { useExportSettingsStore } from "@/export/export-settings-store";
import {
	getDefaultExportFolder,
	isNativeExportAvailable,
	pickExportFile,
	pickExportFolder,
	revealInFolder,
	saveExportAs,
	saveExportToFolder,
} from "@/services/export-destination";
```

- [ ] **Step 2: Destination type and save helper**

Add directly above `export function ExportButton() {`:
```ts
type ExportDestination =
	| { kind: "folder"; folder: string }
	| { kind: "file"; path: string }
	| { kind: "download" };

async function saveExport({
	buffer,
	destination,
	fileName,
	mimeType,
}: {
	buffer: ArrayBuffer;
	destination: ExportDestination;
	fileName: string;
	mimeType: string;
}): Promise<void> {
	if (destination.kind === "download") {
		downloadBuffer({ buffer, filename: fileName, mimeType });
		return;
	}

	try {
		const path =
			destination.kind === "folder"
				? await saveExportToFolder({
						buffer,
						folder: destination.folder,
						fileName,
					})
				: await saveExportAs({ buffer, path: destination.path });

		toast.success(`Exported to ${path}`, {
			action: {
				label: "Show in folder",
				onClick: () => {
					revealInFolder({ path }).catch((error) =>
						console.error("Failed to show export in folder:", error),
					);
				},
			},
		});
	} catch (error) {
		toast.error("Couldn't save the export", {
			description: error instanceof Error ? error.message : String(error),
		});
	}
}
```

- [ ] **Step 3: Folder state and the new export handler in `ExportPopover`**

In `ExportPopover`, add directly after the `shouldIncludeAudio` state:
```ts
	const isNativeExport = isNativeExportAvailable();
	const { exportFolder, setExportFolder } = useExportSettingsStore();
	const [defaultFolder, setDefaultFolder] = useState<string | null>(null);

	useEffect(() => {
		if (!isNativeExport || exportFolder) return;
		getDefaultExportFolder()
			.then(setDefaultFolder)
			.catch((error) =>
				console.error("Failed to read the Downloads folder:", error),
			);
	}, [isNativeExport, exportFolder]);

	const targetFolder = exportFolder ?? defaultFolder;

	const handleChangeFolder = async () => {
		const folder = await pickExportFolder({ currentFolder: targetFolder });
		if (folder) setExportFolder({ folder });
	};
```

Replace the whole existing `handleExport` function with:
```ts
	const handleExport = async ({
		saveAs = false,
	}: { saveAs?: boolean } = {}) => {
		if (!activeProject) return;

		const fileName = getExportFileName({
			projectName: activeProject.metadata.name,
			extension: getExportFileExtension({ format }),
		});

		let destination: ExportDestination = { kind: "download" };
		if (isNativeExport) {
			if (!targetFolder) {
				toast.error("Choose an export folder first");
				return;
			}

			if (saveAs) {
				const path = await pickExportFile({
					folder: targetFolder,
					fileName,
					extension: format,
				});
				if (!path) return;
				destination = { kind: "file", path };
			} else {
				destination = { kind: "folder", folder: targetFolder };
			}
		}

		const result = await editor.project.export({
			options: {
				format,
				quality,
				fps: activeProject.settings.fps,
				includeAudio: shouldIncludeAudio,
			},
		});

		if (result.cancelled) {
			editor.project.clearExportState();
			return;
		}

		if (result.success && result.buffer) {
			await saveExport({
				buffer: result.buffer,
				destination,
				fileName,
				mimeType: getExportMimeType({ format }),
			});

			editor.project.clearExportState();
			onOpenChange(false);
		}
	};
```

Change the `ExportError` retry prop from `onRetry={handleExport}` to:
```tsx
					onRetry={() => handleExport()}
```

- [ ] **Step 4: Folder row and buttons**

Replace:
```tsx
								<div className="p-3 pt-0">
									<Button onClick={handleExport} className="w-full gap-2">
										<Download className="size-4" />
										Export
									</Button>
								</div>
```
with:
```tsx
								<div className="flex flex-col gap-2 p-3 pt-0">
									{isNativeExport && (
										<div className="flex items-center gap-2 text-xs">
											<span className="text-muted-foreground shrink-0">
												Save to
											</span>
											<span
												className="min-w-0 flex-1 truncate"
												title={targetFolder ?? undefined}
											>
												{targetFolder ?? "Downloads"}
											</span>
											<Button
												size="sm"
												variant="outline"
												onClick={handleChangeFolder}
											>
												Change…
											</Button>
										</div>
									)}
									<div className="flex gap-2">
										<Button
											onClick={() => handleExport()}
											className="flex-1 gap-2"
										>
											<Download className="size-4" />
											Export
										</Button>
										{isNativeExport && (
											<Button
												variant="outline"
												onClick={() => handleExport({ saveAs: true })}
											>
												Export as…
											</Button>
										)}
									</div>
								</div>
```

- [ ] **Step 5: Verify and commit**

Run: `cd /d/OpenCut/apps/web && bunx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `0`.

Run: `cd /d/OpenCut && bun test 2>&1 | grep -E "^ *[0-9]+ (pass|fail)"`
Expected: 205 pass, 4 fail.

Run: `cd /d/OpenCut && bun run build:web 2>&1 | tail -3`
Expected: the build succeeds.

```bash
cd /d/OpenCut && git add apps/web/src/components/editor/export-button.tsx && git commit -q -F - <<'EOF'
feat: choose export folder and export as from the export popover

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Task 4: Build and verify in `rcut.exe`

**Files:** none, unless a check fails.

- [ ] **Step 1: Release build**

Run: `cd /d/OpenCut && bun run build:desktop` (several minutes; run it in the background).
Expected: success. If the Tauri CLI reports mismatched package versions, align the JS package versions (major.minor) with the crates and rebuild.

- [ ] **Step 2: User checks**

1. Open the export popover. "Save to" shows the Downloads path.
2. Click **Change…** and pick a folder (e.g. `D:\Exports`). The row updates.
3. **Export** → the toast says "Exported to D:\Exports\<project>.mp4". **Show in folder** opens Explorer with the file selected.
4. **Export** again → the file is saved as `<project> (2).mp4`, and the first file is untouched.
5. **Export as…** → the Save dialog opens in `D:\Exports` with the project name. Save as a new name → the file appears there.
6. **Export as…** → Cancel → nothing renders.
7. Restart RCut → the "Save to" row still shows `D:\Exports`.

- [ ] **Step 3: Final test run, and commit fixes if any**

Run: `cd /d/OpenCut && bun test 2>&1 | grep -E "^ *[0-9]+ (pass|fail)"`
Expected: 205 pass, 4 fail.
