//! Sync records of shared desks (the frontend's `DeskDoc`, src/lib/sync/deskdoc.ts): one JSON
//! file per desk in `<sync data>/docs/`, apart from the presets so they never show up in the
//! preset list. Rust stores them opaquely, like presets.
//!
//! A shared desk's record is written before its preset. After a crash between the two writes,
//! the record is the newer of the two, and the frontend lets it win on the next load.
//!
//! Other devices can change a shared desk, so its earlier versions are kept too: before a save,
//! the preset as it was is copied to `docs/backups/<desk>/` (at most every BACKUP_EVERY, the
//! last BACKUPS_KEPT), and can be restored as a copy.

use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;
use ts_rs::TS;

use crate::error::{AppError, AppResult};
use crate::files::{read_json, write_atomic};
use crate::presets::{self, check_id, PresetSummary};

/// Records hold every change ever made to a desk (deletions included), so they may grow past a
/// preset's size; still bounded.
const MAX_DOC_BYTES: u64 = 64 * 1024 * 1024;
const BACKUP_EVERY: Duration = Duration::from_secs(5 * 60);
const BACKUPS_KEPT: usize = 10;

/// An earlier version of a shared desk.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Backup {
    /// A `.json` preset file (import it to restore it as a copy).
    pub path: String,
    pub saved_at_ms: f64,
}

fn backups_dir(docs_dir: &Path, desk: &str) -> AppResult<PathBuf> {
    check_id(desk)?;
    Ok(docs_dir.join("backups").join(desk))
}

/// Earlier versions of a shared desk, newest first.
pub fn backups(docs_dir: &Path, desk: &str) -> AppResult<Vec<Backup>> {
    let dir = backups_dir(docs_dir, desk)?;
    let Ok(entries) = fs::read_dir(&dir) else {
        return Ok(Vec::new());
    };
    let mut out: Vec<Backup> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let path = e.path();
            let ms: u64 = path.file_stem()?.to_str()?.parse().ok()?;
            (path.extension()? == "json").then(|| Backup {
                path: path.display().to_string(),
                saved_at_ms: ms as f64,
            })
        })
        .collect();
    out.sort_by(|a, b| b.saved_at_ms.total_cmp(&a.saved_at_ms));
    Ok(out)
}

/// Keeps the preset as it is now, unless a backup was made less than BACKUP_EVERY ago.
fn back_up(docs_dir: &Path, presets_dir: &Path, desk: &str) -> AppResult<()> {
    let Some(current) = presets::path_of(presets_dir, desk)? else {
        return Ok(());
    };
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let existing = backups(docs_dir, desk)?;
    if existing
        .first()
        .is_some_and(|b| now.saturating_sub(b.saved_at_ms as u64) < BACKUP_EVERY.as_millis() as u64)
    {
        return Ok(());
    }
    let dir = backups_dir(docs_dir, desk)?;
    fs::create_dir_all(&dir)?;
    fs::copy(&current, dir.join(format!("{now}.json")))?;
    for old in existing.iter().skip(BACKUPS_KEPT - 1) {
        let _ = fs::remove_file(&old.path);
    }
    Ok(())
}

fn path_for(dir: &Path, desk: &str) -> AppResult<PathBuf> {
    check_id(desk)?;
    Ok(dir.join(format!("{desk}.json")))
}

pub fn load(dir: &Path, desk: &str) -> AppResult<Option<Value>> {
    let path = path_for(dir, desk)?;
    if !path.exists() {
        return Ok(None);
    }
    read_json(&path, MAX_DOC_BYTES).map(Some)
}

/// Writes a desk's record; it must name that desk (`deskId`), so records can't be crossed.
pub fn save(dir: &Path, desk: &str, record: &Value) -> AppResult<()> {
    if record.get("deskId").and_then(Value::as_str) != Some(desk) {
        return Err(AppError::Sync(format!(
            "the sync record does not belong to desk '{desk}'"
        )));
    }
    let bytes = serde_json::to_vec(record)?;
    if bytes.len() as u64 > MAX_DOC_BYTES {
        return Err(AppError::Sync(format!(
            "the sync record of '{desk}' is {} bytes; the limit is {MAX_DOC_BYTES}",
            bytes.len()
        )));
    }
    fs::create_dir_all(dir)?;
    write_atomic(&path_for(dir, desk)?, &bytes)
}

/// Writes a shared desk: its record first, then the preset.
pub fn save_with_preset(
    docs_dir: &Path,
    presets_dir: &Path,
    preset: &Value,
    record: &Value,
) -> AppResult<PresetSummary> {
    let desk = preset
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::Preset("preset has no string 'id'".into()))?;
    save(docs_dir, desk, record)?;
    // A failed backup must not stop the save itself.
    if let Err(e) = back_up(docs_dir, presets_dir, desk) {
        log::warn!("backup of shared desk {desk} failed: {e}");
    }
    presets::save(presets_dir, preset)
}

/// Forgets a desk's record and its backups (missing ones are fine).
pub fn delete(dir: &Path, desk: &str) -> AppResult<()> {
    let _ = fs::remove_dir_all(backups_dir(dir, desk)?);
    match fs::remove_file(path_for(dir, desk)?) {
        Err(e) if e.kind() != ErrorKind::NotFound => Err(e.into()),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn records_round_trip_and_belong_to_their_desk() {
        let root = std::env::temp_dir().join(format!("osc-octopus-docs-{}", std::process::id()));
        let (docs, presets_dir) = (root.join("docs"), root.join("presets"));
        let _ = fs::remove_dir_all(&root);

        assert!(load(&docs, "desk-1").unwrap().is_none());
        let record = json!({ "deskId": "desk-1", "doc": "abc", "entries": [] });
        let preset = json!({ "id": "desk-1", "name": "Desk" });
        save_with_preset(&docs, &presets_dir, &preset, &record).unwrap();
        assert_eq!(load(&docs, "desk-1").unwrap(), Some(record.clone()));
        assert!(presets::load(&presets_dir, "desk-1").is_ok());

        let other = json!({ "deskId": "desk-2" });
        assert!(save(&docs, "desk-1", &other).is_err(), "crossed record");
        assert!(load(&docs, "../escape").is_err());

        // The first save had no earlier preset; the second keeps the first as a backup, and a
        // third right after makes no new one.
        assert!(backups(&docs, "desk-1").unwrap().is_empty());
        save_with_preset(&docs, &presets_dir, &preset, &record).unwrap();
        save_with_preset(&docs, &presets_dir, &preset, &record).unwrap();
        let kept = backups(&docs, "desk-1").unwrap();
        assert_eq!(kept.len(), 1);
        assert!(crate::files::read_json(Path::new(&kept[0].path), 1 << 20).is_ok());

        delete(&docs, "desk-1").unwrap();
        delete(&docs, "desk-1").unwrap();
        assert!(load(&docs, "desk-1").unwrap().is_none());
        assert!(backups(&docs, "desk-1").unwrap().is_empty());
        fs::remove_dir_all(root).unwrap();
    }
}
