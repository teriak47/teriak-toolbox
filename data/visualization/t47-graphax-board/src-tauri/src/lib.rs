pub mod server;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // The database and snapshots live in the app data folder (Windows: %APPDATA%,
            // macOS: ~/Library/Application Support, Linux: ~/.local/share, each under
            // com.teriak47.graphax); GRAPHAX_DATA_DIR overrides it. Projects of the browser
            // version come over with their JSON export and "Importer".
            let data_dir = server::resolve_data_dir(app.path().app_data_dir()?);
            tauri::async_runtime::spawn(async move {
                if let Err(err) = server::serve(&data_dir, server::DEFAULT_PORT).await {
                    eprintln!("[Graphax API Rust] Démarrage impossible : {err}");
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Graphax n'a pas pu démarrer");
}
