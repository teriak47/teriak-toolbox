//! The Rust API alone, without the desktop window, for tests:
//! GRAPHAX_DATA_DIR (required) holds the database, PORT defaults to 3457.

use std::path::PathBuf;

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
    if let Err(err) = graphax_lib::server::serve(&data_dir, port).await {
        eprintln!("[Graphax API Rust] Démarrage impossible : {err}");
        std::process::exit(1);
    }
}
