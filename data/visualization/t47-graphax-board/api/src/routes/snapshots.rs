//! Port of server/routes/snapshots.ts

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{delete, get, post};
use axum::Router;
use serde_json::{json, Value};

use crate::bundles::import_project_bundle;
use crate::guards::project_exists;
use crate::http::{created, ok, ApiError, ApiResult};
use crate::model::map_project;
use crate::snapshots::{
    create_snapshot, delete_snapshot, is_project_id, is_snapshot_name, list_snapshots,
    read_snapshot, SnapshotError,
};
use crate::util::{from_db, js_string, params, record_id};
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/projects/{id}/snapshots", get(list).post(take))
        .route("/api/projects/{id}/snapshots/{name}/restore", post(restore))
        .route("/api/projects/{id}/snapshots/{name}", delete(remove))
}

impl From<SnapshotError> for ApiError {
    fn from(err: SnapshotError) -> Self {
        match err {
            SnapshotError::Db(e) => e.into(),
            SnapshotError::Io(e) => e.into(),
        }
    }
}

impl From<std::io::Error> for ApiError {
    fn from(err: std::io::Error) -> Self {
        eprintln!("[Graphax API Error] {err}");
        Self(StatusCode::INTERNAL_SERVER_ERROR, err.to_string())
    }
}

fn not_found_project() -> ApiError {
    ApiError::not_found("Projet introuvable.")
}

fn not_found_snapshot() -> ApiError {
    ApiError::not_found("Instantané introuvable.")
}

// List a project's snapshots, newest first
async fn list(State(state): State<AppState>, Path(project_id): Path<String>) -> ApiResult {
    if !is_project_id(&project_id) || !project_exists(&state.db, &project_id).await? {
        return Err(not_found_project());
    }
    ok(json!({ "snapshots": list_snapshots(&state.data_dir, &project_id)? }))
}

// Take a snapshot now
async fn take(State(state): State<AppState>, Path(project_id): Path<String>) -> ApiResult {
    if !is_project_id(&project_id) {
        return Err(not_found_project());
    }
    match create_snapshot(&state.db, &state.data_dir, &project_id, "manual").await? {
        Some(snapshot) => created(json!({ "snapshot": snapshot })),
        None => Err(not_found_project()),
    }
}

/// `toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })` in local time
fn french_short_date(iso: Option<&str>) -> String {
    let date = iso
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.with_timezone(&chrono::Local))
        .unwrap_or_else(chrono::Local::now);
    date.format("%d/%m/%Y %H:%M").to_string()
}

// Restore a snapshot as a new project; the current project is left as it is
async fn restore(
    State(state): State<AppState>,
    Path((project_id, name)): Path<(String, String)>,
) -> ApiResult {
    if !is_project_id(&project_id) || !is_snapshot_name(&name) {
        return Err(not_found_snapshot());
    }
    let Some(Value::Object(bundle)) = read_snapshot(&state.data_dir, &project_id, &name)? else {
        return Err(not_found_snapshot());
    };

    let mut res = state
        .db
        .query("SELECT * FROM ONLY $pid;")
        .bind(params(vec![("pid", record_id("project", &project_id))]))
        .await?
        .check()?;
    let current_name = match from_db(res.take(0)?) {
        Value::Object(current) => js_string(map_project(&current).get("name"), ""),
        _ => String::new(),
    };
    let bundle_name = js_string(bundle.get("project").and_then(|p| p.get("name")), "");
    let source_name = [current_name, bundle_name]
        .into_iter()
        .find(|n| !n.is_empty())
        .unwrap_or_else(|| "Projet".into());

    let snapshots = list_snapshots(&state.data_dir, &project_id)?;
    let created_at = snapshots
        .iter()
        .find(|s| s["name"] == name.as_str())
        .and_then(|s| s["createdAt"].as_str());
    let label = french_short_date(created_at);

    match import_project_bundle(
        &state.db,
        &bundle,
        Some(format!("{source_name} (instantané du {label})")),
    )
    .await?
    {
        Some(project) => created(json!({ "project": project })),
        None => Err(ApiError::bad_request("Instantané illisible.")),
    }
}

async fn remove(
    State(state): State<AppState>,
    Path((project_id, name)): Path<(String, String)>,
) -> ApiResult {
    if !is_project_id(&project_id) || !delete_snapshot(&state.data_dir, &project_id, &name) {
        return Err(not_found_snapshot());
    }
    ok(json!({ "deleted": true }))
}
