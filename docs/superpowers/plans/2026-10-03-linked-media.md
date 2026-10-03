# Linked Media Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the RCut desktop app, imported media files that exist on disk are linked by path instead of copied into browser storage. Missing files can be relinked with "Locate file".

**Architecture:**
- A Windows-only Rust module in the Tauri shell uses WebView2 APIs for two jobs:
  - it reports the real path of picked or dropped `File`s;
  - it hands the page a read-only `FileSystemFileHandle` for a stored path.
- The web app has a small bridge (`services/linked-files`) over those messages.
- Storage keeps `sourcePath` in media metadata instead of copying the file to OPFS.
- On load, it opens the original file through the bridge.
- Everything downstream (playback, timeline, renderer, export) keeps consuming `File`, unchanged.

**Tech Stack:** Tauri 2.12 (Rust 1.97), webview2-com 0.39, windows 0.62, serde_json 1, Next.js 16 static export, React 19, TypeScript, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-10-03-linked-media-design.md`

## Global Constraints

- Work on branch `rcut-v1` in `D:\OpenCut`. Git identity is already configured.
- Every commit message ends with a blank line then exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Page↔host message `type` values are exactly `"rcut:resolve-paths"`, `"rcut:resolved-paths"` and `"rcut:linked-file"`. The Tauri command name is exactly `open_linked_file`.
- RCut must never write to, move, or delete a linked original file.
- Linked handles are read-only: `COREWEBVIEW2_FILE_SYSTEM_HANDLE_PERMISSION_READ_ONLY`.
- Bridge request timeout is `10_000` ms.
- Rust crate versions must match those already in `apps/desktop/src-tauri/Cargo.lock`: `webview2-com = "0.39"`, `windows = "0.62"`, `serde_json = "1"`. The desktop crate is Windows-only, because macOS/Linux are non-goals.
- Browser dev mode (`bun run dev:web` in Chrome), and any file without a resolvable path (clipboard paste), keep the existing copy-into-storage behaviour.
- Playback, timeline, renderer, export and audio code are not modified.
- Code style follows the repo:
  - tabs and double quotes in TS;
  - object-parameter functions `fn({ a, b })`;
  - `bun:test` tests in `__tests__/` folders next to the code;
  - Rust formatted with rustfmt defaults.
- Do NOT use `sed -i` on existing files: in Git Bash it strips CRLF line endings. Use a file-edit tool.
- Current baseline:
  - `bun test` from repo root: 182 pass, 4 fail. The 4 are pre-existing: test files that can't import `opencut-wasm` `.wasm` under bun test.
  - `bunx tsc --noEmit` in `apps/web`: 0 errors.

---

## Task 1: Desktop — linked files host module

**Files:**
- Create: `apps/desktop/src-tauri/src/linked_files.rs`
- Modify: `apps/desktop/src-tauri/src/main.rs`
- Modify: `apps/desktop/src-tauri/Cargo.toml`

**Interfaces:**
- Produces, page → host:
  - `window.chrome.webview.postMessageWithAdditionalObjects(JSON.stringify({ type: "rcut:resolve-paths", requestId }), files)`.
  - Host replies via `PostWebMessageAsJson`: `{ type: "rcut:resolved-paths", requestId, paths: (string | null)[] }`, where `paths[i]` corresponds to `files[i]`.
- Produces, Tauri command `open_linked_file` with args `{ requestId: string, path: string }`. It returns `Ok(())` immediately and the result arrives as a web message:
  - `{ type: "rcut:linked-file", requestId, status: "ok" }` with `event.additionalObjects[0]` a `FileSystemFileHandle`;
  - `{ type: "rcut:linked-file", requestId, status: "missing" }`;
  - `{ type: "rcut:linked-file", requestId, status: "error", message: string }`.

This task is Rust/COM glue verified by compiling. End-to-end behaviour is verified in Task 6. Both mechanisms were proven by spikes; the code below matches the spikes.

- [ ] **Step 1: Add dependencies**

In `apps/desktop/src-tauri/Cargo.toml`, replace the `[dependencies]` section with:

```toml
[dependencies]
tauri = { version = "2", features = [] }
serde_json = "1"
webview2-com = "0.39"
windows = "0.62"
```

- [ ] **Step 2: Create `apps/desktop/src-tauri/src/linked_files.rs`**

```rust
//! Linked media: lets the editor reference media files on disk instead of
//! copying them into browser storage. Uses WebView2 APIs, so Windows-only.
//!
//! - `rcut:resolve-paths` (page -> host, with File objects): the host replies
//!   with each file's real path.
//! - `open_linked_file` (Tauri command): the host replies with a read-only
//!   FileSystemFileHandle for a stored path, or reports it missing.

use serde_json::{json, Value};
use tauri::webview::PlatformWebview;
use tauri::WebviewWindow;
use webview2_com::Microsoft::Web::WebView2::Win32::*;
use webview2_com::{take_pwstr, WebMessageReceivedEventHandler};
use windows::core::{Interface, IUnknown, HRESULT, HSTRING, PCWSTR, PWSTR};

const RESOLVE_PATHS: &str = "rcut:resolve-paths";
const RESOLVED_PATHS: &str = "rcut:resolved-paths";
const LINKED_FILE: &str = "rcut:linked-file";
const E_POINTER: HRESULT = HRESULT(0x8000_4003_u32 as i32);

/// Registers the web message handler that answers `rcut:resolve-paths`.
pub fn register(window: &WebviewWindow) -> tauri::Result<()> {
    window.with_webview(|webview| unsafe {
        let core = match webview.controller().CoreWebView2() {
            Ok(core) => core,
            Err(error) => {
                eprintln!("[linked-files] CoreWebView2 unavailable: {error:?}");
                return;
            }
        };

        let handler = WebMessageReceivedEventHandler::create(Box::new(|sender, args| {
            let (Some(sender), Some(args)) = (sender, args) else {
                return Ok(());
            };

            let mut raw = PWSTR::null();
            if args.TryGetWebMessageAsString(&mut raw).is_err() {
                return Ok(());
            }
            let Ok(request) = serde_json::from_str::<Value>(&take_pwstr(raw)) else {
                return Ok(());
            };
            if request["type"] != RESOLVE_PATHS {
                return Ok(());
            }

            let paths = read_file_paths(&args).unwrap_or_default();
            let response = json!({
                "type": RESOLVED_PATHS,
                "requestId": request["requestId"],
                "paths": paths,
            });
            let response = HSTRING::from(response.to_string());
            sender.PostWebMessageAsJson(PCWSTR(response.as_ptr()))?;
            Ok(())
        }));

        let mut token = 0i64;
        if let Err(error) = core.add_WebMessageReceived(&handler, &mut token) {
            eprintln!("[linked-files] failed to register message handler: {error:?}");
        }
    })
}

/// Sends a read-only handle for `path` to the page, or reports it missing.
#[tauri::command]
pub fn open_linked_file(
    window: WebviewWindow,
    request_id: String,
    path: String,
) -> Result<(), String> {
    window
        .with_webview(move |webview| unsafe {
            let result = if std::path::Path::new(&path).is_file() {
                post_file_handle(&webview, &request_id, &path)
            } else {
                post_json(
                    &webview,
                    json!({ "type": LINKED_FILE, "requestId": request_id, "status": "missing" }),
                )
            };

            if let Err(error) = result {
                let reported = post_json(
                    &webview,
                    json!({
                        "type": LINKED_FILE,
                        "requestId": request_id,
                        "status": "error",
                        "message": format!("{error:?}"),
                    }),
                );
                if let Err(post_error) = reported {
                    eprintln!("[linked-files] failed to report error: {post_error:?}");
                }
            }
        })
        .map_err(|error| error.to_string())
}

unsafe fn read_file_paths(
    args: &ICoreWebView2WebMessageReceivedEventArgs,
) -> windows::core::Result<Vec<Option<String>>> {
    let args: ICoreWebView2WebMessageReceivedEventArgs2 = args.cast()?;
    let objects = args.AdditionalObjects()?;
    let mut count = 0u32;
    objects.Count(&mut count)?;

    let mut paths = Vec::with_capacity(count as usize);
    for index in 0..count {
        let path = objects
            .GetValueAtIndex(index)
            .and_then(|object| object.cast::<ICoreWebView2File>())
            .and_then(|file| {
                let mut raw = PWSTR::null();
                file.Path(&mut raw)?;
                Ok(take_pwstr(raw))
            })
            .ok();
        paths.push(path);
    }
    Ok(paths)
}

unsafe fn post_file_handle(
    webview: &PlatformWebview,
    request_id: &str,
    path: &str,
) -> windows::core::Result<()> {
    let environment: ICoreWebView2Environment14 = webview.environment().cast()?;
    let wide_path = HSTRING::from(path);
    let handle = environment.CreateWebFileSystemFileHandle(
        PCWSTR(wide_path.as_ptr()),
        COREWEBVIEW2_FILE_SYSTEM_HANDLE_PERMISSION_READ_ONLY,
    )?;

    let mut items = [Some(handle.cast::<IUnknown>()?)];
    let mut collection: Option<ICoreWebView2ObjectCollection> = None;
    environment.CreateObjectCollection(1, items.as_mut_ptr(), &mut collection)?;
    let Some(collection) = collection else {
        return Err(windows::core::Error::from_hresult(E_POINTER));
    };
    let collection: ICoreWebView2ObjectCollectionView = collection.cast()?;

    let core: ICoreWebView2_23 = webview.controller().CoreWebView2()?.cast()?;
    let message = HSTRING::from(
        json!({ "type": LINKED_FILE, "requestId": request_id, "status": "ok" }).to_string(),
    );
    core.PostWebMessageAsJsonWithAdditionalObjects(PCWSTR(message.as_ptr()), &collection)
}

unsafe fn post_json(webview: &PlatformWebview, value: Value) -> windows::core::Result<()> {
    let core = webview.controller().CoreWebView2()?;
    let message = HSTRING::from(value.to_string());
    core.PostWebMessageAsJson(PCWSTR(message.as_ptr()))
}
```

- [ ] **Step 3: Wire it into `apps/desktop/src-tauri/src/main.rs`**

Replace the file with:

```rust
// Hide the console window in release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod linked_files;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![linked_files::open_linked_file])
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

- [ ] **Step 4: Build**

Run: `cd /d/OpenCut/apps/desktop/src-tauri && cargo build 2>&1 | grep -E "^(warning|error)|-->|Finished"`
Expected: `Finished`, with no errors and no warnings from `src/linked_files.rs` or `src/main.rs`. `apps/web/out` must exist; if it doesn't, run `bun run build:web` first.

If a binding signature differs from the code above, check the real signature in `~/.cargo/registry/src/*/webview2-com-sys-0.39.1/src/bindings.rs` and adapt minimally. Example: `windows::core::Error::from_hresult` may not exist under that name; use `windows::core::Error::from(E_POINTER)` instead. Report any such adaptation.

Run: `cd /d/OpenCut/apps/desktop/src-tauri && cargo fmt --check`
Expected: no output. If it fails, run `cargo fmt` and re-check.

- [ ] **Step 5: Commit**

```bash
cd /d/OpenCut && git add apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock apps/desktop/src-tauri/src && git commit -q -F - <<'EOF'
feat(desktop): add linked files host module

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Task 2: Web — linked files bridge

**Files:**
- Create: `apps/web/src/services/linked-files/bridge.ts`
- Create: `apps/web/src/services/linked-files/index.ts`
- Test: `apps/web/src/services/linked-files/__tests__/bridge.test.ts`

**Interfaces:**
- Consumes: the message protocol and `open_linked_file` command from Task 1.
- Produces (from `@/services/linked-files`):
  - `type LinkedFileResult = { status: "ok"; file: File } | { status: "missing" } | { status: "error"; message: string }`
  - `isLinkingAvailable(): boolean`
  - `resolveFilePaths({ files }: { files: File[] }): Promise<(string | null)[]>`: same length as `files`. All `null` when linking is unavailable, timed out, or failed.
  - `openLinkedFile({ path }: { path: string }): Promise<LinkedFileResult>`

- [ ] **Step 1: Write the failing tests**

`apps/web/src/services/linked-files/__tests__/bridge.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import {
	createLinkedFilesBridge,
	type HostMessage,
	type LinkedFilesTransport,
} from "@/services/linked-files/bridge";

function createFakeTransport() {
	let listener: ((message: HostMessage) => void) | null = null;
	const posted: Array<{ message: string; objects: File[] }> = [];
	const invoked: Array<{ command: string; args: Record<string, unknown> }> = [];
	let invokeImpl: () => Promise<unknown> = async () => undefined;

	const transport: LinkedFilesTransport = {
		postWithObjects: ({ message, objects }) => {
			posted.push({ message, objects });
		},
		invoke: ({ command, args }) => {
			invoked.push({ command, args });
			return invokeImpl();
		},
		onMessage: ({ listener: next }) => {
			listener = next;
		},
	};

	return {
		transport,
		posted,
		invoked,
		reply: (message: HostMessage) => listener?.(message),
		failInvoke: () => {
			invokeImpl = async () => {
				throw new Error("command failed");
			};
		},
	};
}

function createBridge({ timeoutMs = 50 }: { timeoutMs?: number } = {}) {
	const fake = createFakeTransport();
	let counter = 0;
	const bridge = createLinkedFilesBridge({
		transport: fake.transport,
		timeoutMs,
		createRequestId: () => `req-${++counter}`,
	});
	return { fake, bridge };
}

const fileA = new File(["a"], "a.mp4", { type: "video/mp4" });
const fileB = new File(["b"], "b.mp4", { type: "video/mp4" });

describe("resolveFilePaths", () => {
	test("posts the files and maps returned paths by index", async () => {
		const { fake, bridge } = createBridge();
		const pending = bridge.resolveFilePaths({ files: [fileA, fileB] });

		expect(JSON.parse(fake.posted[0].message)).toEqual({
			type: "rcut:resolve-paths",
			requestId: "req-1",
		});
		expect(fake.posted[0].objects).toEqual([fileA, fileB]);

		fake.reply({
			data: {
				type: "rcut:resolved-paths",
				requestId: "req-1",
				paths: ["D:\\a.mp4", null],
			},
			additionalObjects: [],
		});

		expect(await pending).toEqual(["D:\\a.mp4", null]);
	});

	test("returns nulls on timeout", async () => {
		const { bridge } = createBridge({ timeoutMs: 10 });
		expect(await bridge.resolveFilePaths({ files: [fileA] })).toEqual([null]);
	});

	test("returns nulls for missing or malformed paths", async () => {
		const { fake, bridge } = createBridge();
		const pending = bridge.resolveFilePaths({ files: [fileA, fileB] });
		fake.reply({
			data: { type: "rcut:resolved-paths", requestId: "req-1", paths: [""] },
			additionalObjects: [],
		});
		expect(await pending).toEqual([null, null]);
	});

	test("returns an empty array without posting for no files", async () => {
		const { fake, bridge } = createBridge();
		expect(await bridge.resolveFilePaths({ files: [] })).toEqual([]);
		expect(fake.posted).toHaveLength(0);
	});

	test("ignores messages with another type or unknown request id", async () => {
		const { fake, bridge } = createBridge({ timeoutMs: 20 });
		const pending = bridge.resolveFilePaths({ files: [fileA] });
		fake.reply({
			data: { type: "something-else", requestId: "req-1", paths: ["x"] },
			additionalObjects: [],
		});
		fake.reply({
			data: { type: "rcut:resolved-paths", requestId: "req-99", paths: ["x"] },
			additionalObjects: [],
		});
		expect(await pending).toEqual([null]);
	});
});

describe("openLinkedFile", () => {
	test("invokes the command and returns the file from the handle", async () => {
		const { fake, bridge } = createBridge();
		const pending = bridge.openLinkedFile({ path: "D:\\a.mp4" });

		expect(fake.invoked[0]).toEqual({
			command: "open_linked_file",
			args: { requestId: "req-1", path: "D:\\a.mp4" },
		});

		fake.reply({
			data: { type: "rcut:linked-file", requestId: "req-1", status: "ok" },
			additionalObjects: [{ getFile: async () => fileA }],
		});

		expect(await pending).toEqual({ status: "ok", file: fileA });
	});

	test("reports missing files", async () => {
		const { fake, bridge } = createBridge();
		const pending = bridge.openLinkedFile({ path: "D:\\gone.mp4" });
		fake.reply({
			data: { type: "rcut:linked-file", requestId: "req-1", status: "missing" },
			additionalObjects: [],
		});
		expect(await pending).toEqual({ status: "missing" });
	});

	test("reports host errors with their message", async () => {
		const { fake, bridge } = createBridge();
		const pending = bridge.openLinkedFile({ path: "D:\\a.mp4" });
		fake.reply({
			data: {
				type: "rcut:linked-file",
				requestId: "req-1",
				status: "error",
				message: "no Environment14",
			},
			additionalObjects: [],
		});
		expect(await pending).toEqual({
			status: "error",
			message: "no Environment14",
		});
	});

	test("reports an error when ok arrives without a handle", async () => {
		const { fake, bridge } = createBridge();
		const pending = bridge.openLinkedFile({ path: "D:\\a.mp4" });
		fake.reply({
			data: { type: "rcut:linked-file", requestId: "req-1", status: "ok" },
			additionalObjects: [],
		});
		expect((await pending).status).toBe("error");
	});

	test("reports an error when the command fails", async () => {
		const { fake, bridge } = createBridge();
		fake.failInvoke();
		expect((await bridge.openLinkedFile({ path: "D:\\a.mp4" })).status).toBe(
			"error",
		);
	});

	test("reports an error on timeout", async () => {
		const { bridge } = createBridge({ timeoutMs: 10 });
		expect((await bridge.openLinkedFile({ path: "D:\\a.mp4" })).status).toBe(
			"error",
		);
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /d/OpenCut && bun test apps/web/src/services/linked-files`
Expected: FAIL, because `@/services/linked-files/bridge` can't be resolved.

- [ ] **Step 3: Implement `apps/web/src/services/linked-files/bridge.ts`**

```ts
export const LINKED_FILES_TIMEOUT_MS = 10_000;

export type LinkedFileResult =
	| { status: "ok"; file: File }
	| { status: "missing" }
	| { status: "error"; message: string };

export interface HostMessage {
	data: unknown;
	additionalObjects: readonly unknown[];
}

export interface LinkedFilesTransport {
	postWithObjects({
		message,
		objects,
	}: {
		message: string;
		objects: File[];
	}): void;
	invoke({
		command,
		args,
	}: {
		command: string;
		args: Record<string, unknown>;
	}): Promise<unknown>;
	onMessage({ listener }: { listener: (message: HostMessage) => void }): void;
}

interface HostReply {
	type?: unknown;
	requestId?: unknown;
	paths?: unknown;
	status?: unknown;
	message?: unknown;
}

const REPLY_TYPES = new Set(["rcut:resolved-paths", "rcut:linked-file"]);

export function createLinkedFilesBridge({
	transport,
	timeoutMs = LINKED_FILES_TIMEOUT_MS,
	createRequestId = () => crypto.randomUUID(),
}: {
	transport: LinkedFilesTransport;
	timeoutMs?: number;
	createRequestId?: () => string;
}) {
	const pending = new Map<string, (message: HostMessage) => void>();

	transport.onMessage({
		listener: (message) => {
			const reply = message.data as HostReply | null;
			if (!reply || typeof reply.requestId !== "string") return;
			if (typeof reply.type !== "string" || !REPLY_TYPES.has(reply.type)) {
				return;
			}

			const resolve = pending.get(reply.requestId);
			if (!resolve) return;
			pending.delete(reply.requestId);
			resolve(message);
		},
	});

	function request({
		send,
	}: {
		send: (requestId: string) => unknown;
	}): Promise<HostMessage | null> {
		const requestId = createRequestId();

		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				pending.delete(requestId);
				resolve(null);
			}, timeoutMs);

			const fail = () => {
				clearTimeout(timer);
				pending.delete(requestId);
				resolve(null);
			};

			pending.set(requestId, (message) => {
				clearTimeout(timer);
				resolve(message);
			});

			try {
				Promise.resolve(send(requestId)).catch(fail);
			} catch {
				fail();
			}
		});
	}

	async function resolveFilePaths({
		files,
	}: {
		files: File[];
	}): Promise<(string | null)[]> {
		if (files.length === 0) return [];

		const response = await request({
			send: (requestId) =>
				transport.postWithObjects({
					message: JSON.stringify({ type: "rcut:resolve-paths", requestId }),
					objects: files,
				}),
		});

		const paths = (response?.data as HostReply | undefined)?.paths;
		return files.map((_, index) => {
			const path = Array.isArray(paths) ? paths[index] : null;
			return typeof path === "string" && path.length > 0 ? path : null;
		});
	}

	async function openLinkedFile({
		path,
	}: {
		path: string;
	}): Promise<LinkedFileResult> {
		const response = await request({
			send: (requestId) =>
				transport.invoke({
					command: "open_linked_file",
					args: { requestId, path },
				}),
		});

		if (!response) {
			return {
				status: "error",
				message: "Linked file request failed or timed out",
			};
		}

		const reply = response.data as HostReply;
		if (reply.status === "missing") return { status: "missing" };

		if (reply.status === "ok") {
			const handle = response.additionalObjects[0] as
				| { getFile?: () => Promise<File> }
				| undefined;
			if (!handle?.getFile) {
				return { status: "error", message: "No file handle received" };
			}

			try {
				return { status: "ok", file: await handle.getFile() };
			} catch (error) {
				return {
					status: "error",
					message: error instanceof Error ? error.message : String(error),
				};
			}
		}

		return {
			status: "error",
			message:
				typeof reply.message === "string"
					? reply.message
					: "Failed to open linked file",
		};
	}

	return { resolveFilePaths, openLinkedFile };
}
```

- [ ] **Step 4: Run to verify the tests pass**

Run: `cd /d/OpenCut && bun test apps/web/src/services/linked-files`
Expected: 11 pass, 0 fail.

- [ ] **Step 5: Implement `apps/web/src/services/linked-files/index.ts`**

This binds the bridge to WebView2 and Tauri. It isn't unit-tested because it is pure environment glue; it's verified end-to-end in Task 6.

```ts
import {
	createLinkedFilesBridge,
	type LinkedFileResult,
} from "@/services/linked-files/bridge";

export type { LinkedFileResult } from "@/services/linked-files/bridge";

interface WebViewHost {
	postMessageWithAdditionalObjects?: (
		message: string,
		additionalObjects: unknown[],
	) => void;
	addEventListener: (
		type: "message",
		listener: (event: {
			data: unknown;
			additionalObjects?: readonly unknown[];
		}) => void,
	) => void;
}

interface TauriInternals {
	invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
}

function getHost(): { webview: WebViewHost; tauri: TauriInternals } | null {
	if (typeof window === "undefined") return null;

	const candidate = window as unknown as {
		chrome?: { webview?: WebViewHost };
		__TAURI_INTERNALS__?: TauriInternals;
	};
	const webview = candidate.chrome?.webview;
	const tauri = candidate.__TAURI_INTERNALS__;

	if (!webview?.postMessageWithAdditionalObjects || !tauri) return null;
	return { webview, tauri };
}

let bridge: ReturnType<typeof createLinkedFilesBridge> | null = null;

function getBridge(): ReturnType<typeof createLinkedFilesBridge> | null {
	if (bridge) return bridge;

	const host = getHost();
	if (!host) return null;

	bridge = createLinkedFilesBridge({
		transport: {
			postWithObjects: ({ message, objects }) =>
				host.webview.postMessageWithAdditionalObjects?.(message, objects),
			invoke: ({ command, args }) => host.tauri.invoke(command, args),
			onMessage: ({ listener }) =>
				host.webview.addEventListener("message", (event) =>
					listener({
						data: event.data,
						additionalObjects: event.additionalObjects ?? [],
					}),
				),
		},
	});
	return bridge;
}

export function isLinkingAvailable(): boolean {
	return getHost() !== null;
}

export async function resolveFilePaths({
	files,
}: {
	files: File[];
}): Promise<(string | null)[]> {
	const linkedFiles = getBridge();
	if (!linkedFiles) return files.map(() => null);
	return linkedFiles.resolveFilePaths({ files });
}

export async function openLinkedFile({
	path,
}: {
	path: string;
}): Promise<LinkedFileResult> {
	const linkedFiles = getBridge();
	if (!linkedFiles) {
		return { status: "error", message: "Linking is not available" };
	}
	return linkedFiles.openLinkedFile({ path });
}
```

- [ ] **Step 6: Verify and commit**

Run: `cd /d/OpenCut/apps/web && bunx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `0`.

Run: `cd /d/OpenCut && bun test 2>&1 | grep -E "^ *[0-9]+ (pass|fail)"`
Expected: 193 pass, 4 fail.

```bash
cd /d/OpenCut && git add apps/web/src/services/linked-files && git commit -q -F - <<'EOF'
feat: add linked files bridge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Task 3: Storage — linked and missing assets

**Files:**
- Create: `apps/web/src/media/linked-media.ts`
- Test: `apps/web/src/media/__tests__/linked-media.test.ts`
- Modify: `apps/web/src/services/storage/types.ts` (`MediaAssetData`, new `MissingMediaAsset`)
- Modify: `apps/web/src/services/storage/service.ts` (`saveMediaAsset`, `loadMediaAsset`, `loadAllMediaAssets`, new `saveMediaAssetMetadata`)
- Modify: `apps/web/src/core/managers/media-manager.ts` (`loadProjectMedia`, missing list, clears)
- Modify: `apps/web/src/core/managers/project-manager.ts` (project duplication, ~line 453)

**Interfaces:**
- Consumes: `openLinkedFile` from `@/services/linked-files` (Task 2).
- Produces:
  - `MediaAssetData.sourcePath?: string`. `MediaAsset` inherits it.
  - `interface MissingMediaAsset extends MediaAssetData { sourcePath: string; reason: "missing" | "error" }` in `@/services/storage/types`.
  - `storageService.loadAllMediaAssets({ projectId }): Promise<{ assets: MediaAsset[]; missing: MissingMediaAsset[] }>`
  - `storageService.saveMediaAssetMetadata({ projectId, metadata }: { projectId: string; metadata: MediaAssetData }): Promise<void>`
  - `editor.media.getMissingAssets(): MissingMediaAsset[]`
  - From `@/media/linked-media`:
    - `planMediaImport({ path }: { path: string | null }): MediaImportPlan`, where `MediaImportPlan = { mode: "link"; sourcePath: string } | { mode: "copy" }`
    - `isRelinkCompatible({ missingAsset, fileType }: { missingAsset: MissingMediaAsset; fileType: MediaType | null }): boolean`
    - `applyRelinkedAsset({ assets, missingAssets, relinked }: { assets: MediaAsset[]; missingAssets: MissingMediaAsset[]; relinked: MediaAsset }): { assets: MediaAsset[]; missingAssets: MissingMediaAsset[] }`
    - `toMediaAssetData({ missingAsset }: { missingAsset: MissingMediaAsset }): MediaAssetData`

- [ ] **Step 1: Add the types**

In `apps/web/src/services/storage/types.ts`, inside `interface MediaAssetData`, add after `thumbnailUrl?: string;`:
```ts
	sourcePath?: string;
```
and add directly after the `MediaAssetData` interface:
```ts
export interface MissingMediaAsset extends MediaAssetData {
	sourcePath: string;
	reason: "missing" | "error";
}
```

- [ ] **Step 2: Write the failing tests**

`apps/web/src/media/__tests__/linked-media.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import {
	applyRelinkedAsset,
	isRelinkCompatible,
	planMediaImport,
	toMediaAssetData,
} from "@/media/linked-media";
import type { MediaAsset } from "@/media/types";
import type { MissingMediaAsset } from "@/services/storage/types";

const missingVideo: MissingMediaAsset = {
	id: "m1",
	name: "clip.mp4",
	type: "video",
	size: 10,
	lastModified: 1,
	sourcePath: "D:\\old\\clip.mp4",
	reason: "missing",
};

function asset({ id }: { id: string }): MediaAsset {
	return {
		id,
		name: `${id}.mp4`,
		type: "video",
		file: new File(["x"], `${id}.mp4`, { type: "video/mp4" }),
	};
}

describe("planMediaImport", () => {
	test("links files that have a path", () => {
		expect(planMediaImport({ path: "D:\\a.mp4" })).toEqual({
			mode: "link",
			sourcePath: "D:\\a.mp4",
		});
	});

	test("copies files without a path", () => {
		expect(planMediaImport({ path: null })).toEqual({ mode: "copy" });
	});
});

describe("isRelinkCompatible", () => {
	test("accepts the same media type", () => {
		expect(
			isRelinkCompatible({ missingAsset: missingVideo, fileType: "video" }),
		).toBe(true);
	});

	test("rejects a different or unknown media type", () => {
		expect(
			isRelinkCompatible({ missingAsset: missingVideo, fileType: "image" }),
		).toBe(false);
		expect(
			isRelinkCompatible({ missingAsset: missingVideo, fileType: null }),
		).toBe(false);
	});
});

describe("applyRelinkedAsset", () => {
	test("moves the asset from missing to loaded", () => {
		const other = asset({ id: "a1" });
		const relinked = asset({ id: "m1" });
		const result = applyRelinkedAsset({
			assets: [other],
			missingAssets: [missingVideo],
			relinked,
		});
		expect(result.assets).toEqual([other, relinked]);
		expect(result.missingAssets).toEqual([]);
	});
});

describe("toMediaAssetData", () => {
	test("drops the missing reason and keeps the link", () => {
		expect(toMediaAssetData({ missingAsset: missingVideo })).toEqual({
			id: "m1",
			name: "clip.mp4",
			type: "video",
			size: 10,
			lastModified: 1,
			sourcePath: "D:\\old\\clip.mp4",
		});
	});
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd /d/OpenCut && bun test apps/web/src/media/__tests__/linked-media.test.ts`
Expected: FAIL, because `@/media/linked-media` can't be resolved.

- [ ] **Step 4: Implement `apps/web/src/media/linked-media.ts`**

```ts
import type { MediaAsset, MediaType } from "@/media/types";
import type {
	MediaAssetData,
	MissingMediaAsset,
} from "@/services/storage/types";

export type MediaImportPlan =
	| { mode: "link"; sourcePath: string }
	| { mode: "copy" };

export function planMediaImport({
	path,
}: {
	path: string | null;
}): MediaImportPlan {
	return path ? { mode: "link", sourcePath: path } : { mode: "copy" };
}

export function isRelinkCompatible({
	missingAsset,
	fileType,
}: {
	missingAsset: MissingMediaAsset;
	fileType: MediaType | null;
}): boolean {
	return fileType === missingAsset.type;
}

export function applyRelinkedAsset({
	assets,
	missingAssets,
	relinked,
}: {
	assets: MediaAsset[];
	missingAssets: MissingMediaAsset[];
	relinked: MediaAsset;
}): { assets: MediaAsset[]; missingAssets: MissingMediaAsset[] } {
	return {
		assets: [...assets.filter((asset) => asset.id !== relinked.id), relinked],
		missingAssets: missingAssets.filter((asset) => asset.id !== relinked.id),
	};
}

export function toMediaAssetData({
	missingAsset,
}: {
	missingAsset: MissingMediaAsset;
}): MediaAssetData {
	const { reason: _reason, ...metadata } = missingAsset;
	return metadata;
}
```

- [ ] **Step 5: Run to verify the tests pass**

Run: `cd /d/OpenCut && bun test apps/web/src/media/__tests__/linked-media.test.ts`
Expected: 6 pass, 0 fail.

- [ ] **Step 6: Storage service — save, load, metadata**

In `apps/web/src/services/storage/service.ts`:

Add imports next to the existing ones:
```ts
import { openLinkedFile } from "@/services/linked-files";
```
and add `MissingMediaAsset` to the existing `import type { ... } from "./types";` list.

In `saveMediaAsset`, in the `metadata` object literal, add after `ephemeral: mediaAsset.ephemeral,`:
```ts
			sourcePath: mediaAsset.sourcePath,
```
and replace:
```ts
			await mediaAssetsAdapter.set({
				key: mediaAsset.id,
				value: mediaAsset.file,
			});
```
with:
```ts
			// Linked assets stay where they are on disk; only metadata is stored.
			if (!mediaAsset.sourcePath) {
				await mediaAssetsAdapter.set({
					key: mediaAsset.id,
					value: mediaAsset.file,
				});
			}
```

Add a new method directly after `saveMediaAsset`:
```ts
	async saveMediaAssetMetadata({
		projectId,
		metadata,
	}: {
		projectId: string;
		metadata: MediaAssetData;
	}): Promise<void> {
		const { mediaMetadataAdapter } = this.getProjectMediaAdapters({
			projectId,
		});
		await mediaMetadataAdapter.set({ key: metadata.id, value: metadata });
	}
```

Replace the whole `loadMediaAsset` method with:
```ts
	async loadMediaAsset({
		projectId,
		id,
	}: {
		projectId: string;
		id: string;
	}): Promise<
		| { kind: "loaded"; asset: MediaAsset }
		| { kind: "missing"; asset: MissingMediaAsset }
		| null
	> {
		const { mediaMetadataAdapter, mediaAssetsAdapter } =
			this.getProjectMediaAdapters({ projectId });

		const metadata = await mediaMetadataAdapter.get(id);
		if (!metadata) return null;

		if (metadata.sourcePath) {
			const result = await openLinkedFile({ path: metadata.sourcePath });
			if (result.status !== "ok") {
				return {
					kind: "missing",
					asset: {
						...metadata,
						sourcePath: metadata.sourcePath,
						reason: result.status,
					},
				};
			}

			return {
				kind: "loaded",
				asset: this.toMediaAsset({
					metadata,
					file: result.file,
					url: URL.createObjectURL(result.file),
				}),
			};
		}

		const file = await mediaAssetsAdapter.get(id);
		if (!file) return null;

		let url: string;
		if (metadata.type === "image" && (!file.type || file.type === "")) {
			try {
				const text = await file.text();
				if (text.trim().startsWith("<svg")) {
					const svgBlob = new Blob([text], { type: "image/svg+xml" });
					url = URL.createObjectURL(svgBlob);
				} else {
					url = URL.createObjectURL(file);
				}
			} catch {
				url = URL.createObjectURL(file);
			}
		} else {
			url = URL.createObjectURL(file);
		}

		return {
			kind: "loaded",
			asset: this.toMediaAsset({ metadata, file, url }),
		};
	}

	private toMediaAsset({
		metadata,
		file,
		url,
	}: {
		metadata: MediaAssetData;
		file: File;
		url: string;
	}): MediaAsset {
		return {
			id: metadata.id,
			name: metadata.name,
			type: metadata.type,
			file,
			url,
			width: metadata.width,
			height: metadata.height,
			duration: metadata.duration,
			thumbnailUrl: metadata.thumbnailUrl,
			ephemeral: metadata.ephemeral,
			sourcePath: metadata.sourcePath,
		};
	}
```

Replace the whole `loadAllMediaAssets` method with:
```ts
	async loadAllMediaAssets({
		projectId,
	}: {
		projectId: string;
	}): Promise<{ assets: MediaAsset[]; missing: MissingMediaAsset[] }> {
		const { mediaMetadataAdapter } = this.getProjectMediaAdapters({
			projectId,
		});

		const mediaIds = await mediaMetadataAdapter.list();
		const assets: MediaAsset[] = [];
		const missing: MissingMediaAsset[] = [];

		for (const id of mediaIds) {
			const result = await this.loadMediaAsset({ projectId, id });
			if (result?.kind === "loaded") assets.push(result.asset);
			if (result?.kind === "missing") missing.push(result.asset);
		}

		return { assets, missing };
	}
```

`deleteMediaAsset` and `deleteProjectMedia` need no change. They only touch IndexedDB metadata and the OPFS directory, whose `remove` ignores `NotFoundError`. They never touch the linked original.

- [ ] **Step 7: Project duplication keeps links and missing assets**

In `apps/web/src/core/managers/project-manager.ts`, add the import:
```ts
import { toMediaAssetData } from "@/media/linked-media";
```
and replace:
```ts
					const sourceMediaAssets = await storageService.loadAllMediaAssets({
						projectId: sourceProjectId,
					});

					await Promise.all(
						sourceMediaAssets.map((mediaAsset) =>
							storageService.saveMediaAsset({
								projectId: newProjectId,
								mediaAsset,
							}),
						),
					);
```
with:
```ts
					const { assets: sourceMediaAssets, missing: sourceMissingAssets } =
						await storageService.loadAllMediaAssets({
							projectId: sourceProjectId,
						});

					await Promise.all([
						...sourceMediaAssets.map((mediaAsset) =>
							storageService.saveMediaAsset({
								projectId: newProjectId,
								mediaAsset,
							}),
						),
						...sourceMissingAssets.map((missingAsset) =>
							storageService.saveMediaAssetMetadata({
								projectId: newProjectId,
								metadata: toMediaAssetData({ missingAsset }),
							}),
						),
					]);
```

- [ ] **Step 8: Media manager — missing list**

In `apps/web/src/core/managers/media-manager.ts`:

Add the import:
```ts
import type { MissingMediaAsset } from "@/services/storage/types";
```

Add a field below `private assets: MediaAsset[] = [];`:
```ts
	private missingAssets: MissingMediaAsset[] = [];
```

In `loadProjectMedia`, replace:
```ts
			const mediaAssets = await storageService.loadAllMediaAssets({
				projectId,
			});
			this.assets = mediaAssets;
			this.notify();
```
with:
```ts
			const { assets, missing } = await storageService.loadAllMediaAssets({
				projectId,
			});
			this.assets = assets;
			this.missingAssets = missing;
			this.notify();

			if (missing.length > 0) {
				toast.warning(
					`${missing.length} media ${missing.length === 1 ? "file is" : "files are"} missing`,
					{
						description:
							'Use "Locate file" in the Assets panel to find them.',
					},
				);
			}
```

In `clearProjectMedia`, replace:
```ts
		const mediaIds = this.assets.map((asset) => asset.id);
		this.assets = [];
		this.notify();
```
with:
```ts
		const mediaIds = [...this.assets, ...this.missingAssets].map(
			(asset) => asset.id,
		);
		this.assets = [];
		this.missingAssets = [];
		this.notify();
```

In `clearAllAssets`, replace:
```ts
		this.assets = [];
		this.notify();
	}
```
with:
```ts
		this.assets = [];
		this.missingAssets = [];
		this.notify();
	}
```

Add a getter directly after `getAssets()`:
```ts
	getMissingAssets(): MissingMediaAsset[] {
		return this.missingAssets;
	}
```

- [ ] **Step 9: Verify and commit**

Run: `cd /d/OpenCut/apps/web && bunx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `0`. If any other caller of `loadAllMediaAssets` or `loadMediaAsset` shows up, update it to the new return shape. `grep -rn "loadAllMediaAssets\|loadMediaAsset(" apps/web/src` should list only `service.ts`, `media-manager.ts` and `project-manager.ts`.

Run: `cd /d/OpenCut && bun test 2>&1 | grep -E "^ *[0-9]+ (pass|fail)"`
Expected: 199 pass, 4 fail.

```bash
cd /d/OpenCut && git add apps/web/src && git commit -q -F - <<'EOF'
feat: store linked media by path and track missing assets

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Task 4: Import links files instead of copying

**Files:**
- Modify: `apps/web/src/media/processing.ts`

**Interfaces:**
- Consumes:
  - `resolveFilePaths` and `openLinkedFile` from `@/services/linked-files` (Task 2);
  - `planMediaImport` from `@/media/linked-media` (Task 3);
  - `ProcessedMediaAsset`, which inherits `sourcePath?: string` from `MediaAsset` (Task 3).
- Produces: `processMediaAssets` returns assets with `sourcePath` set when linked. Callers (assets panel, paste, timeline drop) pass them unchanged to `editor.media.addMediaAsset` → `saveMediaAsset`, which skips the copy (Task 3).

Behaviour is covered by `planMediaImport` tests (Task 3) and the end-to-end check in Task 6. This step is wiring only.

- [ ] **Step 1: Imports**

In `apps/web/src/media/processing.ts`, add:
```ts
import { planMediaImport } from "@/media/linked-media";
import { openLinkedFile, resolveFilePaths } from "@/services/linked-files";
```

- [ ] **Step 2: Add the link helper**

Add above `export async function processMediaAssets`:
```ts
async function linkImportedFile({
	file,
	path,
}: {
	file: File;
	path: string | null;
}): Promise<{ file: File; sourcePath?: string }> {
	const plan = planMediaImport({ path });
	if (plan.mode === "copy") return { file };

	// Confirm the link opens now, so an unsupported runtime falls back to
	// copying instead of producing an asset that is missing on next open.
	const result = await openLinkedFile({ path: plan.sourcePath });
	if (result.status !== "ok") {
		console.warn(`Could not link ${file.name}; copying instead.`, result);
		return { file };
	}

	return { file: result.file, sourcePath: plan.sourcePath };
}
```

- [ ] **Step 3: Use it in `processMediaAssets`**

Replace:
```ts
	for (const file of fileArray) {
		const fileType = getMediaTypeFromFile({ file });

		if (!fileType) {
			toast.error(`Unsupported file type: ${file.name}`);
			continue;
		}

		const storageCheck = await storageService.canStoreFile({
			size: file.size,
		});

		if (!storageCheck.canStore) {
			toast.error(`Not enough browser storage for ${file.name}`, {
				description: getStorageLimitDescription({
					fileSize: file.size,
					availableBytes: storageCheck.availableBytes,
				}),
			});
			continue;
		}
```
with:
```ts
	const paths = await resolveFilePaths({ files: fileArray });

	for (const [index, inputFile] of fileArray.entries()) {
		const fileType = getMediaTypeFromFile({ file: inputFile });

		if (!fileType) {
			toast.error(`Unsupported file type: ${inputFile.name}`);
			continue;
		}

		const { file, sourcePath } = await linkImportedFile({
			file: inputFile,
			path: paths[index] ?? null,
		});

		if (!sourcePath) {
			const storageCheck = await storageService.canStoreFile({
				size: file.size,
			});

			if (!storageCheck.canStore) {
				toast.error(`Not enough browser storage for ${file.name}`, {
					description: getStorageLimitDescription({
						fileSize: file.size,
						availableBytes: storageCheck.availableBytes,
					}),
				});
				continue;
			}
		}
```

In the `processedAssets.push({ ... })` object, add after `hasAudio,`:
```ts
				sourcePath,
```

- [ ] **Step 4: Verify and commit**

Run: `cd /d/OpenCut/apps/web && bunx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `0`.

Run: `cd /d/OpenCut && bun test 2>&1 | grep -E "^ *[0-9]+ (pass|fail)"`
Expected: 199 pass, 4 fail.

Run: `cd /d/OpenCut && bun run build:web 2>&1 | tail -3`
Expected: build succeeds.

```bash
cd /d/OpenCut && git add apps/web/src/media/processing.ts && git commit -q -F - <<'EOF'
feat: link imported media files instead of copying them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Task 5: Relink missing files ("Locate file")

**Files:**
- Modify: `apps/web/src/core/managers/media-manager.ts` (new `relinkMediaAsset`)
- Create: `apps/web/src/components/editor/panels/assets/views/missing-media-list.tsx`
- Modify: `apps/web/src/components/editor/panels/assets/views/assets.tsx` (render the list)

**Interfaces:**
- Consumes:
  - `resolveFilePaths` and `openLinkedFile` (Task 2);
  - `isRelinkCompatible`, `applyRelinkedAsset` and `toMediaAssetData` (Task 3);
  - `storageService.saveMediaAssetMetadata` and `editor.media.getMissingAssets()` (Task 3);
  - `getMediaTypeFromFile` from `@/media/media-utils`.
- Produces: `editor.media.relinkMediaAsset({ projectId, id, file }: { projectId: string; id: string; file: File }): Promise<boolean>`.

The state transition is covered by `applyRelinkedAsset` and `isRelinkCompatible` tests (Task 3). The UI is verified in Task 6.

- [ ] **Step 1: `relinkMediaAsset` in the media manager**

In `apps/web/src/core/managers/media-manager.ts`, add imports:
```ts
import { getMediaTypeFromFile } from "@/media/media-utils";
import {
	applyRelinkedAsset,
	isRelinkCompatible,
	toMediaAssetData,
} from "@/media/linked-media";
import { openLinkedFile, resolveFilePaths } from "@/services/linked-files";
import type { MediaAssetData } from "@/services/storage/types";
```
(`MediaAssetData` can join the existing `import type { MissingMediaAsset } from "@/services/storage/types";` line.)

Add this method directly after `getMissingAssets()`:
```ts
	async relinkMediaAsset({
		projectId,
		id,
		file,
	}: {
		projectId: string;
		id: string;
		file: File;
	}): Promise<boolean> {
		const missingAsset = this.missingAssets.find((asset) => asset.id === id);
		if (!missingAsset) return false;

		if (
			!isRelinkCompatible({
				missingAsset,
				fileType: getMediaTypeFromFile({ file }),
			})
		) {
			toast.error(`${file.name} is not a ${missingAsset.type} file`);
			return false;
		}

		const [path] = await resolveFilePaths({ files: [file] });
		if (!path) {
			toast.error(`Couldn't read the location of ${file.name}`);
			return false;
		}

		const result = await openLinkedFile({ path });
		if (result.status !== "ok") {
			toast.error(`Couldn't open ${file.name}`, {
				description:
					result.status === "error" ? result.message : "File not found",
			});
			return false;
		}

		const metadata: MediaAssetData = {
			...toMediaAssetData({ missingAsset }),
			sourcePath: path,
			size: result.file.size,
			lastModified: result.file.lastModified,
		};

		try {
			await storageService.saveMediaAssetMetadata({ projectId, metadata });
		} catch (error) {
			console.error("Failed to save relinked media:", error);
			toast.error(`Couldn't relink ${missingAsset.name}`);
			return false;
		}

		const next = applyRelinkedAsset({
			assets: this.assets,
			missingAssets: this.missingAssets,
			relinked: {
				...metadata,
				file: result.file,
				url: URL.createObjectURL(result.file),
			},
		});
		this.assets = next.assets;
		this.missingAssets = next.missingAssets;
		this.notify();

		toast.success(`Relinked ${missingAsset.name}`);
		return true;
	}
```

- [ ] **Step 2: Create `missing-media-list.tsx`**

`apps/web/src/components/editor/panels/assets/views/missing-media-list.tsx`:
```tsx
"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useEditor } from "@/editor/use-editor";
import type { MissingMediaAsset } from "@/services/storage/types";

export function MissingMediaList({ projectId }: { projectId: string }) {
	const missingAssets = useEditor((e) => e.media.getMissingAssets());

	if (missingAssets.length === 0) return null;

	return (
		<div className="flex flex-col gap-1.5 border-b px-3 py-2">
			<p className="text-destructive text-xs font-medium">
				{missingAssets.length} missing{" "}
				{missingAssets.length === 1 ? "file" : "files"}
			</p>
			{missingAssets.map((asset) => (
				<MissingMediaRow key={asset.id} asset={asset} projectId={projectId} />
			))}
		</div>
	);
}

function MissingMediaRow({
	asset,
	projectId,
}: {
	asset: MissingMediaAsset;
	projectId: string;
}) {
	const editor = useEditor();
	const inputRef = useRef<HTMLInputElement>(null);
	const [isRelinking, setIsRelinking] = useState(false);

	const handleFileChange = async (
		event: React.ChangeEvent<HTMLInputElement>,
	) => {
		const file = event.target.files?.[0];
		event.target.value = "";
		if (!file) return;

		setIsRelinking(true);
		try {
			await editor.media.relinkMediaAsset({ projectId, id: asset.id, file });
		} finally {
			setIsRelinking(false);
		}
	};

	return (
		<div className="flex items-center gap-2 text-xs" title={asset.sourcePath}>
			<span className="bg-destructive/15 text-destructive rounded-sm px-1.5 py-0.5">
				Missing
			</span>
			<span className="min-w-0 flex-1 truncate">{asset.name}</span>
			<input
				ref={inputRef}
				type="file"
				accept={`${asset.type}/*`}
				className="hidden"
				onChange={handleFileChange}
			/>
			<Button
				size="sm"
				variant="outline"
				disabled={isRelinking}
				onClick={() => inputRef.current?.click()}
			>
				Locate file
			</Button>
		</div>
	);
}
```

- [ ] **Step 3: Render it in the Assets panel**

In `apps/web/src/components/editor/panels/assets/views/assets.tsx`, add the import:
```ts
import { MissingMediaList } from "@/components/editor/panels/assets/views/missing-media-list";
```
and inside `<PanelView ...>`, directly before `{isDragOver || filteredMediaItems.length === 0 ? (`, add:
```tsx
				<MissingMediaList projectId={activeProject.metadata.id} />
```

- [ ] **Step 4: Verify and commit**

Run: `cd /d/OpenCut/apps/web && bunx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `0`.

Run: `cd /d/OpenCut && bun test 2>&1 | grep -E "^ *[0-9]+ (pass|fail)"`
Expected: 199 pass, 4 fail.

Run: `cd /d/OpenCut && bun run build:web 2>&1 | tail -3`
Expected: build succeeds.

```bash
cd /d/OpenCut && git add apps/web/src && git commit -q -F - <<'EOF'
feat: relink missing media with Locate file

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Task 6: Build and verify end-to-end in `rcut.exe`

Manual verification with the user. Fix only what fails, and report before changing design.

**Files:** none unless a check fails.

- [ ] **Step 1: Release build**

Run: `cd /d/OpenCut && bun run build:desktop` (5–15 min; run in background).
Expected: `apps/desktop/src-tauri/target/release/rcut.exe` is rebuilt.

- [ ] **Step 2: User checks in `rcut.exe`**

1. New project → import `D:\Records\Recording_2026-09-30_21-01-10.mp4` (19 GB) via the Import button. Expected: no storage error, the asset appears with a thumbnail, and it plays in the preview.
2. Drag a second recording from Explorer into the Assets panel. Expected: same result.
3. Put a clip on the timeline, cut it, add text, then close and reopen RCut. Expected: the project, assets and edits are intact.
4. Close RCut and rename one recording in Explorer, then reopen the project. Expected: a "1 media file is missing" toast, and a Missing row with "Locate file" in Assets. Click Locate and pick the renamed file. Expected: "Relinked …", and the timeline clip renders again.
5. Remove an asset from the project. Expected: the original file still exists in `D:\Records`.
6. Duplicate the project from the projects page and open the duplicate. Expected: media is still linked with no copy, and there are no missing files.
7. Export an MP4 from the linked 19 GB source (a short range is fine). Expected: the export completes and plays.
8. Paste an image from the clipboard into the editor. Expected: it is imported (copied) as before.
9. Check `%LOCALAPPDATA%\com.rcut.app\EBWebView` size before and after step 1. Expected: no ~19 GB growth.

- [ ] **Step 3: Final checks and commit fixes, if any**

Run: `cd /d/OpenCut && bun test 2>&1 | grep -E "^ *[0-9]+ (pass|fail)"`
Expected: 199 pass, 4 fail.

If fixes were needed:
```bash
cd /d/OpenCut && git add -A && git commit -q -F - <<'EOF'
fix: linked media issues found in exe verification

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```
