//! The Rust API alone, without the desktop window, for tests:
//! GRAPHAX_DATA_DIR (required) holds the database, PORT defaults to 3457.
//! Ctrl+C or SIGTERM stops it cleanly.

use std::path::PathBuf;

async fn stop_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        let mut term = signal(SignalKind::terminate()).expect("SIGTERM handler");
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {}
            _ = term.recv() => {}
        }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}

#[tokio::main]
async fn main() {
    let Some(data_dir) = std::env::var_os("GRAPHAX_DATA_DIR").map(PathBuf::from) else {
        eprintln!("GRAPHAX_DATA_DIR est requis.");
        std::process::exit(2);
    };
    let port = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(graphax_lib::server::DEFAULT_PORT);
    if let Err(err) = graphax_lib::server::serve(&data_dir, port, stop_signal()).await {
        eprintln!("[Graphax API Rust] Démarrage impossible : {err}");
        std::process::exit(1);
    }
}
