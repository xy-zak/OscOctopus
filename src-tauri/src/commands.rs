//! IPC surface. Thin wrappers only: all logic lives in `net`, `debug` and `presets`.

use std::path::PathBuf;

use serde_json::Value;
use tauri::ipc::Channel;
use tauri::{State, Webview};

use crate::debug::{DebugBatch, DebugEvent};
use crate::error::AppResult;
use crate::net::interfaces::{self, NetInterface};
use crate::net::{EndpointStatus, NetworkConfig};
use crate::osc::OscMessage;
use crate::presets::{self, PresetSummary};
use crate::AppState;

/// Applies one desk's network config. Other desks keep running untouched.
#[tauri::command]
pub async fn net_apply_config(
    state: State<'_, AppState>,
    desk: String,
    config: NetworkConfig,
) -> AppResult<Vec<EndpointStatus>> {
    state.net.apply(&desk, config).await
}

/// Stops every endpoint of a desk that was closed.
#[tauri::command]
pub async fn net_close_desk(
    state: State<'_, AppState>,
    desk: String,
) -> AppResult<Vec<EndpointStatus>> {
    state.net.close_desk(&desk).await
}

/// Global output gate. While paused, nothing is written to any output socket.
#[tauri::command]
pub fn net_set_paused(state: State<'_, AppState>, paused: bool) -> bool {
    state.net.set_paused(paused)
}

#[tauri::command]
pub fn net_paused(state: State<'_, AppState>) -> bool {
    state.net.is_paused()
}

#[tauri::command]
pub fn net_status(state: State<'_, AppState>) -> Vec<EndpointStatus> {
    state.net.status()
}

#[tauri::command]
pub async fn net_list_interfaces() -> AppResult<Vec<NetInterface>> {
    Ok(interfaces::list()?)
}

#[tauri::command]
pub async fn osc_send(
    state: State<'_, AppState>,
    desk: String,
    output_ids: Vec<String>,
    message: OscMessage,
    source: Option<String>,
) -> AppResult<()> {
    state
        .net
        .send(&desk, &output_ids, &message, source.as_deref())
        .await
}

/// Registers a channel that receives batched debug events (~30 Hz) and returns the
/// history recorded so far, so a reloaded UI starts with context. One channel per webview:
/// a reloaded page replaces its predecessor's channel instead of leaving a dead one behind.
#[tauri::command]
pub fn debug_subscribe(
    state: State<'_, AppState>,
    webview: Webview,
    channel: Channel<DebugBatch>,
) -> Vec<DebugEvent> {
    let label = webview.label().to_string();
    let mut subs = state.debug_subscribers.lock().unwrap();
    subs.retain(|(l, _)| *l != label);
    subs.push((label, channel));
    state.debug.history()
}

/// Writes the debug history Rust holds (not the UI's filtered view) to a JSON file.
#[tauri::command]
pub async fn debug_export(state: State<'_, AppState>, path: PathBuf) -> AppResult<usize> {
    let events = state.debug.history();
    let doc = serde_json::json!({
        "exportedAt": crate::debug::now_micros(),
        "totalDropped": state.debug.total_dropped(),
        "events": events,
    });
    std::fs::write(&path, serde_json::to_vec_pretty(&doc)?)?;
    Ok(events.len())
}

#[tauri::command]
pub fn debug_clear(state: State<'_, AppState>) {
    state.debug.clear();
}

#[tauri::command]
pub async fn preset_list(state: State<'_, AppState>) -> AppResult<Vec<PresetSummary>> {
    presets::list(&state.presets_dir)
}

#[tauri::command]
pub async fn preset_load(state: State<'_, AppState>, id: String) -> AppResult<Value> {
    presets::load(&state.presets_dir, &id)
}

#[tauri::command]
pub async fn preset_save(state: State<'_, AppState>, preset: Value) -> AppResult<PresetSummary> {
    presets::save(&state.presets_dir, &preset)
}

#[tauri::command]
pub async fn preset_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    presets::delete(&state.presets_dir, &id)
}

#[tauri::command]
pub async fn preset_read_file(path: PathBuf) -> AppResult<Value> {
    presets::read_external(&path)
}

#[tauri::command]
pub async fn preset_export(state: State<'_, AppState>, id: String, path: PathBuf) -> AppResult<()> {
    presets::export(&state.presets_dir, &id, &path)
}

#[tauri::command]
pub fn presets_dir(state: State<'_, AppState>) -> String {
    state.presets_dir.display().to_string()
}
