//! Port of server/bundles.ts: a project as a JSON bundle, and a new project from one

use std::collections::HashMap;

use serde_json::{json, Map, Value};
use surrealdb::engine::local::Db;
use surrealdb::Surreal;

use super::bulk::{insert_project_graph, ProjectGraph};
use super::model::{
    category_icon, category_shape, map_category, map_edge, map_node, map_project,
    normalize_category_keys, normalize_color, normalize_handle, normalize_link_types,
    normalize_reliability, normalize_saved_views, rows, sanitize_metadata, sort_category_records,
    DEFAULT_CATEGORY_COLOR, UNCLASSIFIED_VIEW_ID,
};
use super::util::{
    from_db, generate_id, js_number, js_string, json_number, now_iso, opt_string, params,
    record_id, truthy, Json,
};

/// The project record and its categories, nodes and links (raw), or None when it does not exist
pub async fn load_project_graph(
    db: &Surreal<Db>,
    project_id: &str,
) -> surrealdb::Result<Option<(Json, Vec<Json>, Vec<Json>, Vec<Json>)>> {
    let mut res = db
        .query(
            "SELECT * FROM ONLY $pid;
             SELECT * FROM category WHERE projectId = $projectId;
             SELECT * FROM entity WHERE projectId = $projectId;
             SELECT * FROM relation WHERE projectId = $projectId;",
        )
        .bind(params(vec![
            ("pid", record_id("project", project_id)),
            ("projectId", super::util::to_db(json!(project_id))),
        ]))
        .await?
        .check()?;
    let Value::Object(project) = from_db(res.take(0)?) else {
        return Ok(None);
    };
    let categories = rows(from_db(res.take(1)?));
    let nodes = rows(from_db(res.take(2)?));
    let edges = rows(from_db(res.take(3)?));
    Ok(Some((project, categories, nodes, edges)))
}

/// `{ project, categories, nodes, edges }` as sent to the client
pub fn graph_payload(
    project: &Json,
    categories: Vec<Json>,
    nodes: &[Json],
    edges: &[Json],
) -> Json {
    let mut out = Map::new();
    out.insert("project".into(), map_project(project));
    out.insert(
        "categories".into(),
        Value::Array(
            sort_category_records(categories)
                .iter()
                .map(map_category)
                .collect(),
        ),
    );
    out.insert(
        "nodes".into(),
        Value::Array(nodes.iter().map(map_node).collect()),
    );
    out.insert(
        "edges".into(),
        Value::Array(edges.iter().map(map_edge).collect()),
    );
    out
}

/// A whole project as a JSON bundle (export, snapshots), or None when it does not exist
pub async fn build_export_bundle(
    db: &Surreal<Db>,
    project_id: &str,
) -> surrealdb::Result<Option<Value>> {
    let Some((project, categories, nodes, edges)) = load_project_graph(db, project_id).await?
    else {
        return Ok(None);
    };
    let mut bundle = Map::new();
    bundle.insert("format".into(), json!("graphax-project"));
    bundle.insert("version".into(), json!(1));
    bundle.insert("exportedAt".into(), json!(now_iso()));
    bundle.extend(graph_payload(&project, categories, &nodes, &edges));
    Ok(Some(Value::Object(bundle)))
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

/// Creates a new project from a bundle (import, duplicate, snapshot restore). Returns None
/// when the bundle does not have the expected shape. `name` replaces the bundle's project name.
pub async fn import_project_bundle(
    db: &Surreal<Db>,
    bundle: &Json,
    name: Option<String>,
) -> surrealdb::Result<Option<Value>> {
    let (Some(Value::Object(source)), Some(Value::Array(raw_nodes)), Some(Value::Array(raw_edges))) = (
        bundle.get("project"),
        bundle.get("nodes"),
        bundle.get("edges"),
    ) else {
        return Ok(None);
    };
    let new_project_id = generate_id();
    let now = now_iso();

    let name = name.unwrap_or_else(|| {
        let n = opt_string(source.get("name")).unwrap_or("").trim();
        if n.is_empty() {
            "Projet importé".into()
        } else {
            n.to_string()
        }
    });

    // Every record gets a fresh id so an import never collides with existing data.
    // Entries that are not objects are skipped and invalid values fall back to defaults.
    let mut category_ids: HashMap<String, String> = HashMap::new();
    let empty = Vec::new();
    let raw_categories = match bundle.get("categories") {
        Some(Value::Array(items)) => items,
        _ => &empty,
    };
    let categories: Vec<Json> = raw_categories
        .iter()
        .filter_map(Value::as_object)
        .map(|cat| {
            let id = generate_id();
            category_ids.insert(js_string(cat.get("id"), "undefined"), id.clone());
            let n = opt_string(cat.get("name")).unwrap_or("").trim();
            let mut out = Map::new();
            out.insert("id".into(), json!(id));
            out.insert(
                "name".into(),
                json!(if n.is_empty() { "Catégorie" } else { n }),
            );
            out.insert(
                "color".into(),
                json!(normalize_color(cat.get("color"))
                    .unwrap_or_else(|| DEFAULT_CATEGORY_COLOR.into())),
            );
            out.insert("icon".into(), json!(category_icon(cat.get("icon"))));
            out.insert("shape".into(), json!(category_shape(cat.get("shape"))));
            out.extend(normalize_category_keys(
                cat.get("metadataKeys"),
                cat.get("cardKeys"),
            ));
            out
        })
        .collect();

    let mut node_ids: HashMap<String, String> = HashMap::new();
    let nodes: Vec<Json> = raw_nodes
        .iter()
        .filter_map(Value::as_object)
        .map(|node| {
            let id = generate_id();
            node_ids.insert(js_string(node.get("id"), "undefined"), id.clone());
            let category_id = if truthy(node.get("categoryId")) {
                category_ids
                    .get(&js_string(node.get("categoryId"), ""))
                    .map_or(Value::Null, |c| json!(c))
            } else {
                Value::Null
            };
            let mut out = Map::new();
            out.insert("id".into(), json!(id));
            out.insert("categoryId".into(), category_id);
            out.insert(
                "title".into(),
                json!(non_empty_or(node.get("title"), "Indice")),
            );
            out.insert(
                "content".into(),
                json!(opt_string(node.get("content")).unwrap_or("")),
            );
            out.insert("positionX".into(), finite_or_zero(node.get("positionX")));
            out.insert("positionY".into(), finite_or_zero(node.get("positionY")));
            out.insert("metadata".into(), sanitize_metadata(node.get("metadata")));
            out.insert(
                "reliability".into(),
                normalize_reliability(node.get("reliability")),
            );
            out.insert(
                "createdAt".into(),
                json!(non_empty_or(node.get("createdAt"), &now)),
            );
            out.insert("updatedAt".into(), json!(now));
            out
        })
        .collect();

    // Links whose ends are not in the bundle are skipped
    let edges: Vec<Json> = raw_edges
        .iter()
        .filter_map(Value::as_object)
        .filter_map(|edge| {
            let source = node_ids.get(&js_string(edge.get("sourceNodeId"), "undefined"))?;
            let target = node_ids.get(&js_string(edge.get("targetNodeId"), "undefined"))?;
            let style = if edge.get("style").and_then(Value::as_str) == Some("dashed") {
                "dashed"
            } else {
                "solid"
            };
            let value = json!({
                "id": generate_id(),
                "sourceNodeId": source,
                "targetNodeId": target,
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
            value.as_object().cloned()
        })
        .collect();

    // Saved views point at categories and nodes: they follow the new ids, and what is not
    // in the bundle is dropped from them
    let saved_views: Vec<Value> = normalize_saved_views(source.get("savedViews"))
        .into_iter()
        .map(|mut view| {
            let hidden: Vec<Value> = view["hiddenCategoryIds"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .filter_map(|id| {
                    if id == UNCLASSIFIED_VIEW_ID {
                        Some(json!(id))
                    } else {
                        category_ids.get(id).map(|c| json!(c))
                    }
                })
                .collect();
            view["hiddenCategoryIds"] = Value::Array(hidden);
            let focus_node = view["focus"]["nodeId"]
                .as_str()
                .and_then(|n| node_ids.get(n))
                .cloned();
            view["focus"] = match focus_node {
                Some(n) => {
                    let mut focus = view["focus"].clone();
                    focus["nodeId"] = json!(n);
                    focus
                }
                None => Value::Null,
            };
            view
        })
        .collect();

    let project = json!({
        "id": new_project_id,
        "name": name,
        "description": opt_string(source.get("description")).unwrap_or("").trim(),
        "createdAt": non_empty_or(source.get("createdAt"), &now),
        "linkTypes": normalize_link_types(source.get("linkTypes")),
        "savedViews": saved_views,
        "updatedAt": now,
    });
    let (category_count, node_count, edge_count) = (categories.len(), nodes.len(), edges.len());

    // One transaction: a failed import leaves no partial project behind
    insert_project_graph(
        db,
        ProjectGraph {
            project: project.as_object().cloned().unwrap_or_default(),
            categories,
            nodes,
            edges,
        },
    )
    .await?;

    let mut out = project.as_object().cloned().unwrap_or_default();
    out.insert("categoryCount".into(), json!(category_count));
    out.insert("nodeCount".into(), json!(node_count));
    out.insert("edgeCount".into(), json!(edge_count));
    Ok(Some(Value::Object(out)))
}
