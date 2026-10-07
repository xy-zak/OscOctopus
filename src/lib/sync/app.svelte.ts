// Wires shared desks to the app: the workspace, the session, FREEZE and PAUSE, TRAFFIC, the
// touch store and the live display. Started from App.svelte once the session has started.
import { untrack } from 'svelte';
import { sync as syncIpc } from '../ipc/commands';
import { newPreset } from '../model/factory';
import { getSetting } from '../platform/settings';
import { deskChanges, forwardPolicy, localValues, syncRecords } from '../state/changes';
import { debugStore } from '../state/debug.svelte';
import { show } from '../state/live';
import { networkStore } from '../state/network.svelte';
import { persistSetting } from '../state/persist';
import { presetStore } from '../state/preset.svelte';
import { HOLD_OFF_MS, isTouched } from '../state/touch';
import { confirmAction, toast, ui } from '../state/ui.svelte';
import { editorsOf } from './locks';
import { MAX_EDITING, type Presence } from './protocol';
import { syncSession } from './session.svelte';
import { DIGEST_MS, SharedDesks, type Workspace } from './shared.svelte';
import { REFRESH_MS } from './values';

/** Presence goes out at most this often while things change. */
const PRESENCE_MS = 100;

const workspace: Workspace = {
  desks: () => presetStore.desks,
  find: (id) => presetStore.desks.find((d) => d.id === id),
  snapshot: (id) => presetStore.snapshot(id),
  hasSaved: (id) => presetStore.summaries.some((s) => s.id === id && !s.error),
  open: (id) => presetStore.openDesk(id),
  adopt: (desk) => presetStore.adopt(desk),
  applyRemote: (id, next, network) => presetStore.applyRemote(id, next, network),
  duplicate: (id, name) => presetStore.duplicateDesk(name, id),
  save: (id) => presetStore.save(id),
  blank: (id, name) => ({ ...newPreset(name, { loopbackInput: false }), id, widgets: [] }),
};

function newDocId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const sharedDesks = new SharedDesks(workspace, {
  get bus() {
    return syncSession.bus;
  },
  peerId: () => syncSession.peerId,
  joined: () => syncSession.joined,
  peerName: (p) => syncSession.peerName(p),
  locked: () => ui.locked,
  paused: () => networkStore.paused,
  confirm: (opts) => confirmAction(opts),
  note: (text) => debugStore.note(`sync: ${text}`, 'sync'),
  warn: (text) => {
    debugStore.local(`sync: ${text}`, undefined, 'sync');
    toast(text, 'error');
  },
  loadRecord: (id) => syncIpc.docLoad(id),
  isTouched: (key) => isTouched(key, HOLD_OFF_MS),
  show: (widget, value, origin) => show(widget, value, origin),
  now: () => Date.now(),
  newDocId,
});

/** The widget this device took over from other editors ("desk/widget"), if any. */
export const locks = $state({ takenOver: null as string | null });

/** Peers (other than this device) editing a widget, unless this device took it over. */
export function lockedBy(deskId: string, widgetId: string): string[] {
  if (locks.takenOver === `${deskId}/${widgetId}`) return [];
  return editorsOf(syncSession.presence, deskId, widgetId);
}

export function takeOver(deskId: string, widgetId: string) {
  locks.takenOver = `${deskId}/${widgetId}`;
}

let started = false;

/** Starts sharing desks (idempotent). Needs the session started (this device's id). */
export async function startSharedDesks() {
  if (started || !syncSession.peerId) return;
  started = true;
  sharedDesks.start();
  syncRecords.of = (id) => sharedDesks.recordFile(id);
  forwardPolicy.mayForward = (id) => sharedDesks.mayForward(id);
  sharedDesks.forwarding.splice(0, Infinity, ...((await getSetting('syncForwarding')) ?? []));
  deskChanges.on((c) => sharedDesks.localChange(c));
  localValues.on((c) => sharedDesks.localValue(c));
  setInterval(() => sharedDesks.sendDigests(), DIGEST_MS);
  setInterval(() => sharedDesks.values.refresh(), REFRESH_MS);

  let presenceTimer: ReturnType<typeof setTimeout> | undefined;
  let presence: Presence | null = null;
  const sendPresence = (peer: string | null) => {
    if (presence && syncSession.joined) void syncSession.bus.send(peer, 'presence', null, presence);
  };
  syncSession.bus.onPeers((c) => c.type === 'up' && sendPresence(c.peer.peerId));

  $effect.root(() => {
    // Desks opening and closing: load or drop their records.
    let known = new Set<string>();
    $effect(() => {
      const ids = presetStore.desks.map((d) => d.id);
      untrack(() => {
        const now = new Set(ids);
        for (const id of ids) if (!known.has(id)) void sharedDesks.deskOpened(id);
        for (const id of known) if (!now.has(id)) sharedDesks.deskClosed(id);
        known = now;
      });
    });
    // Remote edits that waited for FREEZE to be released.
    $effect(() => {
      if (!ui.locked) untrack(() => sharedDesks.unlocked());
    });
    // Joined or left: tell the transport and peers which desks are shared here.
    $effect(() => {
      void syncSession.joined;
      untrack(() => sharedDesks.pushDesks());
    });
    $effect(() => {
      const forwarding = [...sharedDesks.forwarding];
      untrack(() => void persistSetting('syncForwarding', forwarding));
    });
    // A take-over lasts while that widget stays selected.
    $effect(() => {
      const desk = presetStore.activeId;
      const selected = ui.mode === 'edit' ? ui.selected.map((id) => `${desk}/${id}`) : [];
      untrack(() => {
        if (locks.takenOver && !selected.includes(locks.takenOver)) locks.takenOver = null;
      });
    });
    // Presence: what this device views and edits, and who it is connected to.
    $effect(() => {
      void JSON.stringify(sharedDesks.view);
      void Object.keys(syncSession.peers);
      void syncSession.joined;
      const editing =
        ui.mode === 'edit' && ui.selected.length
          ? { desk: presetStore.activeId, widgets: ui.selected.slice(0, MAX_EDITING) }
          : null;
      const next = sharedDesks.presence(presetStore.activeId, editing);
      void sharedDesks.forwarding.length;
      untrack(() => {
        presence = next;
        clearTimeout(presenceTimer);
        presenceTimer = setTimeout(() => sendPresence(null), PRESENCE_MS);
      });
    });
  });
}
