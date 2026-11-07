//! Port of server/bulk.ts: a whole project written in one transaction

use serde_json::Value;
use surrealdb::engine::local::Db;
use surrealdb::types::Value as DbValue;
use surrealdb::Surreal;

use super::util::{params, record_id, to_db, to_db_object, Json};

pub struct ProjectGraph {
    /// id, name, description, createdAt, updatedAt and optionally linkTypes, savedViews
    pub project: Json,
    /// Each with an `id`
    pub categories: Vec<Json>,
    pub nodes: Vec<Json>,
    /// Each with `id`, `sourceNodeId` and `targetNodeId`
    pub edges: Vec<Json>,
}

fn take_id(record: &mut Json, key: &str) -> String {
    match record.remove(key) {
        Some(Value::String(s)) => s,
        _ => String::new(),
    }
}

/// Either everything is stored or, if any statement fails, nothing is
pub async fn insert_project_graph(db: &Surreal<Db>, graph: ProjectGraph) -> surrealdb::Result<()> {
    let ProjectGraph {
        mut project,
        categories,
        nodes,
        edges,
    } = graph;
    let project_id = take_id(&mut project, "id");
    let mut statements = vec!["BEGIN TRANSACTION;", "CREATE $pid CONTENT $project;"];

    let mut stored = Json::new();
    for key in ["name", "description", "createdAt", "updatedAt"] {
        stored.insert(key.into(), project.remove(key).unwrap_or(Value::Null));
    }
    stored.insert(
        "linkTypes".into(),
        project
            .remove("linkTypes")
            .unwrap_or(Value::Object(Json::new())),
    );
    stored.insert(
        "savedViews".into(),
        project.remove("savedViews").unwrap_or(Value::Array(vec![])),
    );

    let pid = Value::String(project_id.clone());
    let mut vars: Vec<(&str, DbValue)> = vec![
        ("pid", record_id("project", &project_id)),
        ("project", to_db(Value::Object(stored))),
    ];

    if !categories.is_empty() {
        statements.push("INSERT INTO category $categories;");
        // Categories keep the order they are given in (presets, demo, import)
        let list = categories
            .into_iter()
            .enumerate()
            .map(|(index, mut cat)| {
                let id = take_id(&mut cat, "id");
                if !cat.get("position").is_some_and(|p| !p.is_null()) {
                    cat.insert("position".into(), Value::from(index));
                }
                cat.insert("projectId".into(), pid.clone());
                to_db_object(cat, vec![("id", record_id("category", &id))])
            })
            .collect::<Vec<DbValue>>();
        vars.push((
            "categories",
            DbValue::Array(surrealdb::types::Array::from(list)),
        ));
    }

    if !nodes.is_empty() {
        statements.push("INSERT INTO entity $nodes;");
        let list = nodes
            .into_iter()
            .map(|mut node| {
                let id = take_id(&mut node, "id");
                node.insert("projectId".into(), pid.clone());
                to_db_object(node, vec![("id", record_id("entity", &id))])
            })
            .collect::<Vec<DbValue>>();
        vars.push(("nodes", DbValue::Array(surrealdb::types::Array::from(list))));
    }

    if !edges.is_empty() {
        statements.push("INSERT RELATION INTO relation $edges;");
        let list = edges
            .into_iter()
            .map(|mut edge| {
                let id = take_id(&mut edge, "id");
                let source = take_id(&mut edge, "sourceNodeId");
                let target = take_id(&mut edge, "targetNodeId");
                edge.insert("projectId".into(), pid.clone());
                to_db_object(
                    edge,
                    vec![
                        ("id", record_id("relation", &id)),
                        ("in", record_id("entity", &source)),
                        ("out", record_id("entity", &target)),
                    ],
                )
            })
            .collect::<Vec<DbValue>>();
        vars.push(("edges", DbValue::Array(surrealdb::types::Array::from(list))));
    }

    statements.push("COMMIT TRANSACTION;");
    db.query(statements.join("\n"))
        .bind(params(vars))
        .await?
        .check()?;
    Ok(())
}
