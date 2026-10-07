//! Files named for people: `<NAME>_<id>.json`, so a folder of saved desks or projects reads
//! like the app does (`STAGE-LEFT_p-k2j4h5g6f7.json`). The id is the truth: a file is found by
//! its id, whatever its name says, and saving under a new name replaces the old file. Files from
//! before (`<id>.json`) are still found, and renamed (`normalize`) at startup.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::error::AppResult;
use crate::files::{json_files, read_json, write_atomic};

/// The longest name part of a file name; the id follows it.
const MAX_SLUG: usize = 40;

/// A name as it is shown (in capitals), made safe for every file system: letters and digits,
/// everything else a single `-`. Empty (a name of only symbols) becomes `fallback`.
pub fn slug(name: &str, fallback: &str) -> String {
    let mut out = String::new();
    for c in name.chars().flat_map(char::to_uppercase) {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
        if out.len() >= MAX_SLUG {
            break;
        }
    }
    let out = out.trim_end_matches('-');
    if out.is_empty() {
        fallback.to_string()
    } else {
        out.to_string()
    }
}

/// The file name for `name` and `id`.
pub fn file_name(name: &str, id: &str, fallback: &str) -> String {
    format!("{}_{id}.json", slug(name, fallback))
}

/// The `id` a file holds, if it can be read.
fn id_in(path: &Path, max_bytes: u64) -> Option<String> {
    read_json(path, max_bytes)
        .ok()?
        .get("id")?
        .as_str()
        .map(str::to_string)
}

/// Every file in `dir` that holds `id`: named `<id>.json` or `…_<id>.json`, and saying so
/// inside (another id can end the same way: `a_b` and `b`).
pub fn paths_of(dir: &Path, id: &str, max_bytes: u64) -> AppResult<Vec<PathBuf>> {
    let suffix = format!("_{id}");
    Ok(json_files(dir)?
        .into_iter()
        .filter(|(stem, _)| stem == id || stem.ends_with(&suffix))
        .map(|(_, path)| path)
        .filter(|path| id_in(path, max_bytes).as_deref() == Some(id))
        .collect())
}

/// The file that holds `id`, if any.
pub fn path_of(dir: &Path, id: &str, max_bytes: u64) -> AppResult<Option<PathBuf>> {
    Ok(paths_of(dir, id, max_bytes)?.into_iter().next())
}

/// Writes `value` as `<NAME>_<id>.json`, then removes any other file of the same id (the name
/// changed, or a file from before), so there is always exactly one. Returns its file name.
pub fn write(
    dir: &Path,
    id: &str,
    name: &str,
    value: &Value,
    fallback: &str,
    max_bytes: u64,
) -> AppResult<String> {
    let bytes = serde_json::to_vec_pretty(value)?;
    fs::create_dir_all(dir)?;
    let file = file_name(name, id, fallback);
    let target = dir.join(&file);
    write_atomic(&target, &bytes)?;
    for old in paths_of(dir, id, max_bytes)? {
        if old != target {
            let _ = fs::remove_file(old);
        }
    }
    Ok(file)
}

/// Renames every readable file to `<NAME>_<id>.json` (files from before, or edited by hand);
/// `name_of` reads a file's name and id. A name already taken is left alone.
pub fn normalize(
    dir: &Path,
    fallback: &str,
    max_bytes: u64,
    name_of: impl Fn(&Value) -> Option<(String, String)>,
) -> AppResult<usize> {
    let mut renamed = 0;
    for (stem, path) in json_files(dir)? {
        let Some((id, name)) = read_json(&path, max_bytes).ok().as_ref().and_then(&name_of) else {
            continue;
        };
        let file = file_name(&name, &id, fallback);
        let target = dir.join(&file);
        if format!("{stem}.json") != file && !target.exists() && fs::rename(&path, &target).is_ok()
        {
            renamed += 1;
        }
    }
    Ok(renamed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("osc-octopus-named-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn slugs_read_like_the_name() {
        assert_eq!(slug("My desk", "DESK"), "MY-DESK");
        assert_eq!(slug("  Stage / Left!! ", "DESK"), "STAGE-LEFT");
        assert_eq!(slug("ÄÖ", "DESK"), "DESK");
        assert_eq!(slug("mixer.local:9000", "DESK"), "MIXER-LOCAL-9000");
        assert!(slug(&"x".repeat(100), "DESK").len() <= MAX_SLUG);
        assert_eq!(file_name("My desk", "p-abc", "DESK"), "MY-DESK_p-abc.json");
    }

    #[test]
    fn one_file_per_id_whatever_its_name() {
        let dir = temp_dir("write");
        let v = |name: &str| json!({ "id": "p-1", "name": name });
        // A file from before, named by id only.
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("p-1.json"), serde_json::to_vec(&v("Old")).unwrap()).unwrap();
        // Another id that ends the same way is not this one.
        fs::write(
            dir.join("X_a_p-1.json"),
            serde_json::to_vec(&json!({ "id": "a_p-1" })).unwrap(),
        )
        .unwrap();

        assert_eq!(
            path_of(&dir, "p-1", 1 << 20).unwrap(),
            Some(dir.join("p-1.json"))
        );
        assert_eq!(
            write(&dir, "p-1", "Stage", &v("Stage"), "DESK", 1 << 20).unwrap(),
            "STAGE_p-1.json"
        );
        assert_eq!(
            write(&dir, "p-1", "Front", &v("Front"), "DESK", 1 << 20).unwrap(),
            "FRONT_p-1.json"
        );
        assert_eq!(
            paths_of(&dir, "p-1", 1 << 20).unwrap(),
            vec![dir.join("FRONT_p-1.json")]
        );
        assert!(dir.join("X_a_p-1.json").exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn normalize_renames_files_from_before() {
        let dir = temp_dir("normalize");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("p-2.json"),
            r#"{ "id": "p-2", "name": "Main desk" }"#,
        )
        .unwrap();
        fs::write(dir.join("broken.json"), "{ nope").unwrap();
        let names = |v: &Value| {
            Some((
                v.get("id")?.as_str()?.to_string(),
                v.get("name")?.as_str()?.to_string(),
            ))
        };
        assert_eq!(normalize(&dir, "DESK", 1 << 20, names).unwrap(), 1);
        assert!(dir.join("MAIN-DESK_p-2.json").exists());
        assert!(dir.join("broken.json").exists());
        assert_eq!(normalize(&dir, "DESK", 1 << 20, names).unwrap(), 0);
        fs::remove_dir_all(dir).unwrap();
    }
}
