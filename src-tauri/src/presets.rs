//! Preset storage. A preset is one JSON file per dashboard in `<app data>/presets/<id>.json`.
//!
//! The frontend owns the preset schema (and its migrations); Rust treats presets as opaque
//! JSON except for the fields it needs to list them and the embedded network config, which
//! must deserialize so a preset can never smuggle in an unusable network setup.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;
use ts_rs::TS;

use crate::error::{AppError, AppResult};
use crate::net::NetworkConfig;

/// Refuse to read files larger than this; presets are small.
const MAX_PRESET_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PresetSummary {
    pub id: String,
    pub name: String,
    pub updated_at: Option<String>,
    pub file_name: String,
    /// Set when the file exists but could not be read; the preset is listed anyway so the
    /// user can see (and delete) it rather than having it silently vanish.
    pub error: Option<String>,
}

fn check_id(id: &str) -> AppResult<()> {
    let ok = !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if ok {
        Ok(())
    } else {
        Err(AppError::Preset(format!(
            "invalid preset id '{id}' (use 1-64 of A-Z a-z 0-9 - _)"
        )))
    }
}

fn path_for(dir: &Path, id: &str) -> AppResult<PathBuf> {
    check_id(id)?;
    Ok(dir.join(format!("{id}.json")))
}

fn read_json(path: &Path) -> AppResult<Value> {
    let len = fs::metadata(path)?.len();
    if len > MAX_PRESET_BYTES {
        return Err(AppError::Preset(format!(
            "{} is {len} bytes; presets are limited to {MAX_PRESET_BYTES}",
            path.display()
        )));
    }
    Ok(serde_json::from_str(&fs::read_to_string(path)?)?)
}

/// Checks the fields Rust relies on and returns (id, name).
fn check_preset(preset: &Value) -> AppResult<(String, String)> {
    let obj = preset
        .as_object()
        .ok_or_else(|| AppError::Preset("preset must be a JSON object".into()))?;
    let id = obj
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::Preset("preset has no string 'id'".into()))?;
    check_id(id)?;
    let name = obj
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::Preset("preset has no string 'name'".into()))?;
    if let Some(network) = obj.get("network") {
        serde_json::from_value::<NetworkConfig>(network.clone())
            .map_err(|e| AppError::Preset(format!("invalid network config: {e}")))?;
    }
    Ok((id.to_string(), name.to_string()))
}

fn summary(preset: &Value, file_name: String) -> AppResult<PresetSummary> {
    let (id, name) = check_preset(preset)?;
    Ok(PresetSummary {
        id,
        name,
        updated_at: preset
            .get("updatedAt")
            .and_then(Value::as_str)
            .map(str::to_string),
        file_name,
        error: None,
    })
}

pub fn list(dir: &Path) -> AppResult<Vec<PresetSummary>> {
    fs::create_dir_all(dir)?;
    let mut out = Vec::new();
    for entry in fs::read_dir(dir)? {
        let path = entry?.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let file_name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let stem = path
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        out.push(
            read_json(&path)
                .and_then(|v| summary(&v, file_name.clone()))
                .unwrap_or_else(|e| PresetSummary {
                    id: stem.clone(),
                    name: stem,
                    updated_at: None,
                    file_name,
                    error: Some(e.to_string()),
                }),
        );
    }
    out.sort_by_key(|p| p.name.to_lowercase());
    Ok(out)
}

pub fn load(dir: &Path, id: &str) -> AppResult<Value> {
    read_json(&path_for(dir, id)?)
}

/// Atomic save: write a temp file, then rename over the old one, so a crash mid-write can
/// never leave a truncated preset behind.
pub fn save(dir: &Path, preset: &Value) -> AppResult<PresetSummary> {
    let (id, _) = check_preset(preset)?;
    fs::create_dir_all(dir)?;
    let path = path_for(dir, &id)?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(preset)?)?;
    fs::rename(&tmp, &path)?;
    summary(preset, format!("{id}.json"))
}

pub fn delete(dir: &Path, id: &str) -> AppResult<()> {
    fs::remove_file(path_for(dir, id)?)?;
    Ok(())
}

/// Reads a preset from an arbitrary user-chosen file (import). Not saved until the frontend
/// has validated/migrated it and calls `save`.
pub fn read_external(path: &Path) -> AppResult<Value> {
    let value = read_json(path)?;
    if !value.is_object() {
        return Err(AppError::Preset(
            "file does not contain a JSON object".into(),
        ));
    }
    Ok(value)
}

pub fn export(dir: &Path, id: &str, dest: &Path) -> AppResult<()> {
    fs::copy(path_for(dir, id)?, dest)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("osc-octopus-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn save_list_load_delete() {
        let dir = temp_dir("crud");
        let preset = json!({ "id": "abc", "name": "Stage", "updatedAt": "2026-01-01T00:00:00Z", "network": { "outputs": [], "inputs": [] } });
        save(&dir, &preset).unwrap();
        fs::write(dir.join("broken.json"), "{ not json").unwrap();

        let listed = list(&dir).unwrap();
        assert_eq!(listed.len(), 2);
        assert!(listed.iter().any(|p| p.id == "broken" && p.error.is_some()));
        assert_eq!(load(&dir, "abc").unwrap(), preset);

        delete(&dir, "abc").unwrap();
        assert!(load(&dir, "abc").is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn rejects_path_traversal_and_bad_network() {
        let dir = temp_dir("reject");
        assert!(load(&dir, "../secrets").is_err());
        assert!(save(&dir, &json!({ "id": "..\\x", "name": "n" })).is_err());
        assert!(save(
            &dir,
            &json!({ "id": "ok", "name": "n", "network": { "outputs": [{ "port": "nope" }] } })
        )
        .is_err());
    }
}
