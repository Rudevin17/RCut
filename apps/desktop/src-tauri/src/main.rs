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
