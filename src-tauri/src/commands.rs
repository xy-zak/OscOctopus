//! IPC surface. Thin wrappers only: all logic lives in `net`, `debug`, `presets` and `sync`.
//! Commands are named `<area>_<verb>`.

use std::path::PathBuf;

use serde_json::Value;
use tauri::ipc::Channel;
use tauri::{State, Webview};

use crate::debug::{DebugBatch, DebugEvent};
use crate::error::{AppError, AppResult};
use crate::files::{require_json, write_atomic};
use crate::input::{Avoid, InputBatch};
use crate::net::interfaces::{self, NetInterface};
use crate::net::{EndpointStatus, NetworkConfig};
use crate::osc::OscMessage;
use crate::presets::{self, PresetSummary};
use crate::sync::docs;
use crate::sync::identity::{derive_psk, new_session_key, normalize_session, RememberedSession};
use crate::sync::wire::AppKind;
use crate::sync::{SyncBatch, SyncConfig, SyncStatus};
use crate::{AppState, Subscribers};

/// Longest session name.
const MAX_SESSION_CHARS: usize = 64;

/// Runs blocking file I/O on the blocking pool instead of an async worker thread.
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(f).await?
}

/// One channel per webview: a reloaded page replaces its predecessor's channel instead of
/// leaving a dead one behind.
fn subscribe<T>(subscribers: &Subscribers<T>, webview: &Webview, channel: Channel<T>) {
    let label = webview.label().to_string();
    let mut subs = subscribers.lock().unwrap();
    subs.retain(|(l, _)| *l != label);
    subs.push((label, channel));
}

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

/// Sends one message to outputs of a desk. `avoid` is set for forwarded input: outputs that
/// would carry it back to its sender are skipped.
#[tauri::command]
pub async fn osc_send(
    state: State<'_, AppState>,
    desk: String,
    output_ids: Vec<String>,
    message: OscMessage,
    source: Option<String>,
    avoid: Option<Avoid>,
) -> AppResult<()> {
    state
        .net
        .send(
            &desk,
            &output_ids,
            &message,
            source.as_deref(),
            avoid.as_ref(),
        )
        .await
}

/// Registers the channel that receives inbound messages for input mapping (~60 Hz batches).
#[tauri::command]
pub fn input_subscribe(state: State<'_, AppState>, webview: Webview, channel: Channel<InputBatch>) {
    subscribe(&state.input_subscribers, &webview, channel);
}

/// The input-mapping master gate. Returns the new state.
#[tauri::command]
pub fn input_set_enabled(state: State<'_, AppState>, enabled: bool) -> bool {
    state.net.input().set_enabled(enabled)
}

#[tauri::command]
pub fn input_enabled(state: State<'_, AppState>) -> bool {
    state.net.input().is_enabled()
}

/// The endpoints of a desk that a widget listens on; only those reach input mapping.
#[tauri::command]
pub fn input_set_listen(state: State<'_, AppState>, desk: String, endpoint_ids: Vec<String>) {
    state.net.input().set_listen(&desk, endpoint_ids);
}

/// Registers a channel that receives batched debug events (~30 Hz) and returns the
/// history recorded so far, so a reloaded UI starts with context.
#[tauri::command]
pub fn debug_subscribe(
    state: State<'_, AppState>,
    webview: Webview,
    channel: Channel<DebugBatch>,
) -> Vec<DebugEvent> {
    subscribe(&state.debug_subscribers, &webview, channel);
    state.debug.history()
}

/// Writes the debug history Rust holds (not the UI's filtered view) to a `.json` file.
#[tauri::command]
pub async fn debug_export(state: State<'_, AppState>, path: PathBuf) -> AppResult<usize> {
    require_json(&path)?;
    let events = state.debug.history();
    let count = events.len();
    let doc = serde_json::json!({
        "exportedAt": crate::debug::now_micros(),
        "totalDropped": state.debug.total_dropped(),
        "events": events,
    });
    blocking(move || write_atomic(&path, &serde_json::to_vec_pretty(&doc)?)).await?;
    Ok(count)
}

#[tauri::command]
pub fn debug_clear(state: State<'_, AppState>) {
    state.debug.clear();
}

#[tauri::command]
pub async fn preset_list(state: State<'_, AppState>) -> AppResult<Vec<PresetSummary>> {
    let dir = state.presets_dir.clone();
    blocking(move || presets::list(&dir)).await
}

#[tauri::command]
pub async fn preset_load(state: State<'_, AppState>, id: String) -> AppResult<Value> {
    let dir = state.presets_dir.clone();
    blocking(move || presets::load(&dir, &id)).await
}

#[tauri::command]
pub async fn preset_save(state: State<'_, AppState>, preset: Value) -> AppResult<PresetSummary> {
    let dir = state.presets_dir.clone();
    blocking(move || presets::save(&dir, &preset)).await
}

/// Deletes a preset, and its sync record if it was shared.
#[tauri::command]
pub async fn preset_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let dir = state.presets_dir.clone();
    let docs_dir = state.sync.docs_dir();
    blocking(move || {
        presets::delete(&dir, &id)?;
        docs::delete(&docs_dir, &id)
    })
    .await
}

#[tauri::command]
pub async fn preset_read_file(path: PathBuf) -> AppResult<Value> {
    blocking(move || presets::read_external(&path)).await
}

#[tauri::command]
pub async fn preset_export(state: State<'_, AppState>, id: String, path: PathBuf) -> AppResult<()> {
    let dir = state.presets_dir.clone();
    blocking(move || presets::export(&dir, &id, &path)).await
}

#[tauri::command]
pub fn preset_dir(state: State<'_, AppState>) -> String {
    state.presets_dir.display().to_string()
}

#[tauri::command]
pub fn sync_status(state: State<'_, AppState>) -> SyncStatus {
    state.sync.status()
}

/// Registers the channel that receives peers coming and going, and their messages.
#[tauri::command]
pub fn sync_subscribe(state: State<'_, AppState>, webview: Webview, channel: Channel<SyncBatch>) {
    subscribe(&state.sync_subscribers, &webview, channel);
}

/// Joins a session. Without `secret`, the key remembered for this session name is used.
/// With `remember`, the derived key (never the secret) is kept on this device; otherwise any
/// remembered key is forgotten.
#[tauri::command]
pub async fn sync_join(
    state: State<'_, AppState>,
    session: String,
    secret: Option<String>,
    remember: bool,
    schema_version: u32,
) -> AppResult<SyncStatus> {
    let session = session.trim().to_string();
    if session.chars().count() > MAX_SESSION_CHARS {
        return Err(AppError::Sync(format!(
            "the session name is longer than {MAX_SESSION_CHARS} characters"
        )));
    }
    let path = state.sync.session_file();
    let psk = match secret.filter(|s| !s.trim().is_empty()) {
        Some(secret) => {
            let name = session.clone();
            blocking(move || derive_psk(&name, &secret)).await?
        }
        None => RememberedSession::load(&path)
            .filter(|r| normalize_session(&r.session) == normalize_session(&session))
            .and_then(|r| r.psk())
            .ok_or_else(|| AppError::Sync("enter the session key".into()))?,
    };
    if remember {
        let record = RememberedSession::new(&session, &psk);
        blocking(move || record.save(&path)).await?;
    } else {
        RememberedSession::forget(&path);
    }
    Ok(state.sync.join(&session, psk, schema_version).await)
}

#[tauri::command]
pub fn sync_leave(state: State<'_, AppState>) -> SyncStatus {
    state.sync.leave();
    state.sync.status()
}

/// A new random session key to share with the other devices.
#[tauri::command]
pub fn sync_new_key() -> String {
    new_session_key()
}

/// The session whose key is remembered on this device, if any.
#[tauri::command]
pub fn sync_remembered(state: State<'_, AppState>) -> Option<String> {
    RememberedSession::load(&state.sync.session_file()).map(|r| r.session)
}

#[tauri::command]
pub fn sync_forget(state: State<'_, AppState>) {
    RememberedSession::forget(&state.sync.session_file());
}

#[tauri::command]
pub fn sync_set_profile(state: State<'_, AppState>, name: String, color: u8) -> SyncStatus {
    state.sync.set_profile(&name, color)
}

#[tauri::command]
pub async fn sync_set_config(
    state: State<'_, AppState>,
    config: SyncConfig,
) -> AppResult<SyncStatus> {
    state.sync.set_config(config).await
}

/// The desks shared (or being joined) on this device; messages about others are dropped.
#[tauri::command]
pub fn sync_set_desks(state: State<'_, AppState>, desks: Vec<String>) {
    state.sync.set_desks(desks);
}

#[tauri::command]
pub fn sync_set_blocked(state: State<'_, AppState>, peer_ids: Vec<String>) -> SyncStatus {
    state.sync.set_blocked(peer_ids)
}

/// Queues a message for one peer, or all connected peers; returns how many it was queued for.
/// `body` is JSON text: Rust checks only that it is well-formed and within the kind's size cap.
#[tauri::command]
pub fn sync_send(
    state: State<'_, AppState>,
    peer: Option<String>,
    kind: AppKind,
    desk: Option<String>,
    body: String,
) -> AppResult<usize> {
    state
        .sync
        .send(peer.as_deref(), kind, desk.as_deref(), &body)
        .map_err(AppError::Sync)
}

/// The profile this instance runs as (`OSCOCTOPUS_PROFILE`), which keeps its settings apart.
#[tauri::command]
pub fn app_profile(state: State<'_, AppState>) -> Option<String> {
    state.profile.clone()
}

/// A shared desk's sync record, if it has one.
#[tauri::command]
pub async fn sync_doc_load(state: State<'_, AppState>, desk: String) -> AppResult<Option<Value>> {
    let dir = state.sync.docs_dir();
    blocking(move || docs::load(&dir, &desk)).await
}

/// Saves a shared desk: its sync record, then the preset.
#[tauri::command]
pub async fn sync_desk_save(
    state: State<'_, AppState>,
    preset: Value,
    record: Value,
) -> AppResult<PresetSummary> {
    let (docs_dir, presets_dir) = (state.sync.docs_dir(), state.presets_dir.clone());
    blocking(move || docs::save_with_preset(&docs_dir, &presets_dir, &preset, &record)).await
}

#[tauri::command]
pub async fn sync_doc_delete(state: State<'_, AppState>, desk: String) -> AppResult<()> {
    let dir = state.sync.docs_dir();
    blocking(move || docs::delete(&dir, &desk)).await
}

/// Earlier versions of a shared desk, newest first (restore one by importing it as a copy).
#[tauri::command]
pub async fn sync_backups(
    state: State<'_, AppState>,
    desk: String,
) -> AppResult<Vec<docs::Backup>> {
    let dir = state.sync.docs_dir();
    blocking(move || docs::backups(&dir, &desk)).await
}
