//! Port of server/snapshots.ts: a project's export bundle written as a JSON file under
//! <data dir>/snapshots/<projectId>/. The files use the export format, so any of them can
//! also be opened with "Importer" on the project list, even after the project was deleted.
//! Automatic snapshots are taken when a project changed since its last snapshot and only
//! the latest ones are kept; manual ones stay until they are deleted.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};
use surrealdb::engine::local::Db;
use surrealdb::Surreal;

use super::bundles::build_export_bundle;
use super::model::rows;
use super::util::{extract_id, from_db, js_string, now_iso};

pub const AUTO_SNAPSHOTS_KEPT: usize = 10;
pub const MANUAL_SNAPSHOTS_MAX: usize = 50;

pub fn is_project_id(id: &str) -> bool {
    (1..=64).contains(&id.len())
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// `<date>_<kind>.json`, the date with ":" and "." replaced so it is a valid file name
pub fn is_snapshot_name(name: &str) -> bool {
    parse_name(name).is_some()
}

fn parse_name(name: &str) -> Option<(String, &'static str)> {
    let (stamp, kind) = match name.strip_suffix("_auto.json") {
        Some(s) => (s, "auto"),
        None => (name.strip_suffix("_manual.json")?, "manual"),
    };
    const TEMPLATE: &str = "dddd-dd-ddTdd-dd-dd-dddZ";
    if stamp.len() != TEMPLATE.len()
        || !stamp.chars().zip(TEMPLATE.chars()).all(|(c, t)| {
            if t == 'd' {
                c.is_ascii_digit()
            } else {
                c == t
            }
        })
    {
        return None;
    }
    let (date, time) = stamp.split_once('T')?;
    let parts: Vec<&str> = time.trim_end_matches('Z').split('-').collect();
    let created_at = format!(
        "{date}T{}:{}:{}.{}Z",
        parts[0], parts[1], parts[2], parts[3]
    );
    Some((created_at, kind))
}

fn file_name(created_at: &str, kind: &str) -> String {
    format!("{}_{kind}.json", created_at.replace([':', '.'], "-"))
}

pub fn snapshots_root(data_dir: &Path) -> PathBuf {
    data_dir.join("snapshots")
}

fn project_dir(data_dir: &Path, project_id: &str) -> std::io::Result<PathBuf> {
    if !is_project_id(project_id) {
        return Err(std::io::Error::other("Identifiant de projet invalide."));
    }
    Ok(snapshots_root(data_dir).join(project_id))
}

/// Snapshots of a project, newest first (counts read from each file)
pub fn list_snapshots(data_dir: &Path, project_id: &str) -> std::io::Result<Vec<Value>> {
    let dir = project_dir(data_dir, project_id)?;
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut out: Vec<(String, Value)> = Vec::new();
    for entry in fs::read_dir(&dir)? {
        let name = entry?.file_name().to_string_lossy().to_string();
        let Some((created_at, kind)) = parse_name(&name) else {
            continue;
        };
        // Unreadable file: not listed
        let Ok(text) = fs::read_to_string(dir.join(&name)) else {
            continue;
        };
        let Ok(bundle) = serde_json::from_str::<Value>(&text) else {
            continue;
        };
        let len = |k: &str| bundle.get(k).and_then(Value::as_array).map_or(0, Vec::len);
        let mut snapshot = Map::new();
        snapshot.insert("name".into(), json!(name));
        snapshot.insert("createdAt".into(), json!(created_at));
        snapshot.insert("kind".into(), json!(kind));
        snapshot.insert("nodeCount".into(), json!(len("nodes")));
        snapshot.insert("edgeCount".into(), json!(len("edges")));
        if let Some(updated) = bundle
            .get("project")
            .and_then(|p| p.get("updatedAt"))
            .and_then(Value::as_str)
        {
            snapshot.insert("projectUpdatedAt".into(), json!(updated));
        }
        out.push((created_at, Value::Object(snapshot)));
    }
    out.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(out.into_iter().map(|(_, v)| v).collect())
}

pub fn read_snapshot(
    data_dir: &Path,
    project_id: &str,
    name: &str,
) -> std::io::Result<Option<Value>> {
    if !is_snapshot_name(name) {
        return Ok(None);
    }
    let file = project_dir(data_dir, project_id)?.join(name);
    if !file.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(file)?;
    serde_json::from_str(&text)
        .map(Some)
        .map_err(std::io::Error::other)
}

pub fn delete_snapshot(data_dir: &Path, project_id: &str, name: &str) -> bool {
    if !is_snapshot_name(name) {
        return false;
    }
    let Ok(dir) = project_dir(data_dir, project_id) else {
        return false;
    };
    let file = dir.join(name);
    file.exists() && fs::remove_file(file).is_ok()
}

#[derive(Debug)]
pub enum SnapshotError {
    Db(surrealdb::Error),
    Io(std::io::Error),
}

impl From<surrealdb::Error> for SnapshotError {
    fn from(e: surrealdb::Error) -> Self {
        Self::Db(e)
    }
}

impl From<std::io::Error> for SnapshotError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

impl std::fmt::Display for SnapshotError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Db(e) => write!(f, "{e}"),
            Self::Io(e) => write!(f, "{e}"),
        }
    }
}

fn plus_one_ms(iso: &str) -> String {
    chrono::DateTime::parse_from_rfc3339(iso)
        .map(|d| {
            (d.with_timezone(&chrono::Utc) + chrono::Duration::milliseconds(1))
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
        })
        .unwrap_or_else(|_| now_iso())
}

/// Writes a snapshot of the project; None when the project does not exist
pub async fn create_snapshot(
    db: &Surreal<Db>,
    data_dir: &Path,
    project_id: &str,
    kind: &str,
) -> Result<Option<Value>, SnapshotError> {
    let dir = project_dir(data_dir, project_id)?;
    let Some(bundle) = build_export_bundle(db, project_id).await? else {
        return Ok(None);
    };
    fs::create_dir_all(&dir)?;
    let mut created_at = now_iso();
    // Two snapshots in the same millisecond would share a name
    while dir.join(file_name(&created_at, kind)).exists() {
        created_at = plus_one_ms(&created_at);
    }
    let name = file_name(&created_at, kind);
    // Written to a temporary file first, so a crash never leaves a half-written snapshot
    let tmp = dir.join(format!(".{name}.tmp"));
    fs::write(
        &tmp,
        serde_json::to_string_pretty(&bundle).unwrap_or_default(),
    )?;
    fs::rename(&tmp, dir.join(&name))?;
    prune_snapshots(data_dir, project_id)?;

    let len = |k: &str| bundle.get(k).and_then(Value::as_array).map_or(0, Vec::len);
    Ok(Some(json!({
        "name": name,
        "createdAt": created_at,
        "kind": kind,
        "nodeCount": len("nodes"),
        "edgeCount": len("edges"),
        "projectUpdatedAt": bundle["project"]["updatedAt"],
    })))
}

/// Keeps the latest automatic snapshots and a bounded number of manual ones
pub fn prune_snapshots(data_dir: &Path, project_id: &str) -> std::io::Result<()> {
    let all = list_snapshots(data_dir, project_id)?;
    let dir = project_dir(data_dir, project_id)?;
    let of_kind = |kind: &str, keep: usize| {
        all.iter()
            .filter(|s| s["kind"] == kind)
            .skip(keep)
            .map(|s| js_string(s.get("name"), ""))
            .collect::<Vec<_>>()
    };
    for name in of_kind("auto", AUTO_SNAPSHOTS_KEPT)
        .into_iter()
        .chain(of_kind("manual", MANUAL_SNAPSHOTS_MAX))
    {
        let _ = fs::remove_file(dir.join(name));
    }
    Ok(())
}

/// Takes an automatic snapshot of every project changed since its latest snapshot: the
/// project's revision (its updatedAt) is compared with the one captured in that snapshot,
/// not with the file's date, so an edit made while a snapshot was being written is never
/// skipped. Returns the ids of the projects snapshotted.
pub async fn run_auto_snapshots(
    db: &Surreal<Db>,
    data_dir: &Path,
) -> Result<Vec<String>, SnapshotError> {
    let mut res = db
        .query("SELECT id, updatedAt FROM project;")
        .await?
        .check()?;
    let mut done = Vec::new();
    for row in rows(from_db(res.take(0)?)) {
        let project_id = extract_id(row.get("id"));
        if !is_project_id(&project_id) {
            continue;
        }
        let latest = list_snapshots(data_dir, &project_id)?.into_iter().next();
        let updated_at = js_string(row.get("updatedAt"), "");
        if let Some(latest) = latest {
            if !updated_at.is_empty()
                && latest.get("projectUpdatedAt").and_then(Value::as_str) == Some(&updated_at)
            {
                continue;
            }
        }
        if create_snapshot(db, data_dir, &project_id, "auto")
            .await?
            .is_some()
        {
            done.push(project_id);
        }
    }
    Ok(done)
}
