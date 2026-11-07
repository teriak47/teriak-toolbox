pub mod server;

use std::sync::Mutex;
use std::time::Duration;

use tauri::{Manager, RunEvent};
use tokio::sync::oneshot;

/// Stops the local API when the app quits, and tells when the database is closed
struct ServerControl {
    stop: Mutex<Option<oneshot::Sender<()>>>,
    stopped: Mutex<Option<oneshot::Receiver<()>>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .setup(|app| {
            // The database and snapshots live in the app data folder (Windows: %APPDATA%,
            // macOS: ~/Library/Application Support, Linux: ~/.local/share, each under
            // com.teriak47.graphax); GRAPHAX_DATA_DIR overrides it. Projects of the browser
            // version come over with their JSON export and "Importer".
            let data_dir = server::resolve_data_dir(app.path().app_data_dir()?);
            let (stop_tx, stop_rx) = oneshot::channel::<()>();
            let (stopped_tx, stopped_rx) = oneshot::channel::<()>();
            app.manage(ServerControl {
                stop: Mutex::new(Some(stop_tx)),
                stopped: Mutex::new(Some(stopped_rx)),
            });
            tauri::async_runtime::spawn(async move {
                let shutdown = async {
                    let _ = stop_rx.await;
                };
                if let Err(err) = server::serve(&data_dir, server::DEFAULT_PORT, shutdown).await {
                    eprintln!("[Graphax API Rust] Démarrage impossible : {err}");
                }
                let _ = stopped_tx.send(());
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Graphax n'a pas pu démarrer");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            // Let the requests under way finish and the database close before quitting
            let control = handle.state::<ServerControl>();
            let stop = control.stop.lock().unwrap().take();
            if let Some(stop) = stop {
                let _ = stop.send(());
            }
            let stopped = control.stopped.lock().unwrap().take();
            if let Some(stopped) = stopped {
                tauri::async_runtime::block_on(async {
                    let _ = tokio::time::timeout(Duration::from_secs(10), stopped).await;
                });
            }
        }
    });
}
