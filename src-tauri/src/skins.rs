//! Skin storage: one JSON file per user-made widget skin in `<app data>/skins/<id>.json`.
//!
//! The frontend owns the skin format (`lib/skins/schema.ts`) and validates every skin it
//! reads; Rust checks only what it needs to file one safely: an object with the skin format
//! marker, a `skin-…` id that can't escape the directory, and a size cap (skins embed their
//! images). Skins are imported by the frontend (a file input works on every platform); Rust
//! only saves them and copies one out for export.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use serde_json::Value;
use ts_rs::TS;

use crate::error::{AppError, AppResult};
use crate::files::{read_json, require_json, write_atomic};
use crate::presets::check_id;

/// A skin with its images must stay under this (the frontend caps images well below it).
pub const MAX_SKIN_BYTES: u64 = 8 * 1024 * 1024;

/// The `format` every skin file carries.
const FORMAT: &str = "oscoctopus-skin";

/// Saves and deletes run one at a time, so the rename of one save can never race another.
static WRITE_LOCK: Mutex<()> = Mutex::new(());

/// One file of the skins directory: the skin, or why it couldn't be read (listed anyway, so
/// it can be seen and deleted rather than silently vanishing).
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SkinFile {
    pub id: String,
    #[ts(type = "unknown")]
    pub skin: Option<Value>,
    pub error: Option<String>,
}

fn skin_error(msg: impl Into<String>) -> AppError {
    AppError::Preset(msg.into())
}

/// A skin id: `skin-` and then what a preset id may be (so no path can be smuggled in).
fn check_skin_id(id: &str) -> AppResult<()> {
    check_id(id).map_err(|_| skin_error(format!("invalid skin id '{id}'")))?;
    if id.starts_with("skin-") {
        Ok(())
    } else {
        Err(skin_error(format!(
            "invalid skin id '{id}' (must start with skin-)"
        )))
    }
}

fn path_for(dir: &Path, id: &str) -> AppResult<PathBuf> {
    check_skin_id(id)?;
    Ok(dir.join(format!("{id}.json")))
}

/// The skin's id, if it is a skin file at all.
fn id_of(skin: &Value) -> AppResult<&str> {
    let obj = skin
        .as_object()
        .ok_or_else(|| skin_error("skin must be a JSON object"))?;
    if obj.get("format").and_then(Value::as_str) != Some(FORMAT) {
        return Err(skin_error("not an OscOctopus skin (format)"));
    }
    let id = obj
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| skin_error("skin has no string 'id'"))?;
    check_skin_id(id)?;
    Ok(id)
}

pub fn list(dir: &Path) -> AppResult<Vec<SkinFile>> {
    fs::create_dir_all(dir)?;
    let mut out = Vec::new();
    for entry in fs::read_dir(dir)? {
        let path = entry?.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let stem = path
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        let read = read_json(&path, MAX_SKIN_BYTES).and_then(|v| {
            let id = id_of(&v)?.to_string();
            if id != stem {
                return Err(skin_error(format!("file {stem}.json holds skin '{id}'")));
            }
            Ok(v)
        });
        out.push(match read {
            Ok(skin) => SkinFile {
                id: stem,
                skin: Some(skin),
                error: None,
            },
            Err(e) => SkinFile {
                id: stem,
                skin: None,
                error: Some(e.to_string()),
            },
        });
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

/// Checks the skin can be filed, then writes it atomically and durably (see [`write_atomic`]).
pub fn save(dir: &Path, skin: &Value) -> AppResult<()> {
    let id = id_of(skin)?;
    let bytes = serde_json::to_vec(skin)?;
    if bytes.len() as u64 > MAX_SKIN_BYTES {
        return Err(skin_error(format!(
            "skin is {} MiB, over the {} MiB limit",
            bytes.len() / (1024 * 1024),
            MAX_SKIN_BYTES / (1024 * 1024)
        )));
    }
    let _serialised = WRITE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    fs::create_dir_all(dir)?;
    write_atomic(&path_for(dir, id)?, &bytes)?;
    Ok(())
}

pub fn delete(dir: &Path, id: &str) -> AppResult<()> {
    let _serialised = WRITE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    fs::remove_file(path_for(dir, id)?)?;
    Ok(())
}

/// Copies a saved skin to a user-chosen `.json` file.
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
            std::env::temp_dir().join(format!("osc-octopus-skins-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    fn skin(id: &str) -> Value {
        json!({ "format": FORMAT, "version": 1, "id": id, "name": "Mine", "base": "glass" })
    }

    #[test]
    fn save_list_delete() {
        let dir = temp_dir("crud");
        save(&dir, &skin("skin-abc")).unwrap();
        save(&dir, &skin("skin-abc")).unwrap(); // replacing is fine
        fs::write(dir.join("skin-broken.json"), "{ not json").unwrap();
        fs::write(dir.join("notes.txt"), "ignored").unwrap();

        let listed = list(&dir).unwrap();
        assert_eq!(listed.len(), 2);
        let ok = listed.iter().find(|f| f.id == "skin-abc").unwrap();
        assert_eq!(ok.skin.as_ref().unwrap()["name"], "Mine");
        let broken = listed.iter().find(|f| f.id == "skin-broken").unwrap();
        assert!(broken.skin.is_none() && broken.error.is_some());

        delete(&dir, "skin-abc").unwrap();
        assert_eq!(list(&dir).unwrap().len(), 1);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn refuses_what_is_not_a_skin_or_would_escape_the_directory() {
        let dir = temp_dir("reject");
        assert!(save(&dir, &json!({ "id": "skin-x" })).is_err(), "no format");
        assert!(save(&dir, &skin("../evil")).is_err());
        assert!(save(&dir, &skin("preset-id")).is_err(), "not a skin- id");
        assert!(delete(&dir, "../evil").is_err());
        assert!(
            export(&dir, "skin-x", Path::new("out.png")).is_err(),
            "export is .json only"
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn refuses_a_skin_over_the_size_cap() {
        let dir = temp_dir("size");
        let mut big = skin("skin-big");
        big["images"] = json!({ "img-a": "A".repeat(MAX_SKIN_BYTES as usize) });
        assert!(save(&dir, &big).unwrap_err().to_string().contains("limit"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn lists_a_file_whose_name_and_id_disagree_as_unreadable() {
        let dir = temp_dir("mismatch");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("skin-a.json"),
            serde_json::to_vec(&skin("skin-b")).unwrap(),
        )
        .unwrap();
        let listed = list(&dir).unwrap();
        assert!(listed[0].error.as_ref().unwrap().contains("skin-b"));
        fs::remove_dir_all(dir).unwrap();
    }
}
