use std::path::Path;

use surrealdb::engine::local::{Db, SurrealKv};
use surrealdb::Surreal;

/// Same schema as `getDb()` in server/db.ts
const SCHEMA: &str = "
    DEFINE TABLE IF NOT EXISTS project SCHEMALESS;
    DEFINE TABLE IF NOT EXISTS category SCHEMALESS;
    DEFINE TABLE IF NOT EXISTS entity SCHEMALESS;
    DEFINE TABLE IF NOT EXISTS relation TYPE RELATION IN entity OUT entity SCHEMALESS;

    DEFINE INDEX IF NOT EXISTS idx_category_project ON TABLE category FIELDS projectId;
    DEFINE INDEX IF NOT EXISTS idx_entity_project ON TABLE entity FIELDS projectId;
    DEFINE INDEX IF NOT EXISTS idx_relation_project ON TABLE relation FIELDS projectId;
";

/// Opens (or creates) `<data_dir>/graphax.db` in namespace `graphax`, database `main`
pub async fn open_db(data_dir: &Path) -> surrealdb::Result<Surreal<Db>> {
    std::fs::create_dir_all(data_dir).map_err(|e| surrealdb::Error::internal(e.to_string()))?;
    let db_file = data_dir.join("graphax.db");

    let db = Surreal::new::<SurrealKv>(db_file.as_path()).await?;
    db.use_ns("graphax").use_db("main").await?;
    db.query(SCHEMA).await?.check()?;

    println!(
        "[Graphax DB Rust] SurrealDB Embedded connecté -> {}",
        db_file.display()
    );
    Ok(db)
}
