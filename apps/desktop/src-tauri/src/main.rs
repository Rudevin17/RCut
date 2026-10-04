// Hide the console window in release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod export_files;
mod linked_files;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(export_files::ExportStreams::default())
        .invoke_handler(tauri::generate_handler![
            linked_files::open_linked_file,
            export_files::export_stream_open,
            export_files::export_stream_write,
            export_files::export_stream_finish,
            export_files::export_stream_abort,
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
