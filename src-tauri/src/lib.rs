pub mod commands;
pub mod debug;
pub mod error;
pub mod files;
pub mod net;
pub mod osc;
pub mod presets;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::ipc::Channel;
use tauri::{Emitter, Manager};

use debug::{DebugBatch, DebugHub};
use net::NetworkManager;

/// Debug events kept for late subscribers and export.
const DEBUG_HISTORY: usize = 5_000;
/// Events buffered between UI flushes before the oldest are dropped (and counted).
const DEBUG_PENDING: usize = 20_000;
/// ~30 Hz: fast enough to feel live, slow enough not to saturate IPC under a flood.
const DEBUG_FLUSH: Duration = Duration::from_millis(33);

/// Debug channels keyed by webview label.
pub type DebugSubscribers = Arc<Mutex<Vec<(String, Channel<DebugBatch>)>>>;

pub struct AppState {
    pub net: Arc<NetworkManager>,
    pub debug: Arc<DebugHub>,
    /// (webview label, channel) pairs.
    pub debug_subscribers: DebugSubscribers,
    pub presets_dir: PathBuf,
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
            let presets_dir = app.path().app_data_dir()?.join("presets");
            std::fs::create_dir_all(&presets_dir)?;

            let debug = Arc::new(DebugHub::new(DEBUG_HISTORY, DEBUG_PENDING));
            let status_handle = app.handle().clone();
            let net = Arc::new(NetworkManager::new(
                debug.clone(),
                Arc::new(move |status| {
                    let _ = status_handle.emit("net://status", status);
                }),
            ));

            let subscribers: DebugSubscribers = Arc::default();
            let (flush_debug, flush_subs) = (debug.clone(), subscribers.clone());
            tauri::async_runtime::spawn(async move {
                let mut tick = tokio::time::interval(DEBUG_FLUSH);
                tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                loop {
                    tick.tick().await;
                    if let Some(batch) = flush_debug.drain() {
                        // A failed send means the webview went away (reload); forget it.
                        flush_subs
                            .lock()
                            .unwrap()
                            .retain(|(_, ch)| ch.send(batch.clone()).is_ok());
                    }
                }
            });

            log::info!("presets directory: {}", presets_dir.display());
            app.manage(AppState {
                net,
                debug,
                debug_subscribers: subscribers,
                presets_dir,
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
