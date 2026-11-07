//! Rust API checks, mirroring the health and local-only cases of tests/api.test.ts

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;

use graphax_lib::server::{open_db, router, AppState, APP_VERSION};

const PORT: u16 = 3457;
const HOST: &str = "127.0.0.1:3457";

async fn app() -> (axum::Router, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let db = open_db(dir.path()).await.unwrap();
    (router(AppState { db }, PORT), dir)
}

async fn call(app: &axum::Router, headers: &[(&str, &str)]) -> (StatusCode, Value) {
    let mut req = Request::get("/api/health");
    for (name, value) in headers {
        req = req.header(*name, *value);
    }
    let res = app
        .clone()
        .oneshot(req.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[tokio::test]
async fn health_reports_version_and_engine() {
    let (app, _dir) = app().await;
    let (status, json) = call(&app, &[("host", HOST)]).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["ok"], true);
    assert_eq!(json["version"], APP_VERSION);
    assert_eq!(json["engine"], "surrealdb-embedded-surrealkv");
}

#[test]
fn version_matches_package_json() {
    let raw =
        std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../package.json")).unwrap();
    let package: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(package["version"], APP_VERSION);
}

#[tokio::test]
async fn rejects_unknown_host() {
    let (app, _dir) = app().await;
    let (status, json) = call(&app, &[("host", "evil.example:3457")]).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(json["error"], "Hôte non autorisé.");
}

#[tokio::test]
async fn rejects_foreign_origin() {
    let (app, _dir) = app().await;
    let (status, json) = call(&app, &[("host", HOST), ("origin", "https://evil.example")]).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(json["error"], "Origine non autorisée.");
}

#[tokio::test]
async fn rejects_cross_site_request_without_origin() {
    let (app, _dir) = app().await;
    let (status, json) = call(&app, &[("host", HOST), ("sec-fetch-site", "cross-site")]).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(json["error"], "Requête inter-sites non autorisée.");
}

#[tokio::test]
async fn accepts_dev_client_origin() {
    let (app, _dir) = app().await;
    let (status, _) = call(&app, &[("host", HOST), ("origin", "http://localhost:5173")]).await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn reopens_existing_database() {
    let dir = tempfile::tempdir().unwrap();
    {
        let db = open_db(dir.path()).await.unwrap();
        db.query("CREATE project:demo SET name = 'Projet fictif'")
            .await
            .unwrap()
            .check()
            .unwrap();
    }
    // The engine releases the file lock in the background once the last handle is dropped
    let mut attempt = 0;
    let db = loop {
        match open_db(dir.path()).await {
            Ok(db) => break db,
            Err(err) if attempt < 40 => {
                attempt += 1;
                assert!(err.to_string().contains("locked"), "{err}");
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
            Err(err) => panic!("{err}"),
        }
    };
    let mut res = db
        .query("SELECT VALUE name FROM project:demo")
        .await
        .unwrap();
    let names: Vec<String> = res.take(0).unwrap();
    assert_eq!(names, vec!["Projet fictif".to_string()]);
}

async fn send(app: &axum::Router, method: &str, uri: &str, body: Value) -> (StatusCode, Value) {
    let req = Request::builder()
        .method(method)
        .uri(uri)
        .header("host", HOST)
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

// Same case as "appends new categories, and keeps older projects sorted by name" in
// tests/api.test.ts, whose second half writes to the Node database directly
#[tokio::test]
async fn legacy_categories_without_position_stay_sorted_by_name() {
    let dir = tempfile::tempdir().unwrap();
    let db = open_db(dir.path()).await.unwrap();
    let app = router(AppState { db: db.clone() }, PORT);

    let (_, created) = send(
        &app,
        "POST",
        "/api/projects",
        serde_json::json!({ "name": "Ancien projet", "preset": "empty" }),
    )
    .await;
    let pid = created["project"]["id"].as_str().unwrap().to_string();
    db.query("INSERT INTO category [{ projectId: $p, name: 'Zèbre', color: '#47c0ef', icon: 'tag', shape: 'sharp' }, { projectId: $p, name: 'Bœuf', color: '#47c0ef', icon: 'tag', shape: 'sharp' }];")
        .bind(("p", pid.clone()))
        .await
        .unwrap()
        .check()
        .unwrap();

    let (status, _) = send(
        &app,
        "POST",
        &format!("/api/projects/{pid}/categories"),
        serde_json::json!({ "name": "Cheval" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let (_, graph) = send(&app, "GET", &format!("/api/projects/{pid}"), Value::Null).await;
    let names: Vec<&str> = graph["categories"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["Bœuf", "Cheval", "Zèbre"]);
}

async fn count(
    db: &surrealdb::Surreal<surrealdb::engine::local::Db>,
    query: &str,
    pid: &str,
) -> i64 {
    let mut res = db
        .query(query)
        .bind(("p", pid.to_string()))
        .await
        .unwrap()
        .check()
        .unwrap();
    let n: Option<i64> = res.take(0).unwrap();
    n.unwrap_or(0)
}

async fn create_node(app: &axum::Router, pid: &str, title: &str) -> String {
    let (status, json) = send(
        app,
        "POST",
        &format!("/api/projects/{pid}/nodes"),
        serde_json::json!({ "title": title }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    json["node"]["id"].as_str().unwrap().to_string()
}

// Same case as "deletes a project with all its records" in tests/api.test.ts, whose final
// check reads the Node database
#[tokio::test]
async fn deletes_a_project_with_all_its_records() {
    let dir = tempfile::tempdir().unwrap();
    let db = open_db(dir.path()).await.unwrap();
    let app = router(AppState { db: db.clone() }, PORT);
    let (_, created) = send(
        &app,
        "POST",
        "/api/projects",
        serde_json::json!({ "name": "À supprimer" }),
    )
    .await;
    let pid = created["project"]["id"].as_str().unwrap().to_string();
    let a = create_node(&app, &pid, "A").await;
    let b = create_node(&app, &pid, "B").await;
    let (status, _) = send(
        &app,
        "POST",
        &format!("/api/projects/{pid}/edges"),
        serde_json::json!({ "sourceNodeId": a, "targetNodeId": b }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, _) = send(&app, "DELETE", &format!("/api/projects/{pid}"), Value::Null).await;
    assert_eq!(status, StatusCode::OK);
    for table in ["entity", "relation", "category"] {
        let q = format!("RETURN count(SELECT id FROM {table} WHERE projectId = $p);");
        assert_eq!(count(&db, &q, &pid).await, 0, "{table}");
    }
}

// Same case as "refuses a deletion too large to be undone in one restore", which inserts
// its nodes in the Node database
#[tokio::test]
async fn refuses_a_deletion_too_large_to_be_undone() {
    const MAX: usize = 5000;
    let dir = tempfile::tempdir().unwrap();
    let db = open_db(dir.path()).await.unwrap();
    let app = router(AppState { db: db.clone() }, PORT);
    let (_, created) = send(
        &app,
        "POST",
        "/api/projects",
        serde_json::json!({ "name": "Suppression trop grande" }),
    )
    .await;
    let pid = created["project"]["id"].as_str().unwrap().to_string();
    let ids: Vec<String> = (0..MAX).map(|i| format!("big{i}")).collect();
    let rows: Vec<Value> = ids
        .iter()
        .map(|id| serde_json::json!({ "id": id, "projectId": pid, "title": "n", "content": "", "positionX": 0, "positionY": 0, "metadata": {} }))
        .collect();
    db.query("INSERT INTO entity $rows;")
        .bind(("rows", Value::Array(rows)))
        .await
        .unwrap()
        .check()
        .unwrap();
    let hub = create_node(&app, &pid, "Hub").await;
    let (status, _) = send(
        &app,
        "POST",
        &format!("/api/projects/{pid}/edges"),
        serde_json::json!({ "sourceNodeId": hub, "targetNodeId": ids[0] }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let mut too_many: Vec<String> = ids[..MAX - 1].to_vec();
    too_many.push(hub);
    let (status, json) = send(
        &app,
        "POST",
        &format!("/api/projects/{pid}/nodes/delete"),
        serde_json::json!({ "ids": too_many }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(json["error"].as_str().unwrap().contains("Trop d’éléments"));
    let (_, json) = send(
        &app,
        "POST",
        &format!("/api/projects/{pid}/nodes/delete"),
        serde_json::json!({ "ids": &ids[1..10] }),
    )
    .await;
    assert_eq!(json["deleted"], 9);
}
