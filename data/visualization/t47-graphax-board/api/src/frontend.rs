//! The interface (the built React app): what is not an API route is a file of it, and any
//! other path gets index.html so the app can handle it, as the former Node server did.

use std::path::{Component, PathBuf};
use std::sync::Arc;

use axum::extract::{Request, State};
use axum::http::{header, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

use super::AppState;

/// Gives a file of the interface (bytes and media type) from its path, such as "index.html"
pub type AssetFn = Arc<dyn Fn(&str) -> Option<(Vec<u8>, String)> + Send + Sync>;

#[derive(Clone)]
pub enum Frontend {
    /// API only (tests)
    None,
    /// Files of a folder, normally `dist/` (browser mode)
    Dir(PathBuf),
    /// Files embedded in the desktop app
    Embedded(AssetFn),
}

impl Frontend {
    fn get(&self, path: &str) -> Option<(Vec<u8>, String)> {
        match self {
            Frontend::None => None,
            Frontend::Embedded(get) => get(path),
            Frontend::Dir(dir) => {
                // Only plain names inside the folder, never "..", a root or a drive
                let relative = PathBuf::from(path);
                if !relative
                    .components()
                    .all(|c| matches!(c, Component::Normal(_)))
                {
                    return None;
                }
                let file = dir.join(&relative);
                let bytes = std::fs::read(&file).ok()?;
                let mime = mime_guess::from_path(&file)
                    .first_or_octet_stream()
                    .to_string();
                Some((bytes, mime))
            }
        }
    }
}

pub async fn serve_frontend(State(state): State<AppState>, req: Request) -> Response {
    let path = req.uri().path();
    if path == "/api" || path.starts_with("/api/") {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Route inconnue." })),
        )
            .into_response();
    }
    if req.method() != Method::GET && req.method() != Method::HEAD {
        return StatusCode::NOT_FOUND.into_response();
    }
    let wanted = path.trim_start_matches('/');
    let asset = Some(wanted)
        .filter(|p| !p.is_empty())
        .and_then(|p| state.frontend.get(p))
        .or_else(|| state.frontend.get("index.html"));
    match asset {
        Some((bytes, mime)) => ([(header::CONTENT_TYPE, mime)], bytes).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}
