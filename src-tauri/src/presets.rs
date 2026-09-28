//! Preset storage. A preset is one JSON file per dashboard in `<app data>/presets/<id>.json`.
//!
//! The frontend owns the preset schema (and its migrations); Rust treats presets as opaque
//! JSON except for the fields it needs to list them and the embedded network config, which
//! must deserialize so a preset can never smuggle in an unusable network setup.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use serde_json::Value;
use ts_rs::TS;

use crate::error::{AppError, AppResult};
use crate::files::{json_files, read_json, require_json, write_atomic};
use crate::net::NetworkConfig;

/// Refuse to read files larger than this; presets are small.
const MAX_PRESET_BYTES: u64 = 16 * 1024 * 1024;

/// Saves and deletes run one at a time, so the rename of one save can never race another.
static WRITE_LOCK: Mutex<()> = Mutex::new(());

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

pub(crate) fn check_id(id: &str) -> AppResult<()> {
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

pub(crate) fn path_for(dir: &Path, id: &str) -> AppResult<PathBuf> {
    check_id(id)?;
    Ok(dir.join(format!("{id}.json")))
}

/// Checks the fields Rust relies on and summarises the preset.
fn summary(preset: &Value) -> AppResult<PresetSummary> {
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
    Ok(PresetSummary {
        id: id.to_string(),
        name: name.to_string(),
        updated_at: obj
            .get("updatedAt")
            .and_then(Value::as_str)
            .map(str::to_string),
        file_name: format!("{id}.json"),
        error: None,
    })
}

pub fn list(dir: &Path) -> AppResult<Vec<PresetSummary>> {
    let mut out = Vec::new();
    for (stem, path) in json_files(dir)? {
        let file_name = format!("{stem}.json");
        out.push(
            read_json(&path, MAX_PRESET_BYTES)
                .and_then(|v| summary(&v))
                .map(|s| PresetSummary {
                    file_name: file_name.clone(),
                    ..s
                })
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
    read_json(&path_for(dir, id)?, MAX_PRESET_BYTES)
}

/// Validates, then writes atomically and durably (see [`write_atomic`]), so a crash mid-write
/// can never leave a truncated preset behind.
pub fn save(dir: &Path, preset: &Value) -> AppResult<PresetSummary> {
    let summary = summary(preset)?;
    let bytes = serde_json::to_vec_pretty(preset)?;
    let _serialised = WRITE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    fs::create_dir_all(dir)?;
    write_atomic(&path_for(dir, &summary.id)?, &bytes)?;
    Ok(summary)
}

pub fn delete(dir: &Path, id: &str) -> AppResult<()> {
    let _serialised = WRITE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    fs::remove_file(path_for(dir, id)?)?;
    Ok(())
}

/// Reads a preset from a user-chosen `.json` file (import). Not saved until the frontend has
/// validated/migrated it and calls `save`.
pub fn read_external(path: &Path) -> AppResult<Value> {
    require_json(path)?;
    let value = read_json(path, MAX_PRESET_BYTES)?;
    if !value.is_object() {
        return Err(AppError::Preset(
            "file does not contain a JSON object".into(),
        ));
    }
    Ok(value)
}

/// Copies a saved preset to a user-chosen `.json` file.
pub fn export(dir: &Path, id: &str, dest: &Path) -> AppResult<()> {
    require_json(dest)?;
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
        let saved = save(&dir, &preset).unwrap();
        assert_eq!(
            (saved.id.as_str(), saved.file_name.as_str()),
            ("abc", "abc.json")
        );
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

    #[test]
    fn import_and_export_only_touch_json_files() {
        let dir = temp_dir("json-only");
        save(&dir, &json!({ "id": "p", "name": "n" })).unwrap();
        assert!(export(&dir, "p", &dir.join("out.txt")).is_err());
        assert!(read_external(&dir.join("p.txt")).is_err());
        export(&dir, "p", &dir.join("out.json")).unwrap();
        assert_eq!(read_external(&dir.join("out.json")).unwrap()["id"], "p");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn concurrent_saves_of_one_preset_always_leave_valid_json() {
        let dir = temp_dir("concurrent");
        let writers: Vec<_> = (0..8)
            .map(|t| {
                let dir = dir.clone();
                std::thread::spawn(move || {
                    for i in 0..25 {
                        let name = format!("writer {t} save {i} {}", "x".repeat(2000));
                        save(&dir, &json!({ "id": "same", "name": name })).unwrap();
                    }
                })
            })
            .collect();
        for w in writers {
            w.join().unwrap();
        }
        let saved = load(&dir, "same").unwrap();
        assert!(saved["name"].as_str().unwrap().starts_with("writer "));
        assert_eq!(
            fs::read_dir(&dir).unwrap().count(),
            1,
            "temp files left behind"
        );
        fs::remove_dir_all(dir).unwrap();
    }
}
