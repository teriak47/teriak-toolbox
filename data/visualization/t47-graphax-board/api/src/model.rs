//! Port of server/mappers.ts, the validation helpers of server/validation.ts and the
//! normalisers of shared/types.ts.

use std::cmp::Ordering;
use std::collections::HashSet;

use serde_json::{json, Map, Value};
use unicode_normalization::UnicodeNormalization;

use super::util::{extract_id, js_number, js_slice, js_string, json_number, now_iso, truthy, Json};

pub const CATEGORY_SHAPES: &[&str] = &[
    "rounded", "sharp", "pill", "cut", "hexagon", "diamond", "octagon", "circle",
];
pub const CATEGORY_ICON_NAMES: &[&str] = &[
    "user",
    "users",
    "map-pin",
    "globe",
    "shield-alert",
    "bug",
    "server",
    "terminal",
    "key",
    "file-text",
    "lightbulb",
    "book-open",
    "building",
    "skull",
    "clock",
    "tag",
    "at-sign",
    "phone",
];

pub const DEFAULT_CATEGORY_COLOR: &str = "#47c0ef";
pub const DEFAULT_CATEGORY_ICON: &str = "tag";
pub const DEFAULT_CATEGORY_SHAPE: &str = "sharp";

const MAX_CATEGORY_KEYS: usize = 12;
const MAX_CARD_KEYS: usize = 2;
const MAX_METADATA_KEY_LENGTH: usize = 60;
const MAX_LINK_TYPE_NAME_LENGTH: usize = 40;
const MAX_LINK_TYPES: usize = 32;
const MAX_SAVED_VIEWS: usize = 30;
const MAX_SAVED_VIEW_NAME_LENGTH: usize = 60;
pub const UNCLASSIFIED_VIEW_ID: &str = "__unclassified__";

fn is_hex_color(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].chars().all(|c| matches!(c, '0'..='9' | 'a'..='f'))
}

/// Accepts #rgb or #rrggbb and returns the #rrggbb form; anything else is None
pub fn normalize_color(value: Option<&Value>) -> Option<String> {
    let hex = value?.as_str()?.trim().to_lowercase();
    if is_hex_color(&hex) {
        return Some(hex);
    }
    let short = hex.len() == 4
        && hex.starts_with('#')
        && hex[1..].chars().all(|c| matches!(c, '0'..='9' | 'a'..='f'));
    short.then(|| {
        let mut out = String::from("#");
        for ch in hex[1..].chars() {
            out.push(ch);
            out.push(ch);
        }
        out
    })
}

pub fn category_icon(value: Option<&Value>) -> &'static str {
    value
        .and_then(Value::as_str)
        .and_then(|v| CATEGORY_ICON_NAMES.iter().find(|i| **i == v))
        .copied()
        .unwrap_or(DEFAULT_CATEGORY_ICON)
}

pub fn category_shape(value: Option<&Value>) -> &'static str {
    value
        .and_then(Value::as_str)
        .and_then(|v| CATEGORY_SHAPES.iter().find(|s| **s == v))
        .copied()
        .unwrap_or(DEFAULT_CATEGORY_SHAPE)
}

pub fn normalize_handle(value: Option<&Value>) -> Value {
    match value.and_then(Value::as_str) {
        Some(s) if !s.is_empty() => Value::String(s.to_string()),
        _ => Value::Null,
    }
}

fn fold_key(key: &str) -> String {
    key.nfd()
        .filter(|c| !('\u{0300}'..='\u{036f}').contains(c))
        .collect::<String>()
        .to_lowercase()
}

pub fn normalize_key_list(input: Option<&Value>, max: usize) -> Vec<String> {
    let Some(Value::Array(items)) = input else {
        return Vec::new();
    };
    let mut seen = HashSet::new();
    let mut keys = Vec::new();
    for item in items {
        let Some(s) = item.as_str() else { continue };
        let key = js_slice(s.trim(), MAX_METADATA_KEY_LENGTH)
            .trim()
            .to_string();
        let folded = fold_key(&key);
        if key.is_empty() || !seen.insert(folded) {
            continue;
        }
        keys.push(key);
        if keys.len() >= max {
            break;
        }
    }
    keys
}

/// Default keys and card keys of a category; card keys are kept only when they are default keys
pub fn normalize_category_keys(metadata_keys: Option<&Value>, card_keys: Option<&Value>) -> Json {
    let keys = normalize_key_list(metadata_keys, MAX_CATEGORY_KEYS);
    let card: Vec<String> = normalize_key_list(card_keys, MAX_CATEGORY_KEYS)
        .iter()
        .filter_map(|k| keys.iter().find(|m| fold_key(m) == fold_key(k)).cloned())
        .take(MAX_CARD_KEYS)
        .collect();
    let mut out = Map::new();
    out.insert("metadataKeys".into(), json!(keys));
    out.insert("cardKeys".into(), json!(card));
    out
}

/// "b2", " B2 " -> "B2"; anything else -> null
pub fn normalize_reliability(value: Option<&Value>) -> Value {
    let Some(s) = value.and_then(Value::as_str) else {
        return Value::Null;
    };
    let code = s.trim().to_uppercase();
    let b = code.as_bytes();
    if b.len() == 2 && (b'A'..=b'F').contains(&b[0]) && (b'1'..=b'6').contains(&b[1]) {
        Value::String(code)
    } else {
        Value::Null
    }
}

pub fn normalize_link_types(value: Option<&Value>) -> Value {
    let mut out = Map::new();
    if let Some(Value::Object(map)) = value {
        for (key, name) in map {
            let color = key.trim().to_lowercase();
            let Some(name) = name.as_str() else { continue };
            if color != "default" && !is_hex_color(&color) {
                continue;
            }
            let label = js_slice(name.trim(), MAX_LINK_TYPE_NAME_LENGTH);
            if !label.is_empty() {
                out.insert(color, Value::String(label));
            }
            if out.len() >= MAX_LINK_TYPES {
                break;
            }
        }
    }
    Value::Object(out)
}

fn is_view_id(s: &str) -> bool {
    (1..=64).contains(&s.len())
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

pub fn normalize_saved_views(value: Option<&Value>) -> Vec<Value> {
    let Some(Value::Array(items)) = value else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for raw in items {
        let Some(v) = raw.as_object() else { continue };
        let id = v
            .get("id")
            .and_then(Value::as_str)
            .filter(|s| is_view_id(s));
        let name = v
            .get("name")
            .and_then(Value::as_str)
            .map(|n| js_slice(n.trim(), MAX_SAVED_VIEW_NAME_LENGTH))
            .unwrap_or_default();
        let Some(id) = id else { continue };
        if name.is_empty() || !seen.insert(id.to_string()) {
            continue;
        }
        let str_field = |k: &str| v.get(k).and_then(Value::as_str);
        let color = str_field("edgeColorFilter")
            .map(|c| c.trim().to_lowercase())
            .unwrap_or_default();

        let mut hidden: Vec<String> = Vec::new();
        if let Some(Value::Array(ids)) = v.get("hiddenCategoryIds") {
            for c in ids.iter().filter_map(Value::as_str) {
                if c.encode_utf16().count() <= 64 && !hidden.iter().any(|h| h == c) {
                    hidden.push(c.to_string());
                }
            }
        }

        let focus = match v.get("focus").and_then(Value::as_object) {
            Some(f)
                if f.get("nodeId")
                    .and_then(Value::as_str)
                    .is_some_and(|n| !n.is_empty()) =>
            {
                let d = js_number(f.get("depth"));
                let d = if d.is_nan() || d == 0.0 { 1.0 } else { d };
                let depth = (d + 0.5).floor().clamp(1.0, 3.0);
                json!({ "nodeId": f["nodeId"], "depth": json_number(depth) })
            }
            _ => Value::Null,
        };

        let finite = |x: Option<&Value>| x.and_then(Value::as_f64).filter(|f| f.is_finite());
        let viewport = match v.get("viewport").and_then(Value::as_object) {
            Some(vp) => match (
                finite(vp.get("x")),
                finite(vp.get("y")),
                finite(vp.get("zoom")),
            ) {
                (Some(_), Some(_), Some(z)) if z > 0.0 => {
                    json!({ "x": vp["x"], "y": vp["y"], "zoom": vp["zoom"] })
                }
                _ => Value::Null,
            },
            None => Value::Null,
        };

        let view_mode = str_field("viewMode")
            .filter(|m| matches!(*m, "table" | "timeline"))
            .unwrap_or("graph");
        let edge_filter = str_field("edgeFilter")
            .filter(|f| matches!(*f, "solid" | "dashed"))
            .unwrap_or("all");
        out.push(json!({
            "id": id,
            "name": name,
            "viewMode": view_mode,
            "hiddenCategoryIds": hidden,
            "edgeFilter": edge_filter,
            "edgeColorFilter": if color == "default" || is_hex_color(&color) { Value::String(color) } else { Value::Null },
            "focus": focus,
            "viewport": viewport,
        }));
        if out.len() >= MAX_SAVED_VIEWS {
            break;
        }
    }
    out
}

pub fn sanitize_metadata(input: Option<&Value>) -> Value {
    let mut clean = Map::new();
    if let Some(Value::Object(map)) = input {
        for (k, v) in map {
            let key = k.trim();
            if key.is_empty() {
                continue;
            }
            clean.insert(key.to_string(), Value::String(js_string(Some(v), "")));
        }
    }
    Value::Object(clean)
}

fn timestamp(raw: &Json, key: &str) -> Value {
    Value::String(js_string(raw.get(key), &now_iso()))
}

pub fn map_project(raw: &Json) -> Value {
    json!({
        "id": extract_id(raw.get("id")),
        "name": js_string(raw.get("name"), "Projet sans titre"),
        "description": js_string(raw.get("description"), ""),
        "linkTypes": normalize_link_types(raw.get("linkTypes")),
        "savedViews": normalize_saved_views(raw.get("savedViews")),
        "createdAt": timestamp(raw, "createdAt"),
        "updatedAt": timestamp(raw, "updatedAt"),
    })
}

pub fn map_category(raw: &Json) -> Value {
    let mut out = Map::new();
    out.insert("id".into(), Value::String(extract_id(raw.get("id"))));
    out.insert(
        "projectId".into(),
        Value::String(js_string(raw.get("projectId"), "")),
    );
    out.insert(
        "name".into(),
        Value::String(js_string(raw.get("name"), "Catégorie")),
    );
    out.insert(
        "color".into(),
        Value::String(
            normalize_color(raw.get("color")).unwrap_or_else(|| DEFAULT_CATEGORY_COLOR.into()),
        ),
    );
    out.insert(
        "icon".into(),
        Value::String(category_icon(raw.get("icon")).into()),
    );
    out.insert(
        "shape".into(),
        Value::String(category_shape(raw.get("shape")).into()),
    );
    out.extend(normalize_category_keys(
        raw.get("metadataKeys"),
        raw.get("cardKeys"),
    ));
    Value::Object(out)
}

/// Categories in the order chosen by the user (position), older records without one last by name
pub fn sort_category_records(mut raws: Vec<Json>) -> Vec<Json> {
    let pos = |r: &Json| {
        r.get("position")
            .and_then(Value::as_f64)
            .filter(|p| p.is_finite())
            .unwrap_or(f64::INFINITY)
    };
    let name = |r: &Json| fold_key(&js_string(r.get("name"), ""));
    raws.sort_by(|a, b| {
        pos(a)
            .partial_cmp(&pos(b))
            .unwrap_or(Ordering::Equal)
            .then_with(|| name(a).cmp(&name(b)))
    });
    raws
}

fn finite_or_zero(value: Option<&Value>) -> Value {
    let n = js_number(value);
    json_number(if n.is_finite() { n } else { 0.0 })
}

pub fn map_node(raw: &Json) -> Value {
    json!({
        "id": extract_id(raw.get("id")),
        "projectId": js_string(raw.get("projectId"), ""),
        "categoryId": if truthy(raw.get("categoryId")) { Value::String(extract_id(raw.get("categoryId"))) } else { Value::Null },
        "title": js_string(raw.get("title"), "Nouvel indice"),
        "content": js_string(raw.get("content"), ""),
        "positionX": finite_or_zero(raw.get("positionX")),
        "positionY": finite_or_zero(raw.get("positionY")),
        "metadata": sanitize_metadata(raw.get("metadata")),
        "reliability": normalize_reliability(raw.get("reliability")),
        "createdAt": timestamp(raw, "createdAt"),
        "updatedAt": timestamp(raw, "updatedAt"),
    })
}

pub fn map_edge(raw: &Json) -> Value {
    let end = |a: &str, b: &str| {
        let v = raw.get(a).filter(|v| !v.is_null()).or_else(|| raw.get(b));
        extract_id(v)
    };
    let handle = |k: &str| {
        if truthy(raw.get(k)) {
            Value::String(js_string(raw.get(k), ""))
        } else {
            Value::Null
        }
    };
    json!({
        "id": extract_id(raw.get("id")),
        "projectId": js_string(raw.get("projectId"), ""),
        "sourceNodeId": end("in", "sourceNodeId"),
        "targetNodeId": end("out", "targetNodeId"),
        "sourceHandle": handle("sourceHandle"),
        "targetHandle": handle("targetHandle"),
        "label": js_string(raw.get("label"), ""),
        "style": if raw.get("style").and_then(Value::as_str) == Some("dashed") { "dashed" } else { "solid" },
        "directed": raw.get("directed") != Some(&Value::Bool(false)),
        "color": normalize_color(raw.get("color")),
        "notes": if truthy(raw.get("notes")) { js_string(raw.get("notes"), "") } else { String::new() },
        "createdAt": timestamp(raw, "createdAt"),
        "updatedAt": timestamp(raw, "updatedAt"),
    })
}

/// Rows of a query result as objects (anything else is skipped)
pub fn rows(value: Value) -> Vec<Json> {
    match value {
        Value::Array(items) => items
            .into_iter()
            .filter_map(|v| match v {
                Value::Object(o) => Some(o),
                _ => None,
            })
            .collect(),
        Value::Object(o) => vec![o],
        _ => Vec::new(),
    }
}
