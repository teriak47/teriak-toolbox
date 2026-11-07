//! Port of server/routes/projects.ts

use std::collections::HashMap;

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::routing::{get, post};
use axum::Router;
use serde_json::{json, Map, Value};

use crate::bulk::{insert_project_graph, ProjectGraph};
use crate::bundles::{
    build_export_bundle, graph_payload, import_project_bundle, load_project_graph,
};
use crate::http::{created, ok, read_body, ApiError, ApiResult};
use crate::model::{
    map_project, normalize_link_types, normalize_saved_views, rows, sanitize_metadata,
};
use crate::presets::{load_user_preset, preset_categories, PRESET_NAMES};
use crate::util::{
    from_db, generate_id, js_string, now_iso, opt_string, params, record_id, to_db, Json,
};
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/projects", get(list).post(create))
        .route("/api/projects/demo", post(create_demo))
        .route("/api/projects/import", post(import))
        .route("/api/projects/{id}/export", get(export))
        .route("/api/projects/{id}/duplicate", post(duplicate))
        .route(
            "/api/projects/{id}",
            get(get_graph).patch(update).delete(remove),
        )
}

fn as_json(value: Value) -> Json {
    value.as_object().cloned().unwrap_or_default()
}

// List all projects with counts
async fn list(State(state): State<AppState>) -> ApiResult {
    // Counts are computed by the database (GROUP BY) instead of loading every record
    let mut res = state
        .db
        .query(
            "SELECT * FROM project ORDER BY updatedAt DESC;
             SELECT projectId, count() AS n FROM category GROUP BY projectId;
             SELECT projectId, count() AS n FROM entity GROUP BY projectId;
             SELECT projectId, count() AS n FROM relation GROUP BY projectId;",
        )
        .await?
        .check()?;
    let raw_projects = rows(from_db(res.take(0)?));
    let mut counts: Vec<HashMap<String, i64>> = Vec::new();
    for index in 1..=3 {
        let map = rows(from_db(res.take(index)?))
            .into_iter()
            .map(|row| {
                let n = row.get("n").and_then(Value::as_f64).unwrap_or(0.0) as i64;
                (js_string(row.get("projectId"), ""), n)
            })
            .collect();
        counts.push(map);
    }

    let projects: Vec<Value> = raw_projects
        .iter()
        .map(|raw| {
            let mut p = as_json(map_project(raw));
            let id = js_string(p.get("id"), "");
            for (key, map) in ["categoryCount", "nodeCount", "edgeCount"]
                .iter()
                .zip(&counts)
            {
                p.insert((*key).into(), json!(map.get(&id).copied().unwrap_or(0)));
            }
            Value::Object(p)
        })
        .collect();
    ok(json!({ "projects": projects }))
}

// Create a new project with optional category preset
async fn create(State(state): State<AppState>, body: Bytes) -> ApiResult {
    let body = read_body(&body)?;
    let name = opt_string(body.get("name"))
        .unwrap_or("")
        .trim()
        .to_string();
    if name.is_empty() {
        return Err(ApiError::bad_request("Le nom du projet est requis."));
    }

    let id = generate_id();
    let now = now_iso();
    let preset = match opt_string(body.get("preset")) {
        Some(p) if PRESET_NAMES.contains(&p) => p,
        _ => "osint",
    };
    let project = json!({
        "id": id,
        "name": name,
        "description": opt_string(body.get("description")).unwrap_or("").trim(),
        "createdAt": now,
        "updatedAt": now,
    });

    // A preset saved by the user takes the place of a built-in one
    let mut defs = preset_categories(preset);
    if let Some(user_preset_id) = opt_string(body.get("userPresetId")).filter(|s| !s.is_empty()) {
        let Some(user_preset) = load_user_preset(&state.db, user_preset_id).await? else {
            return Err(ApiError::not_found("Preset introuvable."));
        };
        defs = user_preset["categories"]
            .as_array()
            .cloned()
            .unwrap_or_default();
    }
    let category_count = defs.len();

    insert_project_graph(
        &state.db,
        ProjectGraph {
            project: as_json(project.clone()),
            categories: defs
                .into_iter()
                .map(|def| {
                    let mut cat = as_json(def);
                    cat.insert("id".into(), json!(generate_id()));
                    cat
                })
                .collect(),
            nodes: vec![],
            edges: vec![],
        },
    )
    .await?;

    let mut out = as_json(project);
    out.insert("categoryCount".into(), json!(category_count));
    out.insert("nodeCount".into(), json!(0));
    out.insert("edgeCount".into(), json!(0));
    created(json!({ "project": out }))
}

// Create a pre-populated demonstration project
async fn create_demo(State(state): State<AppState>) -> ApiResult {
    let project_id = generate_id();
    let now = now_iso();

    let categories: Vec<Json> = preset_categories("cyber")
        .into_iter()
        .map(|def| {
            let mut cat = as_json(def);
            cat.insert("id".into(), json!(generate_id()));
            cat
        })
        .collect();
    let cat_ids: HashMap<String, String> = categories
        .iter()
        .map(|c| (js_string(c.get("name"), ""), js_string(c.get("id"), "")))
        .collect();
    let cat = |name: &str| json!(cat_ids.get(name));

    let demo_nodes = vec![
        (
            "actor",
            json!({
                "categoryId": cat("Acteur malveillant"),
                "title": "Groupe \"NightOwl\" (APT-X)",
                "positionX": -320, "positionY": -120, "reliability": "B2",
                "metadata": { "Origine": "Cluster Est-Européen", "Statut": "Actif" },
                "content": "### Profil de menace\nGroupe observé depuis **fin 2025** ciblant des dépôts CI/CD.\n\n- Réutilisation de certificats auto-signés spécifiques\n- Fenêtres d'activité : `06:00 - 15:00 UTC`\n- TTPs proches d'anciennes campagnes *ShadowLoader*.",
            }),
        ),
        (
            "malware",
            json!({
                "categoryId": cat("Malware / Outil"),
                "title": "Implant \"ChimeraLoader.dll\"",
                "positionX": -20, "positionY": -95, "reliability": "A1",
                "metadata": { "Famille": "ChimeraLoader", "SHA-256": "9f86d081884c7d659a2f...", "Langage": "Rust / C++" },
                "content": "### Analyse statique\nDLL injectée par *side-loading* lors de l'étape de build.\n\n```text\nMutex: Global\\Chm_Sync_991\n Sleep jitter: 45s ± 30%\n```\nExfiltre les variables d'environnement chiffrées en ChaCha20.",
            }),
        ),
        (
            "c2",
            json!({
                "categoryId": cat("IP / Serveur"),
                "title": "Relais C2 192.0.2.42",
                "positionX": 290, "positionY": -160, "reliability": "A1",
                "metadata": { "IP": "192.0.2.42", "ASN": "AS205100", "Port": "8443 / TLS 1.3" },
                "content": "### Télémétrie Réseau\nNoeud relais contacté toutes les 45 secondes par `ChimeraLoader.dll`.\n\n- Certificat TLS émis le `2026-10-14`\n- Hébergeur VPS payé en Monero selon réponse réquisition.",
            }),
        ),
        (
            "domain",
            json!({
                "categoryId": cat("Domaine / URL"),
                "title": "telemetry[.]example",
                "positionX": 310, "positionY": 85,
                "metadata": { "Domaine": "telemetry.example", "Registrar": "NameCheap", "Création": "2026-09-29" },
                "content": "Domaine de *fallback* codé en dur dans la configuration chiffrée du loader.\nPointe vers `192.0.2.42` via enregistrement A.",
            }),
        ),
        (
            "org",
            json!({
                "categoryId": cat("Organisation / Victime"),
                "title": "NovaTech CI/CD Pipeline",
                "positionX": -40, "positionY": 135,
                "metadata": { "Impact": "Critique", "Date": "2026-10-22", "Périmètre": "Runner Build #04" },
                "content": "### Point d'entrée initial\nCompromission d'un token de publication secondaire ayant permis l'injection de `ChimeraLoader.dll` dans la release `v4.2.1`.",
            }),
        ),
        (
            "evidence",
            json!({
                "categoryId": cat("Preuve / Rapport"),
                "title": "Logs Forensics Runner #04",
                "positionX": 95, "positionY": 315, "reliability": "A1",
                "metadata": { "Source": "EDR + Auditd", "Horodatage": "2026-10-22 08:14 UTC" },
                "content": "Capture mémoire et journaux système confirmant l'exécution du binaire malveillant et la connexion sortante vers `192.0.2.42:8443`.",
            }),
        ),
        (
            "theory",
            json!({
                "categoryId": cat("Hypothèse"),
                "title": "Phishing DevOps ou Fuite Token ?",
                "positionX": -285, "positionY": 175,
                "metadata": { "Statut": "En vérification", "Priorité": "Haute" },
                "content": "### Hypothèse de travail\nLe token CI/CD n'avait pas expiré malgré la politique de rotation à 30 jours.\n\n1. **Piste A :** Spear-phishing d'un ingénieur DevOps le 18/10.\n2. **Piste B :** Fuite involontaire dans un dépôt public forké.",
            }),
        ),
    ];
    let node_ids: HashMap<&str, String> = demo_nodes
        .iter()
        .map(|(key, _)| (*key, generate_id()))
        .collect();

    let demo_edges = [
        ("actor", "malware", "développe probable", "dashed", true),
        ("malware", "c2", "communique avec (TLS)", "solid", true),
        ("domain", "c2", "résout vers (DNS A)", "solid", true),
        ("malware", "domain", "domaine de secours", "solid", true),
        ("org", "malware", "infecté par", "solid", true),
        ("evidence", "org", "documente intrusion", "solid", true),
        ("theory", "org", "explique accès initial ?", "dashed", true),
        ("actor", "theory", "vecteur supposé", "dashed", false),
    ];

    let nodes = demo_nodes
        .into_iter()
        .map(|(key, node)| {
            let mut n = as_json(node);
            let metadata = sanitize_metadata(n.get("metadata"));
            n.insert("metadata".into(), metadata);
            n.insert("id".into(), json!(node_ids[key]));
            n.insert("createdAt".into(), json!(now));
            n.insert("updatedAt".into(), json!(now));
            n
        })
        .collect();
    let edges = demo_edges
        .iter()
        .map(|(from, to, label, style, directed)| {
            as_json(json!({
                "id": generate_id(),
                "sourceNodeId": node_ids[from],
                "targetNodeId": node_ids[to],
                "label": label,
                "style": style,
                "directed": directed,
                "color": null,
                "notes": "",
                "sourceHandle": null,
                "targetHandle": null,
                "createdAt": now,
                "updatedAt": now,
            }))
        })
        .collect();

    insert_project_graph(
        &state.db,
        ProjectGraph {
            project: as_json(json!({
                "id": project_id,
                "name": "Opération Chimère — Enquête Cyber & Intrusion",
                "description": "Analyse croisée d'une compromission supply-chain : corrélation d'infrastructures C2, artefacts malveillants, acteurs menaçants et hypothèses d'attribution.",
                "createdAt": now,
                "updatedAt": now,
            })),
            categories,
            nodes,
            edges,
        },
    )
    .await?;

    created(json!({ "projectId": project_id }))
}

// Export full project as JSON bundle
async fn export(State(state): State<AppState>, Path(id): Path<String>) -> ApiResult {
    match build_export_bundle(&state.db, &id).await? {
        Some(bundle) => ok(bundle),
        None => Err(ApiError::not_found("Projet introuvable.")),
    }
}

// Duplicate a project: a copy with new ids, named "<name> (copie)", in one transaction
async fn duplicate(State(state): State<AppState>, Path(id): Path<String>) -> ApiResult {
    let Some(bundle) = build_export_bundle(&state.db, &id).await? else {
        return Err(ApiError::not_found("Projet introuvable."));
    };
    let name = format!("{} (copie)", js_string(bundle["project"].get("name"), ""));
    let project = import_project_bundle(&state.db, &as_json(bundle), Some(name)).await?;
    created(json!({ "project": project }))
}

// Import full project from JSON bundle (with safe ID remapping to avoid collisions)
async fn import(State(state): State<AppState>, body: Bytes) -> ApiResult {
    let bundle = read_body(&body)?;
    match import_project_bundle(&state.db, &bundle, None).await? {
        Some(project) => created(json!({ "project": project })),
        None => Err(ApiError::bad_request(
            "Fichier JSON invalide : structure de projet Graphax attendue.",
        )),
    }
}

// Get full project graph payload
async fn get_graph(State(state): State<AppState>, Path(id): Path<String>) -> ApiResult {
    let Some((project, categories, nodes, edges)) = load_project_graph(&state.db, &id).await?
    else {
        return Err(ApiError::not_found("Projet introuvable."));
    };
    ok(Value::Object(graph_payload(
        &project, categories, &nodes, &edges,
    )))
}

// Update project metadata
async fn update(State(state): State<AppState>, Path(id): Path<String>, body: Bytes) -> ApiResult {
    let body = read_body(&body)?;
    let mut patch = Map::new();
    patch.insert("updatedAt".into(), json!(now_iso()));

    // Link types replace the whole map (MERGE would keep removed names); an object is expected
    let link_types = match body.get("linkTypes") {
        None => None,
        Some(Value::Object(_)) => Some(normalize_link_types(body.get("linkTypes"))),
        Some(_) => {
            return Err(ApiError::bad_request(
                "Types de liens invalides : un objet couleur → nom est attendu.",
            ))
        }
    };
    // Saved views also replace the whole list
    let saved_views = match body.get("savedViews") {
        None => None,
        Some(Value::Array(_)) => Some(normalize_saved_views(body.get("savedViews"))),
        Some(_) => {
            return Err(ApiError::bad_request(
                "Vues enregistrées invalides : une liste est attendue.",
            ))
        }
    };
    if let Some(name) = opt_string(body.get("name"))
        .map(str::trim)
        .filter(|n| !n.is_empty())
    {
        patch.insert("name".into(), json!(name));
    }
    if let Some(description) = opt_string(body.get("description")) {
        patch.insert("description".into(), json!(description.trim()));
    }

    let mut statements = Vec::new();
    let mut vars = vec![
        ("pid", record_id("project", &id)),
        ("patch", to_db(Value::Object(patch))),
    ];
    if let Some(link_types) = link_types {
        statements.push("UPDATE $pid SET linkTypes = $linkTypes;");
        vars.push(("linkTypes", to_db(link_types)));
    }
    if let Some(saved_views) = saved_views {
        statements.push("UPDATE $pid SET savedViews = $savedViews;");
        vars.push(("savedViews", to_db(Value::Array(saved_views))));
    }
    statements.push("UPDATE ONLY $pid MERGE $patch;");
    let last = statements.len() - 1;

    let mut res = state
        .db
        .query(statements.join(" "))
        .bind(params(vars))
        .await?
        .check()?;
    match from_db(res.take(last)?) {
        Value::Object(updated) => ok(json!({ "project": map_project(&updated) })),
        _ => Err(ApiError::not_found("Projet introuvable.")),
    }
}

// Delete project and all associated records
async fn remove(State(state): State<AppState>, Path(id): Path<String>) -> ApiResult {
    state
        .db
        .query(
            "BEGIN TRANSACTION;
             DELETE relation WHERE projectId = $projectId;
             DELETE entity WHERE projectId = $projectId;
             DELETE category WHERE projectId = $projectId;
             DELETE $pid;
             COMMIT TRANSACTION;",
        )
        .bind(params(vec![
            ("projectId", to_db(json!(id))),
            ("pid", record_id("project", &id)),
        ]))
        .await?
        .check()?;
    ok(json!({ "deleted": true }))
}
