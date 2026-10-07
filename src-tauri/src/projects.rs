//! Project storage. A project is a snapshot of the whole setup, saved by hand: the open desks
//! (each a full preset, with its network), which one was shown, and the look with the custom
//! palettes and user skins it uses. One JSON file per project in `<app data>/projects/`, named
//! like presets: `<NAME>_<id>.json` (named.rs).
//!
//! The frontend owns the format (`lib/model/project.ts`) and restores it; Rust checks what it
//! relies on: an id and a name, and desks that are valid presets (their networks deserialize),
//! so a project can't carry a desk that `presets::save` would refuse.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use serde_json::Value;
use ts_rs::TS;

use crate::error::{AppError, AppResult};
use crate::files::{json_files, read_json, require_json};
use crate::named;
use crate::presets::{self, check_id};

/// A project holds every open desk and some skins; still small, but bigger than a preset.
const MAX_PROJECT_BYTES: u64 = 64 * 1024 * 1024;
/// The name part of a file whose project name has no letters or digits.
const UNNAMED: &str = "PROJECT";

/// Saves and deletes run one at a time (as presets).
static WRITE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub saved_at: Option<String>,
    /// How many desks it holds.
    pub desks: u32,
    pub file_name: String,
    /// Set when the file exists but could not be read (listed anyway, to delete it).
    pub error: Option<String>,
}

fn invalid(msg: impl Into<String>) -> AppError {
    AppError::Project(msg.into())
}

/// Checks what Rust relies on and summarises the project.
fn summary(project: &Value) -> AppResult<ProjectSummary> {
    let obj = project
        .as_object()
        .ok_or_else(|| invalid("a project must be a JSON object"))?;
    let id = obj
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("project has no string 'id'"))?;
    check_id(id).map_err(|_| invalid(format!("invalid project id '{id}'")))?;
    let name = obj
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("project has no string 'name'"))?;
    let desks = obj
        .get("desks")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("project has no 'desks' list"))?;
    if desks.is_empty() {
        return Err(invalid("a project holds at least one desk"));
    }
    for desk in desks {
        presets::summary(desk).map_err(|e| invalid(format!("a desk in it is not valid: {e}")))?;
    }
    Ok(ProjectSummary {
        id: id.to_string(),
        name: name.to_string(),
        saved_at: obj
            .get("savedAt")
            .and_then(Value::as_str)
            .map(str::to_string),
        desks: desks.len() as u32,
        file_name: named::file_name(name, id, UNNAMED),
        error: None,
    })
}

fn path_of(dir: &Path, id: &str) -> AppResult<PathBuf> {
    check_id(id).map_err(|_| invalid(format!("invalid project id '{id}'")))?;
    named::path_of(dir, id, MAX_PROJECT_BYTES)?
        .ok_or_else(|| invalid(format!("no saved project '{id}'")))
}

/// Every saved project, by name; a file that can't be read is listed with its error.
pub fn list(dir: &Path) -> AppResult<Vec<ProjectSummary>> {
    let mut out = Vec::new();
    for (stem, path) in json_files(dir)? {
        let file_name = format!("{stem}.json");
        out.push(
            read_json(&path, MAX_PROJECT_BYTES)
                .and_then(|v| summary(&v))
                .map(|s| ProjectSummary {
                    file_name: file_name.clone(),
                    ..s
                })
                .unwrap_or_else(|e| ProjectSummary {
                    id: stem.clone(),
                    name: stem,
                    saved_at: None,
                    desks: 0,
                    file_name,
                    error: Some(e.to_string()),
                }),
        );
    }
    out.sort_by_key(|p| p.name.to_lowercase());
    Ok(out)
}

pub fn load(dir: &Path, id: &str) -> AppResult<Value> {
    read_json(&path_of(dir, id)?, MAX_PROJECT_BYTES)
}

/// Validates, then writes atomically (replacing a project of the same id, under its new name).
pub fn save(dir: &Path, project: &Value) -> AppResult<ProjectSummary> {
    let summary = summary(project)?;
    let _serialised = WRITE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    named::write(
        dir,
        &summary.id,
        &summary.name,
        project,
        UNNAMED,
        MAX_PROJECT_BYTES,
    )?;
    Ok(summary)
}

pub fn delete(dir: &Path, id: &str) -> AppResult<()> {
    let _serialised = WRITE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    fs::remove_file(path_of(dir, id)?)?;
    Ok(())
}

/// Reads a project from a user-chosen `.json` file (import); checked like a saved one.
pub fn read_external(path: &Path) -> AppResult<Value> {
    require_json(path)?;
    let value = read_json(path, MAX_PROJECT_BYTES)?;
    summary(&value)?;
    Ok(value)
}

/// Copies a saved project to a user-chosen `.json` file.
pub fn export(dir: &Path, id: &str, dest: &Path) -> AppResult<()> {
    require_json(dest)?;
    fs::copy(path_of(dir, id)?, dest)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("osc-octopus-proj-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    fn desk(id: &str) -> Value {
        json!({ "id": id, "name": "Desk", "network": { "outputs": [], "inputs": [] } })
    }

    #[test]
    fn save_list_load_delete() {
        let dir = temp_dir("crud");
        let project = json!({ "id": "proj-1", "name": "Friday show", "savedAt": "2026-10-08T20:00:00Z", "desks": [desk("p-a"), desk("p-b")] });
        let saved = save(&dir, &project).unwrap();
        assert_eq!(
            (saved.file_name.as_str(), saved.desks),
            ("FRIDAY-SHOW_proj-1.json", 2)
        );
        fs::write(dir.join("broken.json"), "{ nope").unwrap();
        let listed = list(&dir).unwrap();
        assert_eq!(listed.len(), 2);
        assert!(listed.iter().any(|p| p.id == "broken" && p.error.is_some()));
        assert_eq!(load(&dir, "proj-1").unwrap(), project);

        export(&dir, "proj-1", &dir.join("out.json")).unwrap();
        assert_eq!(read_external(&dir.join("out.json")).unwrap(), project);
        assert!(export(&dir, "proj-1", &dir.join("out.txt")).is_err());

        delete(&dir, "proj-1").unwrap();
        assert!(load(&dir, "proj-1").is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn refuses_what_could_not_be_restored() {
        let dir = temp_dir("reject");
        assert!(save(&dir, &json!({ "id": "x", "name": "n", "desks": [] })).is_err());
        assert!(save(
            &dir,
            &json!({ "id": "../x", "name": "n", "desks": [desk("p")] })
        )
        .is_err());
        let bad_desk =
            json!({ "id": "p", "name": "d", "network": { "outputs": [{ "port": "no" }] } });
        assert!(save(
            &dir,
            &json!({ "id": "x", "name": "n", "desks": [bad_desk] })
        )
        .is_err());
        assert!(load(&dir, "../secrets").is_err());
    }
}
