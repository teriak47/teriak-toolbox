//! Port of server/routes/edges.ts

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{patch, post};
use axum::Router;
use serde_json::{json, Value};
use surrealdb::types::Value as DbValue;

use crate::server::guards::{nodes_in_project, project_exists, touch_project};
use crate::server::http::{created, ok, read_body, ApiError, ApiResult};
use crate::server::model::{map_edge, normalize_color, normalize_handle};
use crate::server::util::{
    from_db, generate_id, js_string, now_iso, opt_string, params, record_id, to_db, truthy, Json,
};
use crate::server::AppState;

const INVALID_COLOR: &str = "Couleur de lien invalide : format #rrggbb attendu.";

const RELATE: &str = "RELATE ONLY $from -> $relId -> $to CONTENT {
    projectId: $projectId,
    label: $label,
    style: $style,
    directed: $directed,
    color: $color,
    notes: $notes,
    sourceHandle: $sourceHandle,
    targetHandle: $targetHandle,
    createdAt: $createdAt,
    updatedAt: $now
  };";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/projects/{id}/edges", post(create))
        .route("/api/edges/{id}", patch(update).delete(remove))
}

/// A link colour is optional: null or "" resets it to the default grey. None when the
/// field was not sent, an error when the value is not a colour.
fn read_edge_color(value: Option<&Value>) -> Result<Option<Value>, ApiError> {
    match value {
        None => Ok(None),
        Some(Value::Null) => Ok(Some(Value::Null)),
        Some(Value::String(s)) if s.is_empty() => Ok(Some(Value::Null)),
        Some(v) => normalize_color(Some(v))
            .map(|c| Some(json!(c)))
            .ok_or_else(|| ApiError::bad_request(INVALID_COLOR)),
    }
}

/// The first object among the results of a query (the created or updated record)
fn first_object(res: &mut surrealdb::IndexedResults) -> Option<Json> {
    (0..res.num_statements()).find_map(|index| match res.take::<DbValue>(index).map(from_db) {
        Ok(Value::Object(o)) => Some(o),
        _ => None,
    })
}

// Create a native SurrealDB RELATE edge between two nodes
async fn create(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    body: Bytes,
) -> ApiResult {
    let body = read_body(&body)?;
    if !truthy(body.get("sourceNodeId")) || !truthy(body.get("targetNodeId")) {
        return Err(ApiError::bad_request(
            "sourceNodeId et targetNodeId sont requis.",
        ));
    }
    if body.get("sourceNodeId") == body.get("targetNodeId") {
        return Err(ApiError::bad_request(
            "Un nœud ne peut pas être relié à lui-même.",
        ));
    }
    let source = js_string(body.get("sourceNodeId"), "");
    let target = js_string(body.get("targetNodeId"), "");
    let color = read_edge_color(body.get("color"))?;

    let db = &state.db;
    if !project_exists(db, &project_id).await? {
        return Err(ApiError::not_found("Projet introuvable."));
    }
    let owned = nodes_in_project(db, &project_id, &[source.clone(), target.clone()]).await?;
    if !owned.contains(&source) || !owned.contains(&target) {
        return Err(ApiError::bad_request(
            "Les deux nœuds doivent exister dans ce projet.",
        ));
    }

    let now = now_iso();
    let style = if body.get("style").and_then(Value::as_str) == Some("dashed") {
        "dashed"
    } else {
        "solid"
    };
    let mut res = db
        .query(RELATE)
        .bind(params(vec![
            ("from", record_id("entity", &source)),
            ("relId", record_id("relation", &generate_id())),
            ("to", record_id("entity", &target)),
            ("projectId", to_db(json!(project_id))),
            (
                "label",
                to_db(json!(opt_string(body.get("label")).unwrap_or("").trim())),
            ),
            ("style", to_db(json!(style))),
            (
                "directed",
                to_db(json!(body.get("directed") != Some(&Value::Bool(false)))),
            ),
            ("color", to_db(color.unwrap_or(Value::Null))),
            (
                "notes",
                to_db(json!(opt_string(body.get("notes")).unwrap_or(""))),
            ),
            (
                "sourceHandle",
                to_db(normalize_handle(body.get("sourceHandle"))),
            ),
            (
                "targetHandle",
                to_db(normalize_handle(body.get("targetHandle"))),
            ),
            ("createdAt", to_db(json!(now))),
            ("now", to_db(json!(now))),
        ]))
        .await?
        .check()?;
    let Some(record) = first_object(&mut res) else {
        return Err(ApiError(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Impossible de créer la relation.".into(),
        ));
    };
    touch_project(db, &project_id).await;
    created(json!({ "edge": map_edge(&record) }))
}

// Update edge properties (or reverse direction)
async fn update(State(state): State<AppState>, Path(id): Path<String>, body: Bytes) -> ApiResult {
    let body = read_body(&body)?;
    let color = read_edge_color(body.get("color"))?;
    let db = &state.db;
    let now = now_iso();

    if truthy(body.get("reverse")) {
        let mut res = db
            .query("SELECT * FROM ONLY $rid;")
            .bind(params(vec![("rid", record_id("relation", &id))]))
            .await?
            .check()?;
        let Value::Object(existing) = from_db(res.take(0)?) else {
            return Err(ApiError::not_found("Relation introuvable."));
        };
        let current = map_edge(&existing);
        let field = |k: &str| current.get(k).cloned().unwrap_or(Value::Null);
        let style = if truthy(body.get("style")) {
            json!(
                if body.get("style").and_then(Value::as_str) == Some("dashed") {
                    "dashed"
                } else {
                    "solid"
                }
            )
        } else {
            field("style")
        };
        let directed = match body.get("directed") {
            Some(Value::Bool(b)) => json!(b),
            _ => field("directed"),
        };
        let label = match opt_string(body.get("label")) {
            Some(l) => json!(l.trim()),
            None => field("label"),
        };
        let notes = match opt_string(body.get("notes")) {
            Some(n) => json!(n),
            None => field("notes"),
        };
        let project_id = js_string(current.get("projectId"), "");

        // Delete and recreate in one transaction so a failure cannot lose the edge
        let mut res = db
            .query(format!(
                "BEGIN TRANSACTION;\nDELETE $rid;\n{RELATE}\nCOMMIT TRANSACTION;"
            ))
            .bind(params(vec![
                ("rid", record_id("relation", &id)),
                (
                    "from",
                    record_id("entity", &js_string(current.get("targetNodeId"), "")),
                ),
                ("relId", record_id("relation", &generate_id())),
                (
                    "to",
                    record_id("entity", &js_string(current.get("sourceNodeId"), "")),
                ),
                ("projectId", to_db(json!(project_id))),
                ("label", to_db(label)),
                ("style", to_db(style)),
                ("directed", to_db(directed)),
                ("color", to_db(color.unwrap_or_else(|| field("color")))),
                ("notes", to_db(notes)),
                ("sourceHandle", to_db(field("targetHandle"))),
                ("targetHandle", to_db(field("sourceHandle"))),
                ("createdAt", to_db(field("createdAt"))),
                ("now", to_db(json!(now))),
            ]))
            .await?
            .check()?;
        let Some(recreated) = first_object(&mut res) else {
            return Err(ApiError(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Erreur lors de l’inversion du lien.".into(),
            ));
        };
        touch_project(db, &project_id).await;
        return ok(json!({ "edge": map_edge(&recreated), "replacedId": id }));
    }

    let mut sets = vec!["updatedAt = $updatedAt"];
    let mut vars = vec![
        ("rid", record_id("relation", &id)),
        ("updatedAt", to_db(json!(now))),
    ];
    if let Some(label) = opt_string(body.get("label")) {
        sets.push("label = $label");
        vars.push(("label", to_db(json!(label.trim()))));
    }
    if let Some(style) = body.get("style") {
        sets.push("style = $style");
        vars.push((
            "style",
            to_db(json!(if style.as_str() == Some("dashed") {
                "dashed"
            } else {
                "solid"
            })),
        ));
    }
    if let Some(Value::Bool(directed)) = body.get("directed") {
        sets.push("directed = $directed");
        vars.push(("directed", to_db(json!(directed))));
    }
    if let Some(color) = color {
        sets.push("color = $color");
        vars.push(("color", to_db(color)));
    }
    if let Some(notes) = opt_string(body.get("notes")) {
        sets.push("notes = $notes");
        vars.push(("notes", to_db(json!(notes))));
    }
    for (field, set) in [
        ("sourceHandle", "sourceHandle = $sourceHandle"),
        ("targetHandle", "targetHandle = $targetHandle"),
    ] {
        if body.contains_key(field) {
            sets.push(set);
            vars.push((field, to_db(normalize_handle(body.get(field)))));
        }
    }

    let mut res = db
        .query(format!("UPDATE ONLY $rid SET {};", sets.join(", ")))
        .bind(params(vars))
        .await?
        .check()?;
    let Value::Object(updated) = from_db(res.take(0)?) else {
        return Err(ApiError::not_found("Relation introuvable."));
    };
    let edge = map_edge(&updated);
    touch_project(db, &js_string(edge.get("projectId"), "")).await;
    ok(json!({ "edge": edge }))
}

// Delete edge
async fn remove(State(state): State<AppState>, Path(id): Path<String>) -> ApiResult {
    let db = &state.db;
    let mut res = db
        .query("SELECT * FROM ONLY $rid; DELETE $rid;")
        .bind(params(vec![("rid", record_id("relation", &id))]))
        .await?
        .check()?;
    let existing = from_db(res.take(0)?);
    if truthy(existing.get("projectId")) {
        touch_project(db, &js_string(existing.get("projectId"), "")).await;
    }
    ok(json!({ "deleted": true }))
}
