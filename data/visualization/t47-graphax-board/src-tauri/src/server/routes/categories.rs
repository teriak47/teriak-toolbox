//! Port of server/routes/categories.ts

use std::collections::HashMap;

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::routing::{patch, post, put};
use axum::Router;
use serde_json::{json, Map, Value};
use surrealdb::types::Value as DbValue;

use crate::server::guards::{project_exists, touch_project};
use crate::server::http::{created, ok, read_body, ApiError, ApiResult};
use crate::server::model::{
    map_category, normalize_category_keys, normalize_color, normalize_key_list, rows,
    sort_category_records, CATEGORY_ICON_NAMES, CATEGORY_SHAPES, DEFAULT_CATEGORY_COLOR,
    DEFAULT_CATEGORY_ICON, DEFAULT_CATEGORY_SHAPE,
};
use crate::server::util::{
    extract_id, from_db, generate_id, js_string, opt_string, params, record_id, to_db, Json,
};
use crate::server::AppState;

const MAX_CATEGORY_KEYS: usize = 12;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/projects/{id}/categories", post(create))
        .route("/api/projects/{id}/categories/order", put(reorder))
        .route("/api/categories/{id}", patch(update).delete(remove))
        .route("/api/categories/{id}/merge", post(merge))
}

#[derive(Default)]
struct Keys {
    metadata_keys: Option<Vec<String>>,
    card_keys: Option<Vec<String>>,
}

// Default keys and card keys that were sent; a value that is not a list is a 400
fn read_category_keys(body: &Json) -> Result<Keys, ApiError> {
    let mut keys = Keys::default();
    for field in ["metadataKeys", "cardKeys"] {
        let Some(value) = body.get(field) else {
            continue;
        };
        if !value.is_array() {
            return Err(ApiError::bad_request("Liste de clés invalide."));
        }
        let list = Some(normalize_key_list(Some(value), MAX_CATEGORY_KEYS));
        if field == "metadataKeys" {
            keys.metadata_keys = list;
        } else {
            keys.card_keys = list;
        }
    }
    Ok(keys)
}

#[derive(Default)]
struct Style {
    color: Option<String>,
    icon: Option<String>,
    shape: Option<String>,
}

// Checks the colour, icon and shape that were sent; missing fields are left out
fn read_category_style(body: &Json) -> Result<Style, ApiError> {
    let mut style = Style::default();
    if let Some(color) = body.get("color") {
        style.color =
            Some(normalize_color(Some(color)).ok_or_else(|| {
                ApiError::bad_request("Couleur invalide : format #rrggbb attendu.")
            })?);
    }
    if let Some(icon) = body.get("icon") {
        match icon.as_str().filter(|i| CATEGORY_ICON_NAMES.contains(i)) {
            Some(i) => style.icon = Some(i.into()),
            None => return Err(ApiError::bad_request("Icône de catégorie inconnue.")),
        }
    }
    if let Some(shape) = body.get("shape") {
        match shape.as_str().filter(|s| CATEGORY_SHAPES.contains(s)) {
            Some(s) => style.shape = Some(s.into()),
            None => return Err(ApiError::bad_request("Forme de catégorie inconnue.")),
        }
    }
    Ok(style)
}

fn key_value(keys: &Option<Vec<String>>) -> Option<Value> {
    keys.as_ref().map(|k| json!(k))
}

// Create category in a project
async fn create(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    body: Bytes,
) -> ApiResult {
    let body = read_body(&body)?;
    let name = opt_string(body.get("name"))
        .unwrap_or("")
        .trim()
        .to_string();
    if name.is_empty() {
        return Err(ApiError::bad_request("Le nom de la catégorie est requis."));
    }
    let style = read_category_style(&body)?;
    let keys = read_category_keys(&body)?;

    let db = &state.db;
    if !project_exists(db, &project_id).await? {
        return Err(ApiError::not_found("Projet introuvable."));
    }
    let id = generate_id();
    // A new category goes after the others. In a project created before categories had a
    // position, it gets none either, so it is sorted by name with them as before.
    let mut res = db
        .query("SELECT VALUE position FROM category WHERE projectId = $projectId;")
        .bind(params(vec![("projectId", to_db(json!(project_id)))]))
        .await?
        .check()?;
    let positions = from_db(res.take(0)?);
    let positions: Vec<Value> = positions.as_array().cloned().unwrap_or_default();
    let finite: Vec<f64> = positions
        .iter()
        .filter_map(Value::as_f64)
        .filter(|p| p.is_finite())
        .collect();
    let position = (finite.len() == positions.len())
        .then(|| finite.iter().fold(-1.0_f64, |a, b| a.max(*b)) + 1.0);

    let mut content = Map::new();
    content.insert("projectId".into(), json!(project_id));
    if let Some(p) = position {
        content.insert("position".into(), crate::server::util::json_number(p));
    }
    content.insert("name".into(), json!(name));
    content.insert(
        "color".into(),
        json!(style.color.as_deref().unwrap_or(DEFAULT_CATEGORY_COLOR)),
    );
    content.insert(
        "icon".into(),
        json!(style.icon.as_deref().unwrap_or(DEFAULT_CATEGORY_ICON)),
    );
    content.insert(
        "shape".into(),
        json!(style.shape.as_deref().unwrap_or(DEFAULT_CATEGORY_SHAPE)),
    );
    content.extend(normalize_category_keys(
        key_value(&keys.metadata_keys).as_ref(),
        key_value(&keys.card_keys).as_ref(),
    ));

    let mut res = db
        .query("CREATE ONLY $cid CONTENT $content;")
        .bind(params(vec![
            ("cid", record_id("category", &id)),
            ("content", to_db(Value::Object(content))),
        ]))
        .await?
        .check()?;
    let mut created_record = match from_db(res.take(0)?) {
        Value::Object(o) => o,
        _ => Json::new(),
    };
    created_record.insert("id".into(), json!(id));
    touch_project(db, &project_id).await;

    created(json!({ "category": map_category(&created_record) }))
}

// Reorder a project's categories: `ids` in the new order. Categories left out keep their
// relative order after the listed ones; unknown or foreign ids are a 400.
async fn reorder(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    body: Bytes,
) -> ApiResult {
    let body = read_body(&body)?;
    let ids: Vec<String> = match body.get("ids") {
        Some(Value::Array(items)) if items.iter().all(Value::is_string) => items
            .iter()
            .filter_map(Value::as_str)
            .map(String::from)
            .collect(),
        _ => return Err(ApiError::bad_request("Liste d'identifiants attendue.")),
    };
    let db = &state.db;
    if !project_exists(db, &project_id).await? {
        return Err(ApiError::not_found("Projet introuvable."));
    }
    let mut res = db
        .query("SELECT * FROM category WHERE projectId = $projectId;")
        .bind(params(vec![("projectId", to_db(json!(project_id)))]))
        .await?
        .check()?;
    let current: Vec<Value> = sort_category_records(rows(from_db(res.take(0)?)))
        .iter()
        .map(map_category)
        .collect();
    let current_ids: Vec<String> = current.iter().map(|c| js_string(c.get("id"), "")).collect();

    let mut listed: Vec<String> = Vec::new();
    for id in ids {
        if !listed.contains(&id) {
            listed.push(id);
        }
    }
    if listed.iter().any(|id| !current_ids.contains(id)) {
        return Err(ApiError::bad_request("Catégorie inconnue dans ce projet."));
    }
    let mut order = listed.clone();
    order.extend(
        current_ids
            .iter()
            .filter(|id| !listed.contains(id))
            .cloned(),
    );

    let updates: Vec<DbValue> = order
        .iter()
        .enumerate()
        .map(|(position, id)| {
            crate::server::util::to_db_object(
                Json::new(),
                vec![
                    ("cid", record_id("category", id)),
                    ("position", to_db(json!(position))),
                ],
            )
        })
        .collect();
    db.query(
        "BEGIN TRANSACTION;
         FOR $u IN $updates {
           UPDATE $u.cid SET position = $u.position;
         };
         COMMIT TRANSACTION;",
    )
    .bind(params(vec![("updates", DbValue::Array(updates.into()))]))
    .await?
    .check()?;
    touch_project(db, &project_id).await;

    let by_id: HashMap<&String, &Value> = current_ids.iter().zip(current.iter()).collect();
    let categories: Vec<Value> = order.iter().map(|id| by_id[id].clone()).collect();
    ok(json!({ "categories": categories }))
}

// Update category
async fn update(State(state): State<AppState>, Path(id): Path<String>, body: Bytes) -> ApiResult {
    let body = read_body(&body)?;
    let style = read_category_style(&body)?;
    let keys = read_category_keys(&body)?;
    let db = &state.db;

    let mut sets = Vec::new();
    let mut vars = vec![("cid", record_id("category", &id))];
    if let Some(name) = opt_string(body.get("name"))
        .map(str::trim)
        .filter(|n| !n.is_empty())
    {
        sets.push("name = $name");
        vars.push(("name", to_db(json!(name))));
    }
    for (field, value) in [
        ("color", &style.color),
        ("icon", &style.icon),
        ("shape", &style.shape),
    ] {
        if let Some(v) = value {
            sets.push(match field {
                "color" => "color = $color",
                "icon" => "icon = $icon",
                _ => "shape = $shape",
            });
            vars.push((field, to_db(json!(v))));
        }
    }
    // Card keys are read back among the default keys (see map_category)
    if let Some(k) = &keys.metadata_keys {
        sets.push("metadataKeys = $metadataKeys");
        vars.push(("metadataKeys", to_db(json!(k))));
    }
    if let Some(k) = &keys.card_keys {
        sets.push("cardKeys = $cardKeys");
        vars.push(("cardKeys", to_db(json!(k))));
    }

    let query = if sets.is_empty() {
        "SELECT * FROM ONLY $cid;".to_string()
    } else {
        format!("UPDATE ONLY $cid SET {};", sets.join(", "))
    };
    let mut res = db.query(query).bind(params(vars)).await?.check()?;
    let Value::Object(record) = from_db(res.take(0)?) else {
        return Err(ApiError::not_found("Catégorie introuvable."));
    };
    let category = map_category(&record);
    if !sets.is_empty() {
        touch_project(db, &js_string(category.get("projectId"), "")).await;
    }
    ok(json!({ "category": category }))
}

// Merge a category into another one of the same project: its nodes move to the target,
// the target gets the source's default keys it lacks, and the source is deleted, all in
// one transaction. Returns the updated target and the ids of the moved nodes.
async fn merge(
    State(state): State<AppState>,
    Path(raw_id): Path<String>,
    body: Bytes,
) -> ApiResult {
    // Canonical ids ("category:abc" -> "abc"): nodes store the bare id of their category
    let id = extract_id(Some(&json!(raw_id)));
    let body = read_body(&body)?;
    let target_id = match opt_string(body.get("targetId")).filter(|s| !s.is_empty()) {
        Some(raw) => extract_id(Some(&json!(raw))),
        None => String::new(),
    };
    if target_id.is_empty() {
        return Err(ApiError::bad_request(
            "Catégorie cible (targetId) attendue.",
        ));
    }
    if target_id == id {
        return Err(ApiError::bad_request(
            "Une catégorie ne peut pas être fusionnée avec elle-même.",
        ));
    }

    let db = &state.db;
    let mut res = db
        .query("SELECT * FROM ONLY $sid; SELECT * FROM ONLY $tid;")
        .bind(params(vec![
            ("sid", record_id("category", &id)),
            ("tid", record_id("category", &target_id)),
        ]))
        .await?
        .check()?;
    let (Value::Object(source), Value::Object(target)) =
        (from_db(res.take(0)?), from_db(res.take(1)?))
    else {
        return Err(ApiError::not_found("Catégorie introuvable."));
    };
    if js_string(source.get("projectId"), "undefined")
        != js_string(target.get("projectId"), "undefined")
    {
        return Err(ApiError::bad_request(
            "Les deux catégories doivent appartenir au même projet.",
        ));
    }

    let src = map_category(&source);
    let dst = map_category(&target);
    let mut all_keys: Vec<Value> = dst["metadataKeys"].as_array().cloned().unwrap_or_default();
    all_keys.extend(src["metadataKeys"].as_array().cloned().unwrap_or_default());
    let merged = normalize_category_keys(Some(&Value::Array(all_keys)), dst.get("cardKeys"));
    let project_id = js_string(dst.get("projectId"), "");

    let mut res = db
        .query(
            "SELECT VALUE id FROM entity WHERE categoryId = $sourceStr AND projectId = $projectId;",
        )
        .bind(params(vec![
            ("sourceStr", to_db(json!(id))),
            ("projectId", to_db(json!(project_id))),
        ]))
        .await?
        .check()?;
    let moved: Vec<String> = from_db(res.take(0)?)
        .as_array()
        .into_iter()
        .flatten()
        .map(|v| extract_id(Some(v)))
        .collect();

    let mut res = db
        .query(
            "BEGIN TRANSACTION;
             UPDATE entity SET categoryId = $targetStr WHERE categoryId = $sourceStr AND projectId = $projectId;
             DELETE $sid;
             UPDATE ONLY $tid SET metadataKeys = $metadataKeys, cardKeys = $cardKeys;
             COMMIT TRANSACTION;",
        )
        .bind(params(vec![
            ("targetStr", to_db(json!(target_id))),
            ("sourceStr", to_db(json!(id))),
            ("projectId", to_db(json!(project_id))),
            ("sid", record_id("category", &id)),
            ("tid", record_id("category", &target_id)),
            ("metadataKeys", to_db(merged["metadataKeys"].clone())),
            ("cardKeys", to_db(merged["cardKeys"].clone())),
        ]))
        .await?
        .check()?;
    let mut updated = None;
    for index in 0..res.num_statements() {
        if let Ok(value) = res.take::<DbValue>(index) {
            if let Value::Object(o) = from_db(value) {
                if o.contains_key("name") {
                    updated = Some(o);
                    break;
                }
            }
        }
    }
    touch_project(db, &project_id).await;

    let category = match updated {
        Some(record) => map_category(&record),
        None => {
            let mut fallback = dst.as_object().cloned().unwrap_or_default();
            fallback.extend(merged);
            Value::Object(fallback)
        }
    };
    ok(json!({ "category": category, "movedNodeIds": moved }))
}

// Delete category and detach nodes using it
async fn remove(State(state): State<AppState>, Path(id): Path<String>) -> ApiResult {
    let db = &state.db;
    let mut res = db
        .query("SELECT * FROM ONLY $cid;")
        .bind(params(vec![("cid", record_id("category", &id))]))
        .await?
        .check()?;
    let existing = from_db(res.take(0)?);

    db.query(
        "BEGIN TRANSACTION;
         UPDATE entity SET categoryId = NONE WHERE categoryId = $catIdStr;
         DELETE $cid;
         COMMIT TRANSACTION;",
    )
    .bind(params(vec![
        ("catIdStr", to_db(json!(id))),
        ("cid", record_id("category", &id)),
    ]))
    .await?
    .check()?;

    if crate::server::util::truthy(existing.get("projectId")) {
        touch_project(db, &js_string(existing.get("projectId"), "")).await;
    }
    ok(json!({ "deleted": true }))
}
