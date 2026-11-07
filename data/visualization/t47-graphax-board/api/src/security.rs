//! Port of server/security.ts: the API only answers the app itself.

use std::collections::HashSet;

use axum::extract::{Request, State};
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

const DEV_CLIENT_PORT: u16 = 5173;

#[derive(Clone)]
pub struct Allowed {
    hosts: HashSet<String>,
    origins: HashSet<String>,
}

impl Allowed {
    pub fn new(port: u16) -> Self {
        // Rejecting any other Host header stops DNS rebinding, where a hostile site
        // resolves its own name to 127.0.0.1 to reach the local server
        let hosts = [format!("127.0.0.1:{port}"), format!("localhost:{port}")].into();

        // The app itself, the Vite dev server, and GRAPHAX_ALLOWED_ORIGINS (comma-separated)
        let mut origins: HashSet<String> = [
            format!("http://127.0.0.1:{port}"),
            format!("http://localhost:{port}"),
            format!("http://127.0.0.1:{DEV_CLIENT_PORT}"),
            format!("http://localhost:{DEV_CLIENT_PORT}"),
        ]
        .into();
        if let Ok(extra) = std::env::var("GRAPHAX_ALLOWED_ORIGINS") {
            origins.extend(
                extra
                    .split(',')
                    .map(str::trim)
                    .filter(|o| !o.is_empty())
                    .map(String::from),
            );
        }

        Self { hosts, origins }
    }
}

fn forbidden(message: &str) -> Response {
    (StatusCode::FORBIDDEN, Json(json!({ "error": message }))).into_response()
}

/// No CORS headers are ever sent, so other sites cannot read responses. This guard also
/// refuses their requests outright, because "simple" cross-site POSTs would otherwise
/// still reach the handlers and modify data.
pub async fn local_only_guard(
    State(allowed): State<Allowed>,
    req: Request,
    next: Next,
) -> Response {
    if let Some(message) = refusal(&allowed, &req) {
        return forbidden(message);
    }
    next.run(req).await
}

fn refusal(allowed: &Allowed, req: &Request) -> Option<&'static str> {
    let header = |name: &str| req.headers().get(name).and_then(|v| v.to_str().ok());

    let host = header("host").unwrap_or_default().to_ascii_lowercase();
    if !allowed.hosts.contains(&host) {
        return Some("Hôte non autorisé.");
    }

    match header("origin") {
        Some(origin) if !allowed.origins.contains(origin) => Some("Origine non autorisée."),
        None if header("sec-fetch-site") == Some("cross-site") => {
            Some("Requête inter-sites non autorisée.")
        }
        _ => None,
    }
}
