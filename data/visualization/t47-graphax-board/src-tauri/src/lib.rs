pub mod server;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // The Rust API runs next to the Node one during the migration, with its own
            // database in the app data folder so the two never open the same file
            let data_dir = app.path().app_data_dir()?;
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
