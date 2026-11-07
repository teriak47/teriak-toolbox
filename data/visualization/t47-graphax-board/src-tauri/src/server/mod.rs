//! Local HTTP API of the desktop app, the Rust counterpart of `server/` (Node + Hono).
//! Routes are ported here one family at a time; the Node server stays in use until then.

mod bulk;
mod bundles;
mod db;
mod guards;
mod http;
mod model;
mod presets;
mod routes;
mod security;
pub mod snapshots;
mod util;

use std::net::SocketAddr;
use std::path::{Path, PathBuf};

use axum::extract::{DefaultBodyLimit, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{middleware, Json, Router};
use serde_json::{json, Value};
use surrealdb::engine::local::Db;
use surrealdb::Surreal;

pub use db::open_db;

/// Version of the tool, kept equal to package.json by a test
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Port of the Rust API while it runs next to the Node one (3456)
pub const DEFAULT_PORT: u16 = 3457;

#[derive(Clone)]
pub struct AppState {
    pub db: Surreal<Db>,
    /// Holds the database and the project snapshots
    pub data_dir: PathBuf,
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
        .fallback(not_ported)
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

// While the migration is under way, a route missing here answers 501 rather than 404,
// so that a test expecting a 404 cannot pass only because the route is not ported yet
async fn not_ported() -> impl IntoResponse {
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(json!({ "error": "Route pas encore portée dans l'API Rust." })),
    )
}

/// Folder of the database and snapshots: GRAPHAX_DATA_DIR when set (as for the Node
/// server), otherwise `default`, the app data folder of the desktop app
pub fn resolve_data_dir(default: PathBuf) -> PathBuf {
    match std::env::var("GRAPHAX_DATA_DIR") {
        Ok(dir) if !dir.trim().is_empty() => PathBuf::from(dir.trim()),
        _ => default,
    }
}

/// Opens the database in `data_dir` and serves the API on 127.0.0.1 only
pub async fn serve(
    data_dir: &Path,
    port: u16,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let db = open_db(data_dir).await?;
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!("[Graphax API Rust] Serveur local prêt sur http://{addr}");
    let state = AppState {
        db,
        data_dir: data_dir.to_path_buf(),
    };
    axum::serve(listener, router(state, port)).await?;
    Ok(())
}
