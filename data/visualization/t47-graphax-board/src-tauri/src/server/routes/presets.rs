//! Port of server/routes/presets.ts: presets saved by the user, a project's categories
//! offered when creating a project

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::routing::{delete, get, post};
use axum::Router;
use serde_json::{json, Value};

use crate::server::guards::project_exists;
use crate::server::http::{created, ok, read_body, ApiError, ApiResult};
use crate::server::model::{map_category, rows, sort_category_records};
use crate::server::presets::{load_user_preset, map_preset};
use crate::server::util::{
    from_db, generate_id, js_slice, now_iso, opt_string, params, record_id, to_db,
};
use crate::server::AppState;

const MAX_PRESET_NAME_LENGTH: usize = 80;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/presets", get(list))
        .route("/api/projects/{id}/presets", post(save))
        .route("/api/presets/{id}", delete(remove))
}

async fn list(State(state): State<AppState>) -> ApiResult {
    let mut res = state
        .db
        .query("SELECT * FROM user_preset ORDER BY createdAt;")
        .await?
        .check()?;
    let presets: Vec<Value> = rows(from_db(res.take(0)?)).iter().map(map_preset).collect();
    ok(json!({ "presets": presets }))
}

// Saves the project's categories (in their order) as a new preset
async fn save(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    body: Bytes,
) -> ApiResult {
    let body = read_body(&body)?;
    let name = js_slice(
        opt_string(body.get("name")).unwrap_or("").trim(),
        MAX_PRESET_NAME_LENGTH,
    )
    .trim()
    .to_string();
    if name.is_empty() {
        return Err(ApiError::bad_request("Nom du preset attendu."));
    }
    let db = &state.db;
    if !project_exists(db, &project_id).await? {
        return Err(ApiError::not_found("Projet introuvable."));
    }
    let mut res = db
        .query("SELECT * FROM category WHERE projectId = $projectId;")
        .bind(params(vec![("projectId", to_db(json!(project_id)))]))
        .await?
        .check()?;
    let categories: Vec<Value> = sort_category_records(rows(from_db(res.take(0)?)))
        .iter()
        .map(map_category)
        .map(|c| {
            json!({
                "name": c["name"], "color": c["color"], "icon": c["icon"],
                "shape": c["shape"], "metadataKeys": c["metadataKeys"], "cardKeys": c["cardKeys"],
            })
        })
        .collect();
    if categories.is_empty() {
        return Err(ApiError::bad_request("Ce projet n’a aucune catégorie."));
    }

    let id = generate_id();
    let created_at = now_iso();
    db.query("CREATE $id CONTENT $content;")
        .bind(params(vec![
            ("id", record_id("user_preset", &id)),
            (
                "content",
                to_db(json!({ "name": name, "categories": categories, "createdAt": created_at })),
            ),
        ]))
        .await?
        .check()?;
    created(
        json!({ "preset": { "id": id, "name": name, "categories": categories, "createdAt": created_at } }),
    )
}

async fn remove(State(state): State<AppState>, Path(id): Path<String>) -> ApiResult {
    let Some(preset) = load_user_preset(&state.db, &id).await? else {
        return Err(ApiError::not_found("Preset introuvable."));
    };
    let preset_id = preset["id"].as_str().unwrap_or_default().to_string();
    state
        .db
        .query("DELETE $id;")
        .bind(params(vec![("id", record_id("user_preset", &preset_id))]))
        .await?
        .check()?;
    ok(json!({ "deleted": true }))
}
