//! Port of server/presets.ts and of the user preset loading in server/routes/presets.ts

use serde_json::{json, Map, Value};
use surrealdb::engine::local::Db;
use surrealdb::Surreal;

use super::model::{
    category_icon, category_shape, normalize_category_keys, normalize_color, DEFAULT_CATEGORY_COLOR,
};
use super::util::{extract_id, from_db, js_string, opt_string, params, record_id, Json};

fn cat(name: &str, icon: &str, shape: &str, color: &str, keys: &[&str], card: &[&str]) -> Value {
    json!({ "name": name, "icon": icon, "shape": shape, "color": color, "metadataKeys": keys, "cardKeys": card })
}

pub const PRESET_NAMES: &[&str] = &["osint", "cyber", "lore", "research", "empty"];

/// Categories of a built-in preset (shapes and colours as in server/presets.ts)
pub fn preset_categories(preset: &str) -> Vec<Value> {
    match preset {
        "osint" => vec![
            cat(
                "Personne",
                "user",
                "circle",
                "#89d7f9",
                &[
                    "Nom complet",
                    "Alias",
                    "Date de naissance",
                    "Nationalité",
                    "Rôle",
                ],
                &["Rôle"],
            ),
            cat(
                "Organisation",
                "building",
                "sharp",
                "#6693aa",
                &["Secteur", "Pays", "Site web"],
                &["Secteur"],
            ),
            cat(
                "Compte en ligne",
                "at-sign",
                "hexagon",
                "#60ccc5",
                &["Plateforme", "Identifiant", "URL", "Créé le"],
                &["Plateforme", "Identifiant"],
            ),
            cat(
                "Contact (tél., e-mail)",
                "phone",
                "hexagon",
                "#47c0ef",
                &["Type", "Valeur", "Opérateur"],
                &["Valeur"],
            ),
            cat(
                "Lieu",
                "map-pin",
                "sharp",
                "#7bc897",
                &["Adresse", "Ville", "Pays", "Coordonnées"],
                &["Ville"],
            ),
            cat(
                "Événement",
                "clock",
                "sharp",
                "#c4bfb4",
                &["Date", "Lieu"],
                &["Date"],
            ),
            cat(
                "Document / Preuve",
                "file-text",
                "cut",
                "#deb775",
                &["Source", "Date", "URL"],
                &["Source"],
            ),
            cat(
                "Hypothèse",
                "lightbulb",
                "diamond",
                "#efaf69",
                &["Statut", "Priorité"],
                &["Statut"],
            ),
        ],
        "cyber" => vec![
            cat(
                "Acteur malveillant",
                "skull",
                "octagon",
                "#f28881",
                &["Alias", "Origine", "Motivation", "Statut"],
                &["Statut"],
            ),
            cat(
                "Malware / Outil",
                "bug",
                "octagon",
                "#e89dc0",
                &["Famille", "SHA-256", "Langage"],
                &["Famille"],
            ),
            cat(
                "Vulnérabilité / Technique",
                "shield-alert",
                "octagon",
                "#c1a9ee",
                &["CVE", "MITRE ATT&CK", "Gravité"],
                &["CVE"],
            ),
            cat(
                "IP / Serveur",
                "server",
                "hexagon",
                "#47c0ef",
                &["IP", "ASN", "Pays", "Port", "Première vue"],
                &["IP"],
            ),
            cat(
                "Domaine / URL",
                "globe",
                "hexagon",
                "#0093c5",
                &["Domaine", "Registrar", "Création", "Résout vers"],
                &["Domaine"],
            ),
            cat(
                "Organisation / Victime",
                "building",
                "sharp",
                "#6693aa",
                &["Secteur", "Pays", "Impact"],
                &["Impact"],
            ),
            cat(
                "Preuve / Rapport",
                "file-text",
                "cut",
                "#deb775",
                &["Source", "Horodatage"],
                &["Source"],
            ),
            cat(
                "Hypothèse",
                "lightbulb",
                "diamond",
                "#efaf69",
                &["Statut", "Priorité", "Confiance"],
                &["Statut"],
            ),
        ],
        "lore" => vec![
            cat(
                "Personnage",
                "user",
                "circle",
                "#89d7f9",
                &["Rôle", "Faction", "Statut"],
                &["Rôle"],
            ),
            cat(
                "Faction / Groupe",
                "users",
                "sharp",
                "#6693aa",
                &["Chef", "Territoire"],
                &[],
            ),
            cat(
                "Lieu / Région",
                "map-pin",
                "sharp",
                "#7bc897",
                &["Région", "Type"],
                &["Région"],
            ),
            cat(
                "Événement",
                "clock",
                "sharp",
                "#c4bfb4",
                &["Date", "Lieu"],
                &["Date"],
            ),
            cat(
                "Artefact / Relique",
                "key",
                "cut",
                "#deb775",
                &["Détenteur", "Pouvoir"],
                &["Détenteur"],
            ),
            cat(
                "Créature / Menace",
                "skull",
                "octagon",
                "#f28881",
                &["Type", "Territoire"],
                &["Type"],
            ),
            cat(
                "Théorie / Mystère",
                "lightbulb",
                "diamond",
                "#efaf69",
                &["Statut"],
                &["Statut"],
            ),
        ],
        "research" => vec![
            cat(
                "Concept clé",
                "book-open",
                "sharp",
                "#47c0ef",
                &["Domaine"],
                &[],
            ),
            cat(
                "Source / Document",
                "file-text",
                "cut",
                "#deb775",
                &["Auteur", "Date", "URL"],
                &["Auteur"],
            ),
            cat(
                "Auteur / Entité",
                "user",
                "circle",
                "#89d7f9",
                &["Affiliation"],
                &["Affiliation"],
            ),
            cat(
                "Hypothèse",
                "lightbulb",
                "diamond",
                "#efaf69",
                &["Statut", "Confiance"],
                &["Statut"],
            ),
            cat(
                "Contradiction / Risque",
                "shield-alert",
                "octagon",
                "#f28881",
                &["Gravité"],
                &["Gravité"],
            ),
        ],
        _ => Vec::new(),
    }
}

/// `mapPresetCategories()`: clean categories of a saved preset
pub fn map_preset_categories(value: Option<&Value>) -> Vec<Value> {
    let Some(Value::Array(items)) = value else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(Value::as_object)
        .map(|cat| {
            let mut out = Map::new();
            let name = opt_string(cat.get("name")).unwrap_or("").trim();
            out.insert(
                "name".into(),
                json!(if name.is_empty() { "Catégorie" } else { name }),
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
            Value::Object(out)
        })
        .collect()
}

pub fn map_preset(raw: &Json) -> Value {
    json!({
        "id": extract_id(raw.get("id")),
        "name": js_string(raw.get("name"), "Preset"),
        "categories": map_preset_categories(raw.get("categories")),
        "createdAt": js_string(raw.get("createdAt"), ""),
    })
}

/// A saved preset, or None when it does not exist
pub async fn load_user_preset(
    db: &Surreal<Db>,
    preset_id: &str,
) -> surrealdb::Result<Option<Value>> {
    let mut res = db
        .query("SELECT * FROM ONLY $id;")
        .bind(params(vec![("id", record_id("user_preset", preset_id))]))
        .await?
        .check()?;
    let raw = from_db(res.take(0)?);
    Ok(raw.as_object().map(map_preset))
}
