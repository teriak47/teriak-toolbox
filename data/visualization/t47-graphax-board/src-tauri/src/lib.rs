use std::sync::{Arc, Mutex};
use std::time::Duration;

use graphax_api as server;
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::oneshot;

/// Stops the local API when the app quits, and tells when the database is closed
struct ServerControl {
    stop: Mutex<Option<oneshot::Sender<()>>>,
    stopped: Mutex<Option<oneshot::Receiver<()>>>,
}

/// A page shown in the window when the app cannot start
fn error_page(message: &str) -> WebviewUrl {
    let escaped = message
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");
    let html = format!(
        "<!doctype html><meta charset=utf-8><title>Graphax</title>\
         <body style=\"font-family:sans-serif;background:#16181d;color:#e8e4dc;padding:2rem\">\
         <h1>Graphax n'a pas pu démarrer</h1><p>{escaped}</p>\
         <p>Graphax est peut-être déjà ouvert, ou un autre programme utilise son port ou sa base.</p>"
    );
    let encoded: String = html
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect();
    WebviewUrl::External(
        format!("data:text/html;charset=utf-8,{encoded}")
            .parse()
            .expect("data URL"),
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // A second launch brings the open window to the front instead of starting again
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            // The database and snapshots live in the app data folder (Windows: %APPDATA%,
            // macOS: ~/Library/Application Support, Linux: ~/.local/share, each under
            // com.teriak47.graphax); GRAPHAX_DATA_DIR overrides it. Projects of the browser
            // version come over with their JSON export and "Importer".
            let data_dir = server::resolve_data_dir(app.path().app_data_dir()?);

            // In development the window loads the Vite server, which forwards /api to the
            // port of browser mode; the built app serves its embedded interface itself
            let dev = tauri::is_dev();
            let port = if dev {
                server::BROWSER_PORT
            } else {
                server::DESKTOP_PORT
            };
            let handle = app.handle().clone();
            let assets: server::AssetFn = Arc::new(move |path: &str| {
                handle
                    .asset_resolver()
                    .get(path.to_string())
                    .map(|asset| (asset.bytes().to_vec(), asset.mime_type().to_string()))
            });
            let frontend = server::Frontend::Embedded(assets);

            let url = match tauri::async_runtime::block_on(server::bind(&data_dir, port, frontend))
            {
                Ok(bound) => {
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
                        if let Err(err) = bound.run(shutdown).await {
                            eprintln!("[Graphax API] Arrêt sur erreur : {err}");
                        }
                        let _ = stopped_tx.send(());
                    });
                    if dev {
                        WebviewUrl::App("index.html".into())
                    } else {
                        WebviewUrl::External(format!("http://127.0.0.1:{port}/").parse()?)
                    }
                }
                Err(err) => {
                    eprintln!("[Graphax API] Démarrage impossible : {err}");
                    error_page(&err.to_string())
                }
            };

            WebviewWindowBuilder::new(app, "main", url)
                .title("Graphax")
                .inner_size(1440.0, 900.0)
                .min_inner_size(960.0, 600.0)
                .center()
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Graphax n'a pas pu démarrer");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            // Let the requests under way finish and the database close before quitting
            let Some(control) = handle.try_state::<ServerControl>() else {
                return;
            };
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
