//! Port of server/routes/restore.ts. Restores records removed by the user, with their
//! former ids, so that undo can bring back a deleted node (with its links), link or
//! category, and redo a creation. Everything is written in one transaction. Restoring the
//! same records twice gives the same result, so a retried request is harmless.

use std::collections::HashSet;

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::routing::post;
use axum::Router;
use serde_json::{json, Map, Value};
use surrealdb::engine::local::Db;
use surrealdb::types::Value as DbValue;
use surrealdb::Surreal;

use crate::guards::{project_exists, touch_project};
use crate::http::{ok, read_body, ApiError, ApiResult};
use crate::model::{
    category_icon, category_shape, map_category, map_edge, map_node, normalize_category_keys,
    normalize_color, normalize_handle, normalize_reliability, rows, sanitize_metadata,
    sort_category_records, DEFAULT_CATEGORY_COLOR,
};
use crate::routes::nodes::MAX_RESTORE_RECORDS;
use crate::snapshots::is_project_id as is_record_id;
use crate::util::{
    extract_id, from_db, js_number, js_string, json_number, now_iso, opt_string, params, record_id,
    to_db, to_db_object, Json,
};
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/api/projects/{id}/restore", post(restore))
}

fn objects(value: Option<&Value>) -> Vec<Json> {
    match value {
        Some(Value::Array(items)) => items.iter().filter_map(Value::as_object).cloned().collect(),
        _ => Vec::new(),
    }
}

fn valid_id(value: Option<&Value>) -> bool {
    value.and_then(Value::as_str).is_some_and(is_record_id)
}

fn record_ids(table: &str, ids: &[String]) -> DbValue {
    DbValue::Array(
        ids.iter()
            .map(|id| record_id(table, id))
            .collect::<Vec<_>>()
            .into(),
    )
}

/// Projects that already hold some of these records, so a restore never takes over
/// another project's data
async fn owners_of(
    db: &Surreal<Db>,
    table: &str,
    ids: &[String],
) -> surrealdb::Result<Vec<String>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut res = db
        .query(format!(
            "SELECT id, projectId FROM {table} WHERE id IN $ids;"
        ))
        .bind(params(vec![("ids", record_ids(table, ids))]))
        .await?
        .check()?;
    Ok(rows(from_db(res.take(0)?))
        .iter()
        .map(|r| js_string(r.get("projectId"), ""))
        .collect())
}

fn non_empty_or(value: Option<&Value>, fallback: &str) -> String {
    match opt_string(value) {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => fallback.to_string(),
    }
}

fn finite_or_zero(value: Option<&Value>) -> Value {
    let n = js_number(value);
    json_number(if n.is_finite() { n } else { 0.0 })
}

async fn restore(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    body: Bytes,
) -> ApiResult {
    let body = read_body(&body)?;
    let raw_categories = objects(body.get("categories"));
    let raw_nodes = objects(body.get("nodes"));
    let raw_edges = objects(body.get("edges"));
    let raw_assignments = objects(body.get("assignments"));

    let all_count = raw_categories.len() + raw_nodes.len() + raw_edges.len();
    if all_count + raw_assignments.len() == 0 {
        return Err(ApiError::bad_request("Rien à restaurer."));
    }
    if all_count > MAX_RESTORE_RECORDS {
        return Err(ApiError::bad_request(
            "Trop d’éléments à restaurer en une fois.",
        ));
    }
    if !raw_categories
        .iter()
        .chain(&raw_nodes)
        .chain(&raw_edges)
        .all(|r| valid_id(r.get("id")))
    {
        return Err(ApiError::bad_request("Identifiant d’élément invalide."));
    }

    let db = &state.db;
    if !project_exists(db, &project_id).await? {
        return Err(ApiError::not_found("Projet introuvable."));
    }

    let id_of = |r: &Json| js_string(r.get("id"), "");
    let category_ids: Vec<String> = raw_categories.iter().map(id_of).collect();
    let node_ids: Vec<String> = raw_nodes.iter().map(id_of).collect();
    let edge_ids: Vec<String> = raw_edges.iter().map(id_of).collect();
    let mut owners = owners_of(db, "category", &category_ids).await?;
    owners.extend(owners_of(db, "entity", &node_ids).await?);
    owners.extend(owners_of(db, "relation", &edge_ids).await?);
    if owners.iter().any(|o| *o != project_id) {
        return Err(ApiError::bad_request(
            "Ces éléments appartiennent à un autre projet.",
        ));
    }

    // What the project holds besides the restored records: categories (in order) and nodes
    let mut res = db
        .query(
            "SELECT * FROM category WHERE projectId = $projectId;
             SELECT VALUE id FROM entity WHERE projectId = $projectId;",
        )
        .bind(params(vec![("projectId", to_db(json!(project_id)))]))
        .await?
        .check()?;
    let existing_categories = rows(from_db(res.take(0)?));
    let existing_node_ids = from_db(res.take(1)?);
    let restored_category_ids: HashSet<&String> = category_ids.iter().collect();
    let kept_categories: Vec<Json> = sort_category_records(existing_categories)
        .into_iter()
        .filter(|r| !restored_category_ids.contains(&extract_id(r.get("id"))))
        .collect();
    let mut known_categories: HashSet<String> = kept_categories
        .iter()
        .map(|r| extract_id(r.get("id")))
        .collect();
    known_categories.extend(category_ids.iter().cloned());
    let mut known_nodes: HashSet<String> = existing_node_ids
        .as_array()
        .into_iter()
        .flatten()
        .map(|v| extract_id(Some(v)))
        .collect();
    known_nodes.extend(node_ids.iter().cloned());

    let now = now_iso();
    // (id, index in the list, record)
    let categories: Vec<(String, f64, Json)> = raw_categories
        .iter()
        .map(|cat| {
            let index = cat
                .get("index")
                .and_then(Value::as_f64)
                .filter(|i| i.fract() == 0.0 && i.is_finite())
                .unwrap_or(f64::INFINITY);
            let name = opt_string(cat.get("name")).unwrap_or("").trim();
            let mut record = Map::new();
            record.insert("projectId".into(), json!(project_id));
            record.insert(
                "name".into(),
                json!(if name.is_empty() { "Catégorie" } else { name }),
            );
            record.insert(
                "color".into(),
                json!(normalize_color(cat.get("color"))
                    .unwrap_or_else(|| DEFAULT_CATEGORY_COLOR.into())),
            );
            record.insert("icon".into(), json!(category_icon(cat.get("icon"))));
            record.insert("shape".into(), json!(category_shape(cat.get("shape"))));
            record.extend(normalize_category_keys(
                cat.get("metadataKeys"),
                cat.get("cardKeys"),
            ));
            (id_of(cat), index, record)
        })
        .collect();

    let nodes: Vec<(String, Json)> = raw_nodes
        .iter()
        .map(|node| {
            let category_id = opt_string(node.get("categoryId"))
                .filter(|c| !c.is_empty() && known_categories.contains(*c))
                .map_or(Value::Null, |c| json!(c));
            // A category deleted since is not brought back with the node
            let record = json!({
                "projectId": project_id,
                "categoryId": category_id,
                "title": non_empty_or(node.get("title"), "Indice"),
                "content": opt_string(node.get("content")).unwrap_or(""),
                "positionX": finite_or_zero(node.get("positionX")),
                "positionY": finite_or_zero(node.get("positionY")),
                "metadata": sanitize_metadata(node.get("metadata")),
                "reliability": normalize_reliability(node.get("reliability")),
                "createdAt": non_empty_or(node.get("createdAt"), &now),
                "updatedAt": now,
            });
            (id_of(node), record.as_object().cloned().unwrap_or_default())
        })
        .collect();

    // A link comes back only when both of its nodes exist (or come back with it)
    let edges: Vec<(String, String, String, Json)> = raw_edges
        .iter()
        .filter_map(|edge| {
            let source = opt_string(edge.get("sourceNodeId")).filter(|s| !s.is_empty())?;
            let target = opt_string(edge.get("targetNodeId")).filter(|s| !s.is_empty())?;
            if source == target || !known_nodes.contains(source) || !known_nodes.contains(target) {
                return None;
            }
            let style = if edge.get("style").and_then(Value::as_str) == Some("dashed") {
                "dashed"
            } else {
                "solid"
            };
            let record = json!({
                "projectId": project_id,
                "label": opt_string(edge.get("label")).unwrap_or(""),
                "style": style,
                "directed": edge.get("directed") != Some(&Value::Bool(false)),
                "color": normalize_color(edge.get("color")),
                "notes": opt_string(edge.get("notes")).unwrap_or(""),
                "sourceHandle": normalize_handle(edge.get("sourceHandle")),
                "targetHandle": normalize_handle(edge.get("targetHandle")),
                "createdAt": non_empty_or(edge.get("createdAt"), &now),
                "updatedAt": now,
            });
            Some((
                id_of(edge),
                source.to_string(),
                target.to_string(),
                record.as_object().cloned().unwrap_or_default(),
            ))
        })
        .collect();

    // Nodes that lost a category when it was deleted get it back, unless they got another
    // since. With `fromCategoryId` (undo of a merge), the nodes still in that category get it back.
    let assignments: Vec<(String, Value, Vec<String>)> = raw_assignments
        .iter()
        .filter_map(|a| {
            let category_id = opt_string(a.get("categoryId"))
                .filter(|c| !c.is_empty() && known_categories.contains(*c))?;
            let Some(Value::Array(ids)) = a.get("nodeIds") else {
                return None;
            };
            let ids: Vec<String> = ids
                .iter()
                .filter(|v| valid_id(Some(v)))
                .filter_map(Value::as_str)
                .filter(|id| known_nodes.contains(*id))
                .map(String::from)
                .collect();
            let from = opt_string(a.get("fromCategoryId")).map_or(Value::Null, |f| json!(f));
            (!ids.is_empty()).then(|| (category_id.to_string(), from, ids))
        })
        .collect();

    // Restored categories go back to their former place in the list; positions are rewritten
    // for the whole project so that the order shown is the order stored
    let mut order: Vec<String> = kept_categories
        .iter()
        .map(|r| extract_id(r.get("id")))
        .collect();
    let mut by_index: Vec<&(String, f64, Json)> = categories.iter().collect();
    by_index.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
    for (id, index, _) in by_index {
        // Array.prototype.splice: a negative index counts from the end
        let len = order.len() as f64;
        let at = if *index < 0.0 {
            (len + index).max(0.0)
        } else {
            index.min(len)
        };
        order.insert(at as usize, id.clone());
    }

    let mut statements = vec!["BEGIN TRANSACTION;".to_string()];
    let mut vars: Vec<(&str, DbValue)> = vec![("projectId", to_db(json!(project_id)))];
    if !categories.is_empty() {
        statements.push("DELETE category WHERE id IN $categoryIds;".into());
        statements.push("INSERT INTO category $categories;".into());
        vars.push(("categoryIds", record_ids("category", &category_ids)));
        let list: Vec<DbValue> = categories
            .iter()
            .map(|(id, _, record)| {
                to_db_object(record.clone(), vec![("id", record_id("category", id))])
            })
            .collect();
        vars.push(("categories", DbValue::Array(list.into())));
    }
    if !nodes.is_empty() {
        statements.push("DELETE entity WHERE id IN $nodeIds;".into());
        statements.push("INSERT INTO entity $nodes;".into());
        let ids: Vec<String> = nodes.iter().map(|(id, _)| id.clone()).collect();
        vars.push(("nodeIds", record_ids("entity", &ids)));
        let list: Vec<DbValue> = nodes
            .iter()
            .map(|(id, record)| to_db_object(record.clone(), vec![("id", record_id("entity", id))]))
            .collect();
        vars.push(("nodes", DbValue::Array(list.into())));
    }
    if !edges.is_empty() {
        statements.push("DELETE relation WHERE id IN $edgeIds;".into());
        statements.push("INSERT RELATION INTO relation $edges;".into());
        let ids: Vec<String> = edges.iter().map(|(id, ..)| id.clone()).collect();
        vars.push(("edgeIds", record_ids("relation", &ids)));
        let list: Vec<DbValue> = edges
            .iter()
            .map(|(id, source, target, record)| {
                to_db_object(
                    record.clone(),
                    vec![
                        ("id", record_id("relation", id)),
                        ("in", record_id("entity", source)),
                        ("out", record_id("entity", target)),
                    ],
                )
            })
            .collect();
        vars.push(("edges", DbValue::Array(list.into())));
    }
    if !assignments.is_empty() {
        statements.push(
            "FOR $a IN $assignments {
               UPDATE entity SET categoryId = $a.categoryId, updatedAt = $now
                 WHERE id IN $a.nodeIds AND projectId = $projectId
                   AND (IF $a.from = NONE OR $a.from = NULL THEN categoryId = NONE OR categoryId = NULL ELSE categoryId = $a.from END);
             };"
            .into(),
        );
        let list: Vec<DbValue> = assignments
            .iter()
            .map(|(category_id, from, ids)| {
                to_db_object(
                    Map::from_iter([
                        ("categoryId".to_string(), json!(category_id)),
                        ("from".to_string(), from.clone()),
                    ]),
                    vec![("nodeIds", record_ids("entity", ids))],
                )
            })
            .collect();
        vars.push(("assignments", DbValue::Array(list.into())));
        vars.push(("now", to_db(json!(now))));
    }
    if !categories.is_empty() {
        statements
            .push("FOR $p IN $positions { UPDATE $p.id SET position = $p.position; };".into());
        let list: Vec<DbValue> = order
            .iter()
            .enumerate()
            .map(|(position, id)| {
                to_db_object(
                    Json::new(),
                    vec![
                        ("id", record_id("category", id)),
                        ("position", to_db(json!(position))),
                    ],
                )
            })
            .collect();
        vars.push(("positions", DbValue::Array(list.into())));
    }
    statements.push("COMMIT TRANSACTION;".into());
    db.query(statements.join("\n"))
        .bind(params(vars))
        .await?
        .check()?;
    touch_project(db, &project_id).await;

    // The stored result: the project's categories in order, the restored nodes (and those
    // given their category back) and the restored links
    let mut changed: Vec<String> = nodes.iter().map(|(id, _)| id.clone()).collect();
    for (_, _, ids) in &assignments {
        changed.extend(ids.iter().cloned());
    }
    let edge_record_ids: Vec<String> = edges.iter().map(|(id, ..)| id.clone()).collect();
    let mut res = db
        .query(
            "SELECT * FROM category WHERE projectId = $projectId;
             SELECT * FROM entity WHERE id IN $nodeIds;
             SELECT * FROM relation WHERE id IN $edgeIds;",
        )
        .bind(params(vec![
            ("projectId", to_db(json!(project_id))),
            ("nodeIds", record_ids("entity", &changed)),
            ("edgeIds", record_ids("relation", &edge_record_ids)),
        ]))
        .await?
        .check()?;
    let categories: Vec<Value> = sort_category_records(rows(from_db(res.take(0)?)))
        .iter()
        .map(map_category)
        .collect();
    let nodes: Vec<Value> = rows(from_db(res.take(1)?)).iter().map(map_node).collect();
    let edges: Vec<Value> = rows(from_db(res.take(2)?)).iter().map(map_edge).collect();
    ok(json!({ "categories": categories, "nodes": nodes, "edges": edges }))
}
