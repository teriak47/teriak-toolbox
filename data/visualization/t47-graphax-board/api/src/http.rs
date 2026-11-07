//! Errors, JSON bodies and request size limits (server/validation.ts and the error handler
//! of server/app.ts)

use axum::body::{to_bytes, Body, Bytes};
use axum::extract::Request;
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::Json as AxumJson;
use serde_json::{json, Value};

use super::util::Json;

pub const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;
pub const MAX_IMPORT_BYTES: usize = 50 * 1024 * 1024;

#[derive(Debug)]
pub struct ApiError(pub StatusCode, pub String);

pub type ApiResult = Result<Response, ApiError>;

impl ApiError {
    pub fn bad_request(message: &str) -> Self {
        Self(StatusCode::BAD_REQUEST, message.into())
    }
    pub fn not_found(message: &str) -> Self {
        Self(StatusCode::NOT_FOUND, message.into())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, AxumJson(json!({ "error": self.1 }))).into_response()
    }
}

impl From<surrealdb::Error> for ApiError {
    fn from(err: surrealdb::Error) -> Self {
        eprintln!("[Graphax API Error] {err}");
        Self(StatusCode::INTERNAL_SERVER_ERROR, err.to_string())
    }
}

pub fn ok(value: Value) -> ApiResult {
    Ok(AxumJson(value).into_response())
}

pub fn created(value: Value) -> ApiResult {
    Ok((StatusCode::CREATED, AxumJson(value)).into_response())
}

/// `readBody()`: a JSON object, otherwise a 400
pub fn read_body(bytes: &Bytes) -> Result<Json, ApiError> {
    let parsed: Value = serde_json::from_slice(bytes)
        .map_err(|_| ApiError::bad_request("Corps de requête JSON invalide."))?;
    match parsed {
        Value::Object(o) => Ok(o),
        _ => Err(ApiError::bad_request("Un objet JSON est attendu.")),
    }
}

fn is_large_body_path(path: &str) -> bool {
    // An import and an undo restoring a large deletion can carry a whole graph
    if path == "/api/projects/import" {
        return true;
    }
    let parts: Vec<&str> = path.split('/').collect();
    matches!(parts.as_slice(), ["", "api", "projects", id, "restore"] if !id.is_empty())
}

/// Ordinary edits stay small, a project import can be large
pub async fn request_size_limit(req: Request, next: Next) -> Response {
    if !req.uri().path().starts_with("/api/") {
        return next.run(req).await;
    }
    let limit = if is_large_body_path(req.uri().path()) {
        MAX_IMPORT_BYTES
    } else {
        MAX_BODY_BYTES
    };
    let (parts, body) = req.into_parts();
    match to_bytes(body, limit).await {
        Ok(bytes) => {
            next.run(Request::from_parts(parts, Body::from(bytes)))
                .await
        }
        Err(_) => (
            StatusCode::PAYLOAD_TOO_LARGE,
            AxumJson(json!({ "error": "Requête trop volumineuse." })),
        )
            .into_response(),
    }
}
