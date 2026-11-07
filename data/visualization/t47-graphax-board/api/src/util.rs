//! JavaScript-like conversions, so values read from the database or sent by the client
//! are handled exactly as the Node server does (`String(x)`, `Number(x)`, truthiness).

use serde_json::{Map, Value};
use surrealdb::types::{Object, RecordId, SurrealValue, Value as DbValue};

pub type Json = Map<String, Value>;

/// `new Date().toISOString()`
pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// 16 hex characters from 8 random bytes, as `generateId()` in server/db.ts
pub fn generate_id() -> String {
    let mut bytes = [0u8; 8];
    getrandom::fill(&mut bytes).expect("random source unavailable");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// `extractId()`: "table:key", "table:⟨key⟩" or a bare key gives the key
pub fn extract_id(value: Option<&Value>) -> String {
    match value {
        None | Some(Value::Null) => String::new(),
        Some(Value::Object(o)) if o.contains_key("id") => extract_id(o.get("id")),
        Some(v) => {
            let s = js_string(Some(v), "");
            let raw = match s.find(':') {
                Some(i) => &s[i + 1..],
                None => s.as_str(),
            };
            let raw = raw
                .strip_prefix('⟨')
                .or_else(|| raw.strip_prefix('`'))
                .unwrap_or(raw);
            let raw = raw
                .strip_suffix('⟩')
                .or_else(|| raw.strip_suffix('`'))
                .unwrap_or(raw);
            raw.to_string()
        }
    }
}

pub fn record_id(table: &str, id: &str) -> DbValue {
    let key = extract_id(Some(&Value::String(id.to_string())));
    DbValue::RecordId(RecordId::new(table, key))
}

/// Converts a JSON value for the database
pub fn to_db(value: Value) -> DbValue {
    value.into_value()
}

/// Converts a JSON object for the database, with some fields given as database values
pub fn to_db_object(json: Json, extra: Vec<(&str, DbValue)>) -> DbValue {
    let mut obj = Object::new();
    for (k, v) in json {
        obj.insert(k, to_db(v));
    }
    for (k, v) in extra {
        obj.insert(k, v);
    }
    DbValue::Object(obj)
}

/// Query parameters
pub fn params(entries: Vec<(&str, DbValue)>) -> DbValue {
    to_db_object(Json::new(), entries)
}

pub fn from_db(value: DbValue) -> Value {
    value.into_json_value()
}

/// `String(value ?? fallback)`
pub fn js_string(value: Option<&Value>, fallback: &str) -> String {
    match value {
        None | Some(Value::Null) => fallback.to_string(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Number(n)) => js_number_to_string(n.as_f64().unwrap_or(f64::NAN)),
        Some(Value::Array(items)) => items
            .iter()
            .map(|v| match v {
                Value::Null => String::new(),
                other => js_string(Some(other), ""),
            })
            .collect::<Vec<_>>()
            .join(","),
        Some(Value::Object(_)) => "[object Object]".to_string(),
    }
}

fn js_number_to_string(n: f64) -> String {
    if n.is_nan() {
        "NaN".into()
    } else if n.is_infinite() {
        if n > 0.0 { "Infinity" } else { "-Infinity" }.into()
    } else if n.fract() == 0.0 && n.abs() < 1e21 {
        format!("{}", n as i128)
    } else {
        format!("{n}")
    }
}

/// `Number(value)`; a missing value is NaN
pub fn js_number(value: Option<&Value>) -> f64 {
    match value {
        None => f64::NAN,
        Some(Value::Null) => 0.0,
        Some(Value::Bool(b)) => f64::from(u8::from(*b)),
        Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(s)) => {
            let t = s.trim();
            if t.is_empty() {
                0.0
            } else if t.chars().all(|c| c.is_ascii_digit() || "+-.eE".contains(c)) {
                t.parse().unwrap_or(f64::NAN)
            } else {
                match t {
                    "Infinity" | "+Infinity" => f64::INFINITY,
                    "-Infinity" => f64::NEG_INFINITY,
                    _ => f64::NAN,
                }
            }
        }
        Some(Value::Array(items)) => match items.as_slice() {
            [] => 0.0,
            [one] => js_number(Some(&Value::String(js_string(Some(one), "")))),
            _ => f64::NAN,
        },
        Some(Value::Object(_)) => f64::NAN,
    }
}

/// A finite number as JSON, written without a fraction when it has none
pub fn json_number(n: f64) -> Value {
    if n.fract() == 0.0 && n.abs() < 9.0e15 {
        Value::from(n as i64)
    } else {
        serde_json::Number::from_f64(n).map_or(Value::Null, Value::Number)
    }
}

pub fn truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

/// `optString()`: the value when it is a string
pub fn opt_string(value: Option<&Value>) -> Option<&str> {
    value.and_then(Value::as_str)
}

/// `String.prototype.trim` then `slice(0, max)` (counted in UTF-16 units, as JavaScript)
pub fn js_slice(s: &str, max: usize) -> String {
    let mut units = 0;
    let mut out = String::new();
    for ch in s.chars() {
        units += ch.len_utf16();
        if units > max {
            break;
        }
        out.push(ch);
    }
    out
}
