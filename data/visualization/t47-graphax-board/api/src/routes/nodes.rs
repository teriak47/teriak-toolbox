//! Port of server/routes/nodes.ts

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::routing::{patch, post};
use axum::Router;
use serde_json::{json, Map, Value};
use surrealdb::types::Value as DbValue;

use crate::guards::{category_in_project, nodes_in_project, project_exists, touch_project};
use crate::http::{created, ok, read_body, ApiError, ApiResult};
use crate::model::{map_node, normalize_reliability, sanitize_metadata};
use crate::util::{
    from_db, generate_id, js_number, js_string, json_number, now_iso, opt_string, params,
    record_id, to_db, to_db_object, truthy, Json,
};
use crate::AppState;

/// Most records (nodes plus links) one undo can bring back in a single restore
pub const MAX_RESTORE_RECORDS: usize = 5000;

const UNKNOWN_CATEGORY: &str = "Cette catégorie n'existe pas dans ce projet.";
const INVALID_RELIABILITY: &str =
    "Fiabilité invalide : une lettre A à F suivie d’un chiffre 1 à 6 est attendue (ex. B2).";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/projects/{id}/nodes", post(create))
        .route("/api/projects/{id}/nodes/delete", post(delete_many))
        .route("/api/projects/{id}/positions", patch(move_many))
        .route("/api/nodes/{id}", patch(update).delete(remove))
        .route("/api/nodes/{id}/position", patch(move_one))
}

/// A reliability sent by the client: None when absent, Some(null) to clear it,
/// an error when invalid
fn read_reliability(value: Option<&Value>) -> Result<Option<Value>, ApiError> {
    match value {
        None => Ok(None),
        Some(Value::Null) => Ok(Some(Value::Null)),
        Some(Value::String(s)) if s.is_empty() => Ok(Some(Value::Null)),
        Some(v) => match normalize_reliability(Some(v)) {
            Value::Null => Err(ApiError::bad_request(INVALID_RELIABILITY)),
            code => Ok(Some(code)),
        },
    }
}

/// `Number(x)` when finite
fn finite(value: Option<&Value>) -> Option<f64> {
    Some(js_number(value)).filter(|n| n.is_finite())
}

// Create a node on the canvas
async fn create(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    body: Bytes,
) -> ApiResult {
    let body = read_body(&body)?;
    let reliability = read_reliability(body.get("reliability"))?;
    let db = &state.db;
    if !project_exists(db, &project_id).await? {
        return Err(ApiError::not_found("Projet introuvable."));
    }
    let category_id = truthy(body.get("categoryId")).then(|| js_string(body.get("categoryId"), ""));
    if let Some(cid) = &category_id {
        if !category_in_project(db, &project_id, cid).await? {
            return Err(ApiError::bad_request(UNKNOWN_CATEGORY));
        }
    }

    let id = generate_id();
    let now = now_iso();
    let title = opt_string(body.get("title")).unwrap_or("").trim();
    let content = json!({
        "projectId": project_id,
        "categoryId": category_id,
        "title": if title.is_empty() { "Nouvel indice" } else { title },
        "content": opt_string(body.get("content")).unwrap_or(""),
        "positionX": json_number(finite(body.get("positionX")).unwrap_or(0.0)),
        "positionY": json_number(finite(body.get("positionY")).unwrap_or(0.0)),
        "metadata": sanitize_metadata(body.get("metadata")),
        "reliability": reliability.unwrap_or(Value::Null),
        "createdAt": now,
        "updatedAt": now,
    });

    let mut res = db
        .query("CREATE ONLY $nid CONTENT $content;")
        .bind(params(vec![
            ("nid", record_id("entity", &id)),
            ("content", to_db(content)),
        ]))
        .await?
        .check()?;
    let mut record = match from_db(res.take(0)?) {
        Value::Object(o) => o,
        _ => Json::new(),
    };
    record.insert("id".into(), json!(id));
    touch_project(db, &project_id).await;
    created(json!({ "node": map_node(&record) }))
}

// Update node content, title, category, metadata, or position
async fn update(State(state): State<AppState>, Path(id): Path<String>, body: Bytes) -> ApiResult {
    let body = read_body(&body)?;
    let reliability = read_reliability(body.get("reliability"))?;
    let db = &state.db;

    let mut sets = vec!["updatedAt = $updatedAt"];
    let mut vars = vec![
        ("nid", record_id("entity", &id)),
        ("updatedAt", to_db(json!(now_iso()))),
    ];

    if let Some(title) = opt_string(body.get("title")) {
        let title = title.trim();
        sets.push("title = $title");
        vars.push((
            "title",
            to_db(json!(if title.is_empty() {
                "Sans titre"
            } else {
                title
            })),
        ));
    }
    if body.contains_key("categoryId") {
        let category_id =
            truthy(body.get("categoryId")).then(|| js_string(body.get("categoryId"), ""));
        if let Some(cid) = &category_id {
            let mut res = db
                .query("SELECT VALUE projectId FROM ONLY $nid;")
                .bind(params(vec![("nid", record_id("entity", &id))]))
                .await?
                .check()?;
            let project_id = from_db(res.take(0)?);
            if project_id.is_null() {
                return Err(ApiError::not_found("Nœud introuvable."));
            }
            if !category_in_project(db, &js_string(Some(&project_id), ""), cid).await? {
                return Err(ApiError::bad_request(UNKNOWN_CATEGORY));
            }
        }
        sets.push("categoryId = $categoryId");
        vars.push(("categoryId", to_db(json!(category_id))));
    }
    if let Some(content) = opt_string(body.get("content")) {
        sets.push("content = $content");
        vars.push(("content", to_db(json!(content))));
    }
    if let Some(x) = body.get("positionX").and_then(|v| finite(Some(v))) {
        sets.push("positionX = $positionX");
        vars.push(("positionX", to_db(json_number(x))));
    }
    if let Some(y) = body.get("positionY").and_then(|v| finite(Some(v))) {
        sets.push("positionY = $positionY");
        vars.push(("positionY", to_db(json_number(y))));
    }
    if body.contains_key("metadata") {
        sets.push("metadata = $metadata");
        vars.push(("metadata", to_db(sanitize_metadata(body.get("metadata")))));
    }
    if let Some(reliability) = reliability {
        sets.push("reliability = $reliability");
        vars.push(("reliability", to_db(reliability)));
    }

    let mut res = db
        .query(format!("UPDATE ONLY $nid SET {};", sets.join(", ")))
        .bind(params(vars))
        .await?
        .check()?;
    let Value::Object(updated) = from_db(res.take(0)?) else {
        return Err(ApiError::not_found("Nœud introuvable."));
    };
    let node = map_node(&updated);
    touch_project(db, &js_string(node.get("projectId"), "")).await;
    ok(json!({ "node": node }))
}

// Fast single-node position update (on drag stop)
async fn move_one(State(state): State<AppState>, Path(id): Path<String>, body: Bytes) -> ApiResult {
    let body = read_body(&body)?;
    let (Some(x), Some(y)) = (finite(body.get("positionX")), finite(body.get("positionY"))) else {
        return Err(ApiError::bad_request("Coordonnées invalides."));
    };
    let db = &state.db;
    let mut res = db
        .query("UPDATE ONLY $nid SET positionX = $posX, positionY = $posY, updatedAt = $now;")
        .bind(params(vec![
            ("nid", record_id("entity", &id)),
            ("posX", to_db(json_number(x))),
            ("posY", to_db(json_number(y))),
            ("now", to_db(json!(now_iso()))),
        ]))
        .await?
        .check()?;
    let Value::Object(updated) = from_db(res.take(0)?) else {
        return Err(ApiError::not_found("Nœud introuvable."));
    };
    let node = map_node(&updated);
    touch_project(db, &js_string(node.get("projectId"), "")).await;
    ok(json!({ "node": node }))
}

// Batch node positions update (multi-node drag or optional auto-align)
async fn move_many(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    body: Bytes,
) -> ApiResult {
    let body = read_body(&body)?;
    let Some(Value::Array(positions)) = body.get("positions") else {
        return Err(ApiError::bad_request("Liste de positions attendue."));
    };
    let empty = Map::new();
    let valid: Vec<(String, f64, f64)> = positions
        .iter()
        .filter_map(|item| {
            let item = item.as_object().unwrap_or(&empty);
            let x = finite(item.get("positionX"))?;
            let y = finite(item.get("positionY"))?;
            truthy(item.get("id")).then(|| (js_string(item.get("id"), ""), x, y))
        })
        .collect();

    let db = &state.db;
    if !project_exists(db, &project_id).await? {
        return Err(ApiError::not_found("Projet introuvable."));
    }
    // Only nodes of this project are moved; unknown ids and other projects' nodes are ignored
    let ids: Vec<String> = valid.iter().map(|(id, _, _)| id.clone()).collect();
    let owned = nodes_in_project(db, &project_id, &ids).await?;
    let updates: Vec<DbValue> = valid
        .iter()
        .filter(|(id, _, _)| owned.contains(id))
        .map(|(id, x, y)| {
            to_db_object(
                Json::new(),
                vec![
                    ("nid", record_id("entity", id)),
                    ("x", to_db(json_number(*x))),
                    ("y", to_db(json_number(*y))),
                ],
            )
        })
        .collect();
    let count = updates.len();
    if count > 0 {
        db.query(
            "BEGIN TRANSACTION;
             FOR $p IN $updates {
               UPDATE $p.nid SET positionX = $p.x, positionY = $p.y, updatedAt = $now;
             };
             COMMIT TRANSACTION;",
        )
        .bind(params(vec![
            ("updates", DbValue::Array(updates.into())),
            ("now", to_db(json!(now_iso()))),
        ]))
        .await?
        .check()?;
        touch_project(db, &project_id).await;
    }
    ok(json!({ "updated": count }))
}

// Delete several nodes of a project and all their links, in one transaction (multiple
// selection). Ids of other projects or of missing nodes are ignored.
async fn delete_many(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    body: Bytes,
) -> ApiResult {
    let body = read_body(&body)?;
    let ids = match body.get("ids") {
        Some(Value::Array(items)) if !items.is_empty() => items,
        _ => {
            return Err(ApiError::bad_request(
                "Une liste de nœuds (ids) est attendue.",
            ))
        }
    };
    if ids.len() > MAX_RESTORE_RECORDS {
        return Err(ApiError::bad_request(
            "Trop de nœuds à supprimer en une fois.",
        ));
    }
    let mut unique: Vec<String> = Vec::new();
    for id in ids
        .iter()
        .filter_map(Value::as_str)
        .filter(|s| !s.is_empty())
    {
        if !unique.iter().any(|u| u == id) {
            unique.push(id.to_string());
        }
    }

    let db = &state.db;
    if !project_exists(db, &project_id).await? {
        return Err(ApiError::not_found("Projet introuvable."));
    }
    let owned: Vec<String> = nodes_in_project(db, &project_id, &unique)
        .await?
        .into_iter()
        .collect();
    if !owned.is_empty() {
        let nids = || {
            DbValue::Array(
                owned
                    .iter()
                    .map(|id| record_id("entity", id))
                    .collect::<Vec<_>>()
                    .into(),
            )
        };
        // Nodes plus their links must fit in one restore, so that the deletion can be undone
        let mut res = db
            .query("RETURN count(SELECT id FROM relation WHERE in IN $nids OR out IN $nids);")
            .bind(params(vec![("nids", nids())]))
            .await?
            .check()?;
        let links = from_db(res.take(0)?).as_f64().unwrap_or(0.0) as usize;
        if owned.len() + links > MAX_RESTORE_RECORDS {
            return Err(ApiError::bad_request(&format!(
                "Trop d’éléments à supprimer en une fois (plus de {MAX_RESTORE_RECORDS} nœuds et liens)."
            )));
        }
        db.query(
            "BEGIN TRANSACTION;
             DELETE relation WHERE in IN $nids OR out IN $nids;
             DELETE entity WHERE id IN $nids;
             COMMIT TRANSACTION;",
        )
        .bind(params(vec![("nids", nids())]))
        .await?
        .check()?;
        touch_project(db, &project_id).await;
    }
    ok(json!({ "deleted": owned.len() }))
}

// Delete node and all connected graph edges
async fn remove(State(state): State<AppState>, Path(id): Path<String>) -> ApiResult {
    let db = &state.db;
    let mut res = db
        .query("SELECT * FROM ONLY $nid;")
        .bind(params(vec![("nid", record_id("entity", &id))]))
        .await?
        .check()?;
    let existing = from_db(res.take(0)?);

    db.query(
        "BEGIN TRANSACTION;
         DELETE relation WHERE in = $nid OR out = $nid;
         DELETE $nid;
         COMMIT TRANSACTION;",
    )
    .bind(params(vec![("nid", record_id("entity", &id))]))
    .await?
    .check()?;

    if truthy(existing.get("projectId")) {
        touch_project(db, &js_string(existing.get("projectId"), "")).await;
    }
    ok(json!({ "deleted": true }))
}
