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
use windows::core::{IUnknown, Interface, HRESULT, HSTRING, PCWSTR, PWSTR};

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

            let paths = read_file_paths(&args).unwrap_or_else(|error| {
                eprintln!("[linked-files] failed to read file paths: {error:?}");
                Vec::new()
            });
            let response = json!({
                "type": RESOLVED_PATHS,
                "requestId": request["requestId"],
                "paths": paths,
            });
            let response = HSTRING::from(response.to_string());
            if let Err(error) = sender.PostWebMessageAsJson(PCWSTR(response.as_ptr())) {
                eprintln!("[linked-files] failed to post resolved paths: {error:?}");
                return Err(error);
            }
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
