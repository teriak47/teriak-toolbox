//! Local HTTP API of Graphax (it replaced the former Node + Hono server). It also serves the
//! interface: from the app's embedded files in the desktop app, from `dist/` in browser mode.

pub mod bulk;
mod bundles;
mod db;
mod frontend;
mod guards;
mod http;
pub mod legacy;
mod model;
mod presets;
mod routes;
mod security;
pub mod snapshots;
mod util;

use std::future::Future;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::time::Duration;

use axum::extract::{DefaultBodyLimit, State};
use axum::routing::get;
use axum::{middleware, Json, Router};
use serde_json::{json, Value};
use surrealdb::engine::local::Db;
use surrealdb::Surreal;
use tokio::task::JoinHandle;

pub use db::open_db;

/// Version of the tool, kept equal to package.json by a test
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Port of browser mode (`graphax-api`), the one of the former Node server, so the address
/// and the browser's storage for it stay the same
pub const BROWSER_PORT: u16 = 3456;
/// Port of the desktop app, so it can run next to browser mode
pub const DESKTOP_PORT: u16 = 3457;

pub use frontend::{AssetFn, Frontend};

#[derive(Clone)]
pub struct AppState {
    pub db: Surreal<Db>,
    /// Holds the database and the project snapshots
    pub data_dir: PathBuf,
    /// Where the interface comes from
    pub frontend: Frontend,
}

impl AppState {
    /// The API alone, without the interface
    pub fn new(db: Surreal<Db>, data_dir: PathBuf) -> Self {
        Self {
            db,
            data_dir,
            frontend: Frontend::None,
        }
    }
}

pub fn router(state: AppState, port: u16) -> Router {
    Router::new()
        .route("/api/health", get(health))
        .merge(routes::projects::router())
        .merge(routes::categories::router())
        .merge(routes::nodes::router())
        .merge(routes::edges::router())
        .merge(routes::presets::router())
        .merge(routes::restore::router())
        .merge(routes::snapshots::router())
        .fallback(frontend::serve_frontend)
        .with_state(state)
        // Bodies are read and limited by `request_size_limit`, which answers in JSON
        .layer(DefaultBodyLimit::disable())
        .layer(middleware::from_fn(http::request_size_limit))
        .layer(middleware::from_fn_with_state(
            security::Allowed::new(port),
            security::local_only_guard,
        ))
}

async fn health(State(state): State<AppState>) -> Json<Value> {
    // Touching the database proves it is open, as `getDb()` does on the Node side
    let _ = state.db.version().await;
    Json(json!({
        "ok": true,
        "version": APP_VERSION,
        "engine": "surrealdb-embedded-surrealkv",
    }))
}

/// Folder of the database and snapshots: GRAPHAX_DATA_DIR when set (as for the Node
/// server), otherwise `default`, the app data folder of the desktop app
pub fn resolve_data_dir(default: PathBuf) -> PathBuf {
    match std::env::var("GRAPHAX_DATA_DIR") {
        Ok(dir) if !dir.trim().is_empty() => PathBuf::from(dir.trim()),
        _ => default,
    }
}

/// Interval of the automatic snapshots from GRAPHAX_AUTO_SNAPSHOT_MINUTES (30 when unset);
/// 0, a negative value or anything that is not a number turns them off
pub fn auto_snapshot_interval(value: Option<&str>) -> Option<Duration> {
    let minutes: f64 = match value {
        None => 30.0,
        Some(v) => v.trim().parse().ok()?,
    };
    (minutes.is_finite() && minutes > 0.0).then(|| Duration::from_secs_f64(minutes * 60.0))
}

// Automatic snapshots of changed projects: a first pass shortly after start, then at the
// chosen interval
fn spawn_auto_snapshots(db: Surreal<Db>, data_dir: PathBuf) -> Option<JoinHandle<()>> {
    let interval = auto_snapshot_interval(
        std::env::var("GRAPHAX_AUTO_SNAPSHOT_MINUTES")
            .ok()
            .as_deref(),
    )?;
    Some(tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(60)).await;
        loop {
            match snapshots::run_auto_snapshots(&db, &data_dir).await {
                Ok(done) if !done.is_empty() => {
                    println!(
                        "[Graphax] Instantanés automatiques : {} projet(s).",
                        done.len()
                    )
                }
                Ok(_) => {}
                Err(err) => eprintln!("[Graphax] Instantanés automatiques impossibles : {err}"),
            }
            tokio::time::sleep(interval).await;
        }
    }))
}

/// Waits until the database file is no longer locked: SurrealDB shuts its storage down in
/// the background once the last handle is dropped, and quitting before it is done would
/// cut that short
async fn wait_until_closed(db_file: &Path, timeout: Duration) -> bool {
    use fs2::FileExt;
    let lock = db_file.join("LOCK");
    let start = std::time::Instant::now();
    loop {
        let released = match std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&lock)
        {
            Ok(file) => file.try_lock_exclusive().is_ok() && FileExt::unlock(&file).is_ok(),
            Err(_) => true,
        };
        if released {
            return true;
        }
        if start.elapsed() >= timeout {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

/// The API bound to its port, ready to serve
pub struct Server {
    listener: tokio::net::TcpListener,
    state: AppState,
    port: u16,
}

/// Opens the database in `data_dir` and binds 127.0.0.1:`port`; an error when the database
/// is in use or the port is taken
pub async fn bind(
    data_dir: &Path,
    port: u16,
    frontend: Frontend,
) -> Result<Server, Box<dyn std::error::Error + Send + Sync>> {
    let db = open_db(data_dir).await?;
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!("[Graphax API] Serveur local prêt sur http://{addr}");
    let state = AppState {
        db,
        data_dir: data_dir.to_path_buf(),
        frontend,
    };
    Ok(Server {
        listener,
        state,
        port,
    })
}

impl Server {
    /// Serves until `shutdown` completes, then lets the requests under way finish and
    /// closes the database
    pub async fn run(
        self,
        shutdown: impl Future<Output = ()> + Send + 'static,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let Server {
            listener,
            state,
            port,
        } = self;
        let data_dir = state.data_dir.clone();
        let snapshot_task = spawn_auto_snapshots(state.db.clone(), data_dir.clone());
        let served = axum::serve(listener, router(state, port))
            .with_graceful_shutdown(shutdown)
            .await;

        if let Some(task) = snapshot_task {
            task.abort();
            let _ = task.await;
        }
        // The router, and with it the last database handle, is dropped at this point
        if wait_until_closed(&data_dir.join("graphax.db"), Duration::from_secs(5)).await {
            println!("[Graphax DB] Connexion SurrealDB fermée proprement.");
        } else {
            eprintln!("[Graphax DB] La base ne s'est pas fermée à temps.");
        }
        served?;
        Ok(())
    }
}

/// `bind` then `run`
pub async fn serve(
    data_dir: &Path,
    port: u16,
    frontend: Frontend,
    shutdown: impl Future<Output = ()> + Send + 'static,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    bind(data_dir, port, frontend).await?.run(shutdown).await
}
