//! File helpers shared by preset and skin storage, imports and exports.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::Value;

use crate::error::{AppError, AppResult};

/// Import and export only ever touch `.json` files, so these commands can't be used to read or
/// overwrite anything else, whatever path the webview passes.
pub fn require_json(path: &Path) -> AppResult<()> {
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) if ext.eq_ignore_ascii_case("json") => Ok(()),
        _ => Err(AppError::InvalidPath(format!(
            "{} is not a .json file",
            path.display()
        ))),
    }
}

/// The `.json` files directly in `dir` (created first if missing), each with its file stem.
pub fn json_files(dir: &Path) -> AppResult<Vec<(String, PathBuf)>> {
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
        out.push((stem, path));
    }
    Ok(out)
}

/// Reads a JSON file, refusing files larger than `max_bytes`.
pub fn read_json(path: &Path, max_bytes: u64) -> AppResult<Value> {
    let len = fs::metadata(path)?.len();
    if len > max_bytes {
        return Err(AppError::InvalidPath(format!(
            "{} is {len} bytes; the limit is {max_bytes}",
            path.display()
        )));
    }
    Ok(serde_json::from_str(&fs::read_to_string(path)?)?)
}

static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Replaces `path` atomically and durably: the bytes go to a uniquely named temp file next to
/// it, which is flushed to disk and then renamed over the target. A crash can never leave a
/// truncated file, and two writers never share a temp file.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> AppResult<()> {
    let n = TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let tmp = path.with_extension(format!("{}-{n}.tmp", std::process::id()));
    let written = fs::File::create(&tmp)
        .and_then(|mut f| f.write_all(bytes).and_then(|()| f.sync_all()))
        .and_then(|()| fs::rename(&tmp, path));
    if written.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    Ok(written?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_only() {
        assert!(require_json(Path::new("a/b.json")).is_ok());
        assert!(require_json(Path::new("a/B.JSON")).is_ok());
        assert!(require_json(Path::new("a/.bashrc")).is_err());
        assert!(require_json(Path::new("a/preset.json.exe")).is_err());
    }

    #[test]
    fn atomic_write_replaces_and_leaves_no_temp_files() {
        let dir = std::env::temp_dir().join(format!("osc-octopus-files-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("x.json");
        write_atomic(&path, b"1").unwrap();
        write_atomic(&path, b"22").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"22");
        assert_eq!(
            fs::read_dir(&dir).unwrap().count(),
            1,
            "temp files left behind"
        );
        fs::remove_dir_all(dir).unwrap();
    }
}
