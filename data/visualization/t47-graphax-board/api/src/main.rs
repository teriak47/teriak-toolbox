//! Browser mode: the API and the interface (`dist/`, built by `pnpm build`) on
//! http://127.0.0.1:3456, as the former Node server. Ctrl+C or SIGTERM stops it cleanly.
//!
//! - GRAPHAX_DATA_DIR: database and snapshots folder (default: `data/` in the tool folder)
//! - GRAPHAX_DIST_DIR: interface folder (default: `dist/` in the tool folder)
//! - PORT: port (default 3456)

use std::path::{Path, PathBuf};

use graphax_api::{self as server, legacy, Frontend};

/// The tool folder (data/visualization/t47-graphax-board), parent of src-tauri
fn tool_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_default()
}

fn dir_from_env(name: &str, default: PathBuf) -> PathBuf {
    match std::env::var(name) {
        Ok(dir) if !dir.trim().is_empty() => PathBuf::from(dir.trim()),
        _ => default,
    }
}

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
    let tool_dir = tool_dir();
    let data_dir = dir_from_env("GRAPHAX_DATA_DIR", tool_dir.join("data"));
    let dist_dir = dir_from_env("GRAPHAX_DIST_DIR", tool_dir.join("dist"));
    let port = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(server::BROWSER_PORT);

    let mut start_dirs = vec![tool_dir.clone()];
    if let Ok(cwd) = std::env::current_dir() {
        start_dirs.insert(0, cwd);
    }
    legacy::recover_legacy_database(&data_dir.join("graphax.db"), &start_dirs);

    let frontend = if dist_dir.join("index.html").exists() {
        Frontend::Dir(dist_dir)
    } else {
        eprintln!(
            "[Graphax] Interface introuvable dans {} : lancez `pnpm build` (l'API répond quand même).",
            dist_dir.display()
        );
        Frontend::None
    };
    if let Err(err) = server::serve(&data_dir, port, frontend, stop_signal()).await {
        eprintln!("[Graphax API] Démarrage impossible : {err}");
        std::process::exit(1);
    }
}
