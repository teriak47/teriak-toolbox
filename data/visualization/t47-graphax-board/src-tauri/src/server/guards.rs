//! Port of server/guards.ts and of `touchProject()` (server/mappers.ts)

use serde_json::{json, Value};
use surrealdb::engine::local::Db;
use surrealdb::Surreal;

use super::util::{extract_id, from_db, now_iso, params, record_id, to_db};

pub async fn project_exists(db: &Surreal<Db>, project_id: &str) -> surrealdb::Result<bool> {
    if project_id.is_empty() {
        return Ok(false);
    }
    let mut res = db
        .query("SELECT VALUE id FROM ONLY $pid;")
        .bind(params(vec![("pid", record_id("project", project_id))]))
        .await?
        .check()?;
    Ok(!matches!(from_db(res.take(0)?), Value::Null))
}

/// Ids, among `node_ids`, of nodes that exist and belong to the project
pub async fn nodes_in_project(
    db: &Surreal<Db>,
    project_id: &str,
    node_ids: &[String],
) -> surrealdb::Result<std::collections::HashSet<String>> {
    let mut ids: Vec<&String> = Vec::new();
    for id in node_ids.iter().filter(|id| !id.is_empty()) {
        if !ids.contains(&id) {
            ids.push(id);
        }
    }
    if project_id.is_empty() || ids.is_empty() {
        return Ok(Default::default());
    }
    let records: Vec<_> = ids.iter().map(|id| record_id("entity", id)).collect();
    let mut res = db
        .query("SELECT VALUE id FROM entity WHERE projectId = $projectId AND id IN $ids;")
        .bind(params(vec![
            ("projectId", to_db(json!(project_id))),
            ("ids", surrealdb::types::Value::Array(records.into())),
        ]))
        .await?
        .check()?;
    let found = from_db(res.take(0)?);
    Ok(found
        .as_array()
        .into_iter()
        .flatten()
        .map(|v| extract_id(Some(v)))
        .collect())
}

pub async fn category_in_project(
    db: &Surreal<Db>,
    project_id: &str,
    category_id: &str,
) -> surrealdb::Result<bool> {
    if project_id.is_empty() || category_id.is_empty() {
        return Ok(false);
    }
    let mut res = db
        .query("SELECT VALUE projectId FROM ONLY $cid;")
        .bind(params(vec![("cid", record_id("category", category_id))]))
        .await?
        .check()?;
    Ok(from_db(res.take(0)?).as_str() == Some(project_id))
}

/// Non-blocking timestamp update of a project
pub async fn touch_project(db: &Surreal<Db>, project_id: &str) {
    if project_id.is_empty() {
        return;
    }
    let _ = db
        .query("UPDATE $pid MERGE { updatedAt: $now };")
        .bind(params(vec![
            ("pid", record_id("project", project_id)),
            ("now", to_db(json!(now_iso()))),
        ]))
        .await;
}
