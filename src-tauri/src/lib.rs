pub mod commands;
pub mod debug;
pub mod error;
pub mod files;
pub mod input;
pub mod net;
pub mod osc;
pub mod presets;
pub mod sequencer;
pub mod skins;
pub mod sync;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::ipc::Channel;
use tauri::{Emitter, Manager};

use debug::{DebugBatch, DebugHub};
use input::InputBatch;
use net::NetworkManager;
use sequencer::{SeqBatch, Sequencer};
use sync::{SyncBatch, SyncManager, SyncOptions};

/// Debug events kept for late subscribers and export.
const DEBUG_HISTORY: usize = 5_000;
/// Events buffered between UI flushes before the oldest are dropped (and counted).
const DEBUG_PENDING: usize = 20_000;
/// ~30 Hz: fast enough to feel live, slow enough not to saturate IPC under a flood.
const DEBUG_FLUSH: Duration = Duration::from_millis(33);
/// ~60 Hz for input mapping: incoming control should move widgets as smoothly as a finger.
const INPUT_FLUSH: Duration = Duration::from_millis(16);
/// Sync events reach the UI as fast as input does: peers' gestures should look just as live.
const SYNC_FLUSH: Duration = Duration::from_millis(16);
/// A sequencer's current step only lights a mark: debug's pace is plenty.
const SEQ_FLUSH: Duration = Duration::from_millis(33);
/// Runs the app with its own data (presets, settings, sync identity) under
/// `profiles/<name>`, so two instances can run side by side on one machine for testing.
pub const PROFILE_ENV: &str = "OSCOCTOPUS_PROFILE";

/// Channels keyed by webview label (a reloaded page replaces its predecessor's channel).
pub type Subscribers<T> = Arc<Mutex<Vec<(String, Channel<T>)>>>;
pub type DebugSubscribers = Subscribers<DebugBatch>;

pub struct AppState {
    pub net: Arc<NetworkManager>,
    pub debug: Arc<DebugHub>,
    pub sync: Arc<SyncManager>,
    pub seq: Arc<Sequencer>,
    pub debug_subscribers: DebugSubscribers,
    pub input_subscribers: Subscribers<InputBatch>,
    pub sync_subscribers: Subscribers<SyncBatch>,
    pub seq_subscribers: Subscribers<SeqBatch>,
    pub presets_dir: PathBuf,
    /// User-made widget skins, one JSON file each (see [`skins`]).
    pub skins_dir: PathBuf,
    /// The profile this instance runs as (see [`PROFILE_ENV`]).
    pub profile: Option<String>,
}

/// The profile named by [`PROFILE_ENV`], if it is a valid id.
fn profile_from_env() -> Option<String> {
    let name = std::env::var(PROFILE_ENV).ok()?;
    let name = name.trim();
    if sync::wire::valid_id(name) {
        Some(name.to_string())
    } else {
        log::warn!("ignoring {PROFILE_ENV}='{name}': use 1-64 of A-Z a-z 0-9 - _");
        None
    }
}

/// Every `period`, sends what `drain` returns to every subscriber; a failed send means the
/// webview went away (reload), so that channel is forgotten.
fn spawn_flush<T: Clone + serde::Serialize + Send + 'static>(
    period: Duration,
    subscribers: Subscribers<T>,
    drain: impl Fn() -> Option<T> + Send + 'static,
) {
    tauri::async_runtime::spawn(async move {
        let mut tick = tokio::time::interval(period);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tick.tick().await;
            if let Some(batch) = drain() {
                subscribers
                    .lock()
                    .unwrap()
                    .retain(|(_, ch)| ch.send(batch.clone()).is_ok());
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(if cfg!(debug_assertions) {
                    log::LevelFilter::Debug
                } else {
                    log::LevelFilter::Info
                })
                .build(),
        )
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init());

    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_haptics::init());

    builder
        .setup(|app| {
            let profile = profile_from_env();
            let mut data_dir = app.path().app_data_dir()?;
            if let Some(name) = &profile {
                data_dir = data_dir.join("profiles").join(name);
            }
            let presets_dir = data_dir.join("presets");
            std::fs::create_dir_all(&presets_dir)?;
            let skins_dir = data_dir.join("skins");
            std::fs::create_dir_all(&skins_dir)?;

            let debug = Arc::new(DebugHub::new(DEBUG_HISTORY, DEBUG_PENDING));
            let status_handle = app.handle().clone();
            let net = Arc::new(NetworkManager::new(
                debug.clone(),
                Arc::new(move |status| {
                    let _ = status_handle.emit("net://status", status);
                }),
            ));

            let debug_subscribers: DebugSubscribers = Arc::default();
            let flush_debug = debug.clone();
            spawn_flush(DEBUG_FLUSH, debug_subscribers.clone(), move || {
                flush_debug.drain()
            });
            let input_subscribers: Subscribers<InputBatch> = Arc::default();
            let flush_input = net.input().clone();
            spawn_flush(INPUT_FLUSH, input_subscribers.clone(), move || {
                flush_input.drain()
            });

            let sync_status = app.handle().clone();
            let sync = Arc::new(SyncManager::new(
                SyncOptions::new(data_dir.join("sync")),
                debug.clone(),
                net.input().clone(),
                Arc::new(move |status| {
                    let _ = sync_status.emit("sync://status", status);
                }),
            ));
            let sync_subscribers: Subscribers<SyncBatch> = Arc::default();
            let flush_sync = sync.clone();
            spawn_flush(SYNC_FLUSH, sync_subscribers.clone(), move || {
                flush_sync.drain()
            });

            let seq = Arc::new(Sequencer::new(net.clone(), debug.clone()));
            let seq_subscribers: Subscribers<SeqBatch> = Arc::default();
            let flush_seq = seq.clone();
            spawn_flush(SEQ_FLUSH, seq_subscribers.clone(), move || {
                flush_seq.drain()
            });

            log::info!("presets directory: {}", presets_dir.display());
            app.manage(AppState {
                net,
                debug,
                sync,
                seq,
                debug_subscribers,
                input_subscribers,
                sync_subscribers,
                seq_subscribers,
                presets_dir,
                skins_dir,
                profile,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::net_apply_config,
            commands::net_close_desk,
            commands::net_set_paused,
            commands::net_paused,
            commands::net_status,
            commands::net_list_interfaces,
            commands::osc_send,
            commands::input_subscribe,
            commands::input_set_enabled,
            commands::input_enabled,
            commands::input_set_listen,
            commands::seq_subscribe,
            commands::seq_start,
            commands::seq_update,
            commands::seq_pause,
            commands::seq_resume,
            commands::seq_stop,
            commands::sync_status,
            commands::sync_subscribe,
            commands::sync_join,
            commands::sync_leave,
            commands::sync_new_key,
            commands::sync_remembered,
            commands::sync_forget,
            commands::sync_set_profile,
            commands::sync_set_config,
            commands::sync_set_desks,
            commands::sync_set_blocked,
            commands::sync_send,
            commands::sync_doc_load,
            commands::sync_desk_save,
            commands::sync_doc_delete,
            commands::sync_backups,
            commands::app_profile,
            commands::debug_subscribe,
            commands::debug_clear,
            commands::debug_export,
            commands::preset_list,
            commands::preset_load,
            commands::preset_save,
            commands::preset_delete,
            commands::preset_read_file,
            commands::preset_export,
            commands::preset_dir,
            commands::skin_list,
            commands::skin_save,
            commands::skin_delete,
            commands::skin_export,
        ])
        .run(tauri::generate_context!())
        .expect("error while running OscOctopus");
}

#[cfg(test)]
mod tests {
    /// package.json is the version source (tauri.conf.json points at it); Cargo.toml must match.
    #[test]
    fn version_matches_package_json() {
        let pkg: serde_json::Value =
            serde_json::from_str(include_str!("../../package.json")).unwrap();
        assert_eq!(
            pkg["version"],
            env!("CARGO_PKG_VERSION"),
            "bump the version in package.json and src-tauri/Cargo.toml together"
        );
    }
}
