//! Local HTTP API of the desktop app, the Rust counterpart of `server/` (Node + Hono).
//! Routes are ported here one family at a time; the Node server stays in use until then.

mod db;
mod security;

use std::net::SocketAddr;
use std::path::Path;

use axum::extract::State;
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
}

pub fn router(state: AppState, port: u16) -> Router {
    Router::new()
        .route("/api/health", get(health))
        .with_state(state)
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

/// Opens the database in `data_dir` and serves the API on 127.0.0.1 only
pub async fn serve(
    data_dir: &Path,
    port: u16,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let db = open_db(data_dir).await?;
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!("[Graphax API Rust] Serveur local prêt sur http://{addr}");
    axum::serve(listener, router(AppState { db }, port)).await?;
    Ok(())
}
