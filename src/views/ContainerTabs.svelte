<script lang="ts">
  // The top row of tabs picks the *container* you are looking at: one of the open desks, or
  // GLOBAL SETTINGS (everything that belongs to no single desk). The active tab joins the frame below
  // it like a folder tab, and shares its colour, so what's inside the frame visibly belongs to
  // that tab. Desks run at the same time; the tab only chooses which one you see.
  //
  // Adding or removing a desk always asks first (see deskActions.ts). When FROZEN, tabs can
  // still be switched (that's performing) but not added or removed. PRESENTING shows the desk
  // tabs only: switching desks is all it is for.
  import { lookStore } from '../lib/state/look.svelte';
  import { networkStore } from '../lib/state/network.svelte';
  import { presetStore } from '../lib/state/preset.svelte';
  import { showDesk, showGlobal, ui } from '../lib/state/ui.svelte';
  import { sharedDesks } from '../lib/sync/app.svelte';
  import { viewersOf } from '../lib/sync/locks';
  import { syncSession } from '../lib/sync/session.svelte';
  import { colorVars, swatchOf } from '../lib/theme/palettes';
  import Icon from '../lib/ui/Icon.svelte';
  import type { Tone } from '../lib/ui/status';
  import { addDesk, duplicateDesk, openDesk, removeDesk } from './deskActions';

  let menuOpen = $state(false);
  /** Whether desks can be added and removed here. */
  const managing = $derived(!ui.locked && !ui.presenting);

  const closedPresets = $derived(
    presetStore.summaries.filter((s) => !s.error && !presetStore.isOpen(s.id)),
  );
  const globalFailing = $derived(
    Object.values(networkStore.statuses).filter((s) => s.state === 'error').length,
  );

  function health(deskId: string): Tone {
    const list = networkStore.forDesk(deskId).filter((s) => s.state !== 'disabled');
    if (list.length === 0) return 'off';
    if (list.some((s) => s.state === 'error')) return 'bad';
    return list.every((s) => s.state === 'ready') ? 'ok' : 'warn';
  }

  /** A desk tab always opens on the desk's CONTROLS. */
  function pick(id: string) {
    presetStore.activate(id);
    showDesk('controls');
  }

  /** Closes the menu, runs a menu action, and shows the resulting desk's controls. */
  async function fromMenu(action: () => Promise<boolean>) {
    menuOpen = false;
    if (await action()) showDesk('controls');
  }

  // Alt+1…9: desk N · Alt+0: GLOBAL SETTINGS · Alt+[ / Alt+]: previous / next desk.
  function onkeydown(e: KeyboardEvent) {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const digit = /^Digit([0-9])$/.exec(e.code);
    if (digit) {
      const n = Number(digit[1]);
      if (n === 0) showGlobal();
      else if (presetStore.desks[n - 1]) pick(presetStore.desks[n - 1]!.id);
      else return;
    } else if (e.key === '[' || e.key === ']') {
      const i = presetStore.desks.findIndex((d) => d.id === presetStore.activeId);
      const len = presetStore.desks.length;
      const next = presetStore.desks[(i + (e.key === ']' ? 1 : -1) + len) % len];
      if (next) pick(next.id);
    } else return;
    e.preventDefault();
  }
</script>

<svelte:window {onkeydown} />

<div class="tabs" role="tablist" aria-label="Desks and global settings">
  <!-- The tabs are outside every desk's look: each shows its colour in its own palette. -->
  {#each presetStore.desks as d, i (d.id)}
    {@const h = health(d.id)}
    {@const c = swatchOf(lookStore.forDesk(d.id).palette, d.color)}
    {@const on = ui.view === 'desk' && d.id === presetStore.activeId}
    <div class="tab desk" class:on role="presentation" style:--tc={c.c} style:--tc-ink={c.ink}>
      <button
        class="pick"
        role="tab"
        aria-selected={on}
        data-tip="Desk {i + 1}: {d.name} (Alt+{i + 1})"
        onclick={() => pick(d.id)}
      >
        <span class="chip" aria-hidden="true"></span>
        {#if sharedDesks.view[d.id]?.shared}<span
            class="shared"
            data-tip={syncSession.joined
              ? 'Shared with the session'
              : 'Shared (not syncing: no session joined)'}
            class:off={!syncSession.joined}>⇄</span
          >{/if}
        <span class="name">{d.name}</span>
        {#each viewersOf(syncSession.presence, d.id) as peer (peer)}
          <span
            class="viewer tinted"
            style:--tint={colorVars(syncSession.peers[peer]?.color ?? 0).c}
            data-tip="{syncSession.peerName(peer)} is on this desk">●</span
          >
        {/each}
        <span class="dot {h}" data-tip="Network: {h}">●</span>{#if presetStore.isDirty(d.id)}<span
            class="dirty"
            data-tip="Unsaved (autosaving)">+</span
          >{/if}
      </button>
      {#if managing && presetStore.desks.length > 1}
        <button
          class="x"
          data-tip="Remove desk"
          aria-label="Remove desk {d.name}"
          onclick={() => removeDesk(d.id)}><Icon name="close" /></button
        >
      {/if}
    </div>
  {/each}

  {#if managing}
    <div class="add-wrap">
      <button
        class="add"
        data-tip="Add a desk"
        aria-label="Add a desk"
        aria-expanded={menuOpen}
        onclick={() => (menuOpen = !menuOpen)}><Icon name="plus" /></button
      >
      {#if menuOpen}
        <div class="menu" role="menu">
          <button
            role="menuitem"
            onclick={() => fromMenu(() => addDesk(`Desk ${presetStore.desks.length + 1}`))}
            ><Icon name="file" /> New blank desk</button
          >
          <button role="menuitem" onclick={() => fromMenu(duplicateDesk)}
            ><Icon name="copy" /> Duplicate “{presetStore.current.name}”</button
          >
          {#if closedPresets.length}
            <span class="sep field-label">Open saved</span>
            {#each closedPresets as s (s.id)}
              <button role="menuitem" onclick={() => fromMenu(() => openDesk(s.id, s.name))}
                >▸ {s.name}</button
              >
            {/each}
          {/if}
        </div>
        <div class="menu-scrim" role="presentation" onpointerdown={() => (menuOpen = false)}></div>
      {/if}
    </div>
  {/if}

  <span class="gap"></span>

  <!-- GLOBAL SETTINGS is not a desk: it's set apart at the end, neutral white, never numbered. -->
  {#if !ui.presenting}
    <div class="tab global" class:on={ui.view === 'global'} role="presentation">
      <button
        class="pick"
        role="tab"
        aria-selected={ui.view === 'global'}
        data-tip="GLOBAL SETTINGS: traffic of all desks, this device, preset library, look (Alt+0)"
        onclick={() => showGlobal()}
      >
        <Icon name="grid" />
        <span class="name">GLOBAL<span class="long">SETTINGS</span></span
        >{#if globalFailing > 0}<span class="badge">{globalFailing}!</span>{/if}
      </button>
    </div>
  {/if}
</div>

<style>
  .tabs {
    display: flex;
    align-items: flex-end;
    min-width: 0;
    flex: 1;
    height: 100%;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
  }
  .gap {
    flex: 1;
    min-width: 2ch;
  }
  /* A tab is a folder tab: 2px border on three sides in its colour. The header paints the
     frame's top line along its bottom edge; the active tab's background covers that line, so
     tab and frame read as one object (no negative margins, so the strip can still scroll). */
  /* Inactive: a closed box floating just above the frame line, with a pixel shadow.
     Active: open at the bottom, reaching down to cover the line, joined to its frame. */
  .tab {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    height: 28px;
    margin: 0 4px 6px 0;
    border: 2px solid transparent;
    background: var(--bg);
    box-shadow: 2px 2px 0 0 var(--shadow-px);
    color: var(--fg-dim);
    transition:
      background var(--t-ui) steps(2),
      color var(--t-ui) steps(2),
      border-color var(--t-ui) steps(2);
  }
  .tab.desk {
    border-color: color-mix(in srgb, var(--tc) 35%, transparent);
  }
  .tab.global {
    --tc: var(--fg);
    border-color: var(--line-strong);
  }
  .tab:hover {
    color: var(--fg);
  }
  .tab.on {
    height: 34px;
    margin-bottom: 0;
    border-bottom: 0;
    box-shadow: none;
    border-color: var(--tc);
    background: var(--bg-2);
    color: var(--fg);
    font-weight: 700;
  }
  .pick {
    display: flex;
    align-items: center;
    gap: 1ch;
    height: 100%;
    padding: 0 1.5ch;
    border: 0;
    background: none;
    color: inherit;
    white-space: nowrap;
  }
  .chip {
    width: 1ch;
    height: 12px;
    background: var(--tc);
  }
  .name {
    max-width: 22ch;
    overflow: hidden;
    text-overflow: ellipsis;
    text-transform: uppercase;
  }
  .long {
    margin-left: 1ch;
  }
  .dot {
    color: var(--fg-faint);
  }
  .dot.ok {
    color: var(--ok);
  }
  .dot.warn {
    color: var(--warn);
  }
  .dot.bad {
    color: var(--danger);
  }
  .dirty {
    color: var(--fg-dim);
  }
  /* Shared desk: ⇄, dimmed when no session is joined. Dots: peers on this desk. */
  .shared {
    color: var(--accent-text);
  }
  .shared.off {
    color: var(--fg-faint);
  }
  .viewer {
    margin-left: -0.5ch;
  }
  .badge {
    padding: 0 0.5ch;
    background: var(--danger);
    color: var(--bg);
  }
  .x {
    height: 100%;
    padding: 0 1ch 0 0;
    border: 0;
    background: none;
    color: var(--fg-faint);
  }
  .x:hover {
    color: var(--danger);
  }
  .add-wrap {
    position: relative;
    align-self: flex-end;
    margin: 0 0 7px 0.5ch;
  }
  .add {
    width: 26px;
    height: 26px;
    border: 1px dashed var(--line-strong);
    background: none;
    color: var(--fg-dim);
  }
  .add:hover {
    color: var(--fg);
    border-color: var(--fg);
  }
  .menu {
    position: fixed;
    z-index: 60;
    margin-top: 4px;
    min-width: 34ch;
    display: flex;
    flex-direction: column;
    padding: 4px 0;
    border: 1px solid var(--fg);
    background: var(--bg-2);
    box-shadow: 4px 4px 0 0 var(--shadow-px);
    animation: drop var(--t-release) steps(3, end);
  }
  @keyframes drop {
    from {
      transform: translateY(-6px);
      opacity: 0;
    }
  }
  .menu-scrim {
    position: fixed;
    inset: 0;
    z-index: 59;
  }
  /* Menu items read like buttons: upper-cased, names included. */
  .menu button {
    display: flex;
    gap: 1ch;
    padding: 3px 1.5ch;
    border: 0;
    background: none;
    text-align: left;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .menu button:hover,
  .menu button:focus-visible {
    background: var(--fg);
    color: var(--bg);
    outline: none;
  }
  .sep {
    padding: 4px 1.5ch 2px;
  }
  @media (max-width: 760px) {
    .name {
      max-width: 10ch;
    }
    .long {
      display: none;
    }
  }
</style>
