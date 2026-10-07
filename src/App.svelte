<script lang="ts">
  // App shell. The layout encodes scope:
  //
  //   ▓ global banners (FROZEN / PAUSED): the whole app, full width, above everything
  //   ┌ top bar ────────────────────────────────────────────────────────────────────────┐
  //   │ logo  [DESK A][DESK B][+]     [GLOBAL SETTINGS] │ out · OSC-IN · OSC-OUT · FREEZE · PRESENT │
  //   └──────╥──────────────────────────────────────────────────────────────────────────┘
  //   ╔══════╝ frame in the active container's colour ═════════════════════════════════╗
  //   ║ F1 CONTROLS  F2 NETWORK  F3 TRAFFIC  F4 LOOK  F5 SYNC                             ║
  //   ║ …section…                                                                        ║
  //   ╚══════════════════════════════════════════════════════════════════════════════════╝
  //
  // Everything inside the frame belongs to the tab it hangs from. NETWORK, TRAFFIC and SYNC exist
  // in both a desk and GLOBAL SETTINGS; the frame's colour (the desk's own, or white) says which.
  //
  // PRESENTING keeps only the desk tabs and the switches (OSC-IN · OSC-OUT · FREEZE · PRESENT) in
  // the top bar, exactly where they were, and the frame holds nothing but the desk's widgets.
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { onMount } from 'svelte';
  import { isTauri } from './lib/ipc/commands';
  import { followPresenting } from './lib/platform/fullscreen';
  import { getSetting, type Settings } from './lib/platform/settings';
  import { appearance } from './lib/state/appearance.svelte';
  import { debugStore } from './lib/state/debug.svelte';
  import { networkStore } from './lib/state/network.svelte';
  import { startReceiver } from './lib/osc/receiver.svelte';
  import { inputStore } from './lib/state/input.svelte';
  import { lookStore } from './lib/state/look.svelte';
  import { persistSetting } from './lib/state/persist';
  import { presetStore } from './lib/state/preset.svelte';
  import { sequencerStore } from './lib/state/sequencer.svelte';
  import { skinStore } from './lib/state/skins.svelte';
  import { sharedDesks, startSharedDesks } from './lib/sync/app.svelte';
  import { syncSession } from './lib/sync/session.svelte';
  import {
    currentSection,
    currentSections,
    setLocked,
    setPresenting,
    showGlobal,
    showSectionAt,
    toggleEditMode,
    ui,
  } from './lib/state/ui.svelte';
  import { applySkinSheets } from './lib/skins/sheets';
  import { cssText, lookVars } from './lib/theme/look';
  import { swatchOf } from './lib/theme/palettes';
  import Tooltip from './lib/ui/Tooltip.svelte';
  import ConfirmDialog from './lib/ui/ConfirmDialog.svelte';
  import HoldSwitch from './lib/ui/HoldSwitch.svelte';
  import PixelLogo from './lib/ui/PixelLogo.svelte';
  import { measureCharWidth } from './lib/ui/textfit';
  import { errorText } from './lib/util';
  import ContainerTabs from './views/ContainerTabs.svelte';
  import Desk from './views/Desk.svelte';
  import DeskNetwork from './views/DeskNetwork.svelte';
  import DeskLook from './views/DeskLook.svelte';
  import DeskSwitches from './views/DeskSwitches.svelte';
  import DeskSync from './views/DeskSync.svelte';
  import GlobalNetwork from './views/GlobalNetwork.svelte';
  import GlobalSync from './views/GlobalSync.svelte';
  import Library from './views/Library.svelte';
  import Look from './views/Look.svelte';
  import Traffic from './views/Traffic.svelte';

  let ready = $state(false);
  let fatal: string | null = $state(null);

  onMount(async () => {
    // Text placement is character arithmetic, so measure the real font first.
    await measureCharWidth();
    if (!isTauri()) {
      fatal =
        'OscOctopus needs its native core to open sockets. Start it with `npm run tauri dev`.';
      return;
    }
    try {
      // Debug first so nothing that happens during startup goes unrecorded.
      await debugStore.start();
      await networkStore.start();
      // Restore PAUSE before any desk's network starts: a restart mid-show must not
      // suddenly resume output.
      if (await getSetting('paused')) await networkStore.setPaused(true);
      // Input mapping: listen first, then open the gate (Rust starts with it closed).
      await startReceiver();
      await inputStore.setEnabled((await getSetting('inputEnabled')) ?? true);
      ui.locked = (await getSetting('locked')) ?? false;
      setPresenting((await getSetting('presenting')) ?? false);
      await presetStore.init();
      // After the desks: a reloaded page picks up the sequences still playing in the core.
      await sequencerStore.start();
      await skinStore.load();
      ui.infoOpen = (await getSetting('infoOpen')) ?? true;
      ui.editPanel = (await getSetting('editPanel')) ?? 'add';
      Object.assign(ui.inspectorOpen, await getSetting('inspectorSections'));
      Object.assign(ui.infoSections, await getSetting('infoSections'));
      ready = true;
      // Sync last: the desks it may share are open by now. A failure here (e.g. the port is
      // taken) is shown in the SYNC section, never blocks the app.
      await syncSession.start().catch((e: unknown) => (syncSession.error = errorText(e)));
      await startSharedDesks();
    } catch (e) {
      fatal = `Startup failed: ${errorText(e)}`;
    }
  });

  // Edits autosave after a short pause; write whatever is still pending before the window
  // closes, and whenever the app is hidden (a phone may kill a backgrounded app unasked).
  // Closing waits for the flush, but never longer than FLUSH_ON_CLOSE_MS.
  const FLUSH_ON_CLOSE_MS = 3000;
  onMount(() => {
    const flush = () => presetStore.flushAll().catch(() => {});
    const flushBeforeClose = () =>
      Promise.race([flush(), new Promise((r) => setTimeout(r, FLUSH_ON_CLOSE_MS))]).then(() => {});
    const onHidden = () => document.hidden && void flush();
    document.addEventListener('visibilitychange', onHidden);
    const unlisten = isTauri() ? getCurrentWindow().onCloseRequested(flushBeforeClose) : null;
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      void unlisten?.then((stop) => stop());
    };
  });

  // Per-device state that survives restarts: the info panel, the edit panel, OSC-IN, OSC-OUT,
  // FREEZE and PRESENTING. Saved on every change once startup has restored it, never before.
  function remember<K extends keyof Settings>(key: K, read: () => Settings[K]) {
    $effect(() => {
      const value = read();
      if (ready) void persistSetting(key, value);
    });
  }
  remember('infoOpen', () => ui.infoOpen);
  remember('editPanel', () => ui.editPanel);
  remember('inputEnabled', () => inputStore.enabled);
  remember('paused', () => networkStore.paused);
  remember('locked', () => ui.locked);
  remember('presenting', () => ui.presenting);

  // The look of every desk → CSS variables on :root (registered with @property, so changes
  // crossfade): what everything outside a desk is coloured by. The desk shown has its own look
  // around its contents (`deskLook`, on <main>).
  $effect(() => {
    const root = document.documentElement.style;
    const { mode } = appearance.theme;
    for (const [k, v] of Object.entries(lookVars(lookStore.global))) {
      root.setProperty(k, v);
    }
    // Light/dark background: tokens.css switches the base colours on data-mode.
    document.documentElement.dataset.mode = mode;
  });
  // User skins' stylesheets (built-in skins are in app.css).
  $effect(() => applySkinSheets(skinStore.user));

  // On desktop the window follows PRESENTING into fullscreen and back (platform/fullscreen.ts).
  $effect(() => {
    const on = ui.presenting;
    if (!ready) return;
    followPresenting(on).catch((e: unknown) =>
      debugStore.local(`could not ${on ? 'enter' : 'leave'} fullscreen: ${errorText(e)}`),
    );
  });

  const desk = $derived(presetStore.current);
  const deskFailing = $derived(
    networkStore.forDesk(desk.id).filter((s) => s.state === 'error').length,
  );
  const allFailing = $derived(
    Object.values(networkStore.statuses).filter((s) => s.state === 'error').length,
  );
  /** Failing endpoints to badge on a section: this desk's, or every desk's. */
  const failing = (id: string) =>
    id !== 'network' ? 0 : ui.view === 'desk' ? deskFailing : allFailing;

  // What the frame holds is drawn in the look of its container: the desk's own, or every desk's
  // for GLOBAL SETTINGS.
  const frameLook = $derived(ui.view === 'desk' ? lookStore.forDesk(desk.id) : lookStore.global);
  const frameVars = $derived(cssText(lookVars(frameLook)));
  // The frame takes the active container's colour: the desk's identity colour (in its own
  // palette), or neutral white for GLOBAL SETTINGS.
  const scope = $derived(
    ui.view === 'desk'
      ? swatchOf(frameLook.palette, desk.color)
      : { c: 'var(--fg)', ink: 'var(--bg)' },
  );

  // The hold-to-change switches, so their Alt shortcuts can hold them too.
  let inSwitch: ReturnType<typeof HoldSwitch> | undefined = $state();
  let outSwitch: ReturnType<typeof HoldSwitch> | undefined = $state();
  let lockSwitch: ReturnType<typeof HoldSwitch> | undefined = $state();
  let presentSwitch: ReturnType<typeof HoldSwitch> | undefined = $state();
  /** The switch an Alt shortcut is holding, and that key's code. */
  let held: { sw: ReturnType<typeof HoldSwitch>; code: string } | null = null;
  /** Alt+<key> holds these. */
  const holdKeys = $derived<Record<string, ReturnType<typeof HoldSwitch> | undefined>>({
    i: inSwitch,
    p: outSwitch,
    l: lockSwitch,
  });

  // F1…F5: sections of whatever container you're in. F11 presents; holding F11 or Esc for one
  // second stops, like holding PRESENT. Alt+E edit. Alt+I OSC-IN, Alt+P OSC-OUT and Alt+L
  // FREEZE are held like their switches: one second, on and off alike, never a single keystroke.
  function onkeydown(e: KeyboardEvent) {
    const plain = !e.altKey && !e.ctrlKey && !e.metaKey;
    const f = /^F([1-5])$/.exec(e.key);
    if (f && plain) {
      showSectionAt(Number(f[1]) - 1);
      e.preventDefault();
      return;
    }
    // An Esc that closes a dialog (before or after this handler) is only for the dialog.
    const stop = e.key === 'Escape' && ui.presenting && !ui.confirm && !e.defaultPrevented;
    if (plain && (e.key === 'F11' || stop)) {
      e.preventDefault();
      if (!ui.presenting) setPresenting(true);
      else if (presentSwitch && !e.repeat && !held) {
        held = { sw: presentSwitch, code: e.code };
        presentSwitch.press();
      }
      return;
    }
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.key.toLowerCase();
    const sw = holdKeys[k];
    if (sw) {
      if (!e.repeat && !held) {
        held = { sw, code: e.code };
        sw.press();
      }
    } else if (k === 'e' && ui.view === 'desk') toggleEditMode();
    else return;
    e.preventDefault();
  }

  // Totals across every open desk: they all run at once.
  const outputs = $derived(
    Object.values(networkStore.statuses).filter(
      (s) => s.kind === 'output' && s.state !== 'disabled',
    ),
  );
  const readyOutputs = $derived(outputs.filter((s) => s.state === 'ready').length);
  /** OUT lamp: red when an endpoint failed, green when every enabled output is ready. */
  const outLamp = $derived(
    allFailing > 0 ? 'bad' : outputs.length > 0 && readyOutputs === outputs.length ? 'ok' : 'warn',
  );
  const txRate = $derived(Object.values(networkStore.rates).reduce((a, r) => a + r.txPps, 0));

  // SYNC pill: devices connected in the session; trouble when an address is being refused.
  const syncPeers = $derived(syncSession.status?.peers ?? []);
  const syncConnected = $derived(syncPeers.filter((p) => p.state === 'connected').length);
  const syncTrouble = $derived(syncPeers.some((p) => p.state === 'refused'));
  /** SYNC lamp: off outside a session; red when an address is refused; green with peers. */
  const syncLamp = $derived(
    !syncSession.joined ? '' : syncTrouble ? 'bad' : syncConnected > 0 ? 'ok' : 'warn',
  );
  /** Shared desks with remote edits waiting for FREEZE to be released. */
  const waiting = $derived(Object.values(sharedDesks.view).filter((v) => v.waiting).length);
</script>

<svelte:window
  {onkeydown}
  onkeyup={(e) => {
    // Letting go of the key (or of Alt, for an Alt shortcut) ends the hold.
    if (held && (e.code === held.code || e.key === 'Alt')) {
      held.sw.release();
      held = null;
    }
  }}
  onblur={() => {
    held?.sw.cancel();
    held = null;
  }}
/>

<div class="app" style:--scope={scope.c} style:--scope-ink={scope.ink}>
  <!-- Whole-app states: full width, above everything, because they affect every desk. While
       presenting, the OSC-OUT and FREEZE switches say it on their own. -->
  {#if ui.locked && !ui.presenting}
    <div class="banner locked" role="status">
      ■ FROZEN · all desks · press and hold FREEZE for 1 second to unfreeze{waiting
        ? ` · edits from other devices on ${waiting} shared desk(s) are applied on unfreeze`
        : ''}
    </div>
  {/if}
  {#if networkStore.paused && !ui.presenting}
    <div class="banner paused" role="status">
      ▓▓ OUTPUT PAUSED · all desks · nothing leaves the app · held packets are logged ▓▓
    </div>
  {/if}

  <header class="top">
    {#if !ui.presenting}<span class="brand" data-tip="OscOctopus"><PixelLogo /></span>{/if}
    {#if ready}<ContainerTabs />{:else}<span class="tabs-placeholder"></span>{/if}
    <!-- The master bar affects every desk, so it sits outside every tab and frame. Status first
         (click to open it), then the switches, from least to most restrictive: OSC-IN lets
         incoming OSC in, OSC-OUT outgoing, FREEZE stops everything. PRESENT is last: it changes
         the view, not what the app does. All six share one shape (.mbtn, app.css); a switch
         fills with the accent while on. Presenting hides only the status, so the switches never
         move. -->
    <div class="master" aria-label="All desks">
      {#if !ui.presenting}
        <button
          class="mbtn"
          onclick={() => showGlobal('network')}
          data-tip="Outputs ready / enabled across all desks · messages per second. Click for NETWORK"
        >
          <span class="lamp {outLamp}">●</span>{readyOutputs}/{outputs.length} OUT<span class="rate"
            >{txRate.toFixed(0)}/s</span
          >
        </button>
        <button
          class="mbtn"
          onclick={() => showGlobal('sync')}
          data-tip={syncSession.joined
            ? `Session “${syncSession.status?.session}”: ${syncConnected} device(s) connected. Click for SYNC`
            : 'Not sharing: click to join a session with other devices (GLOBAL SETTINGS › SYNC)'}
        >
          <span class="lamp {syncLamp}">{syncSession.joined ? '●' : '○'}</span>{syncSession.joined
            ? `${syncConnected} SYNC`
            : 'SYNC'}
        </button>
        <span class="sep" aria-hidden="true"></span>
      {/if}
      <!-- OSC-IN, OSC-OUT and FREEZE change only after a one-second hold, on and off alike;
           PRESENT turns on with a click, and only a hold stops it. -->
      <HoldSwitch
        bind:this={inSwitch}
        label="OSC-IN"
        on={inputStore.enabled}
        onchange={(on) => inputStore.setEnabled(on)}
        tip={inputStore.enabled
          ? 'OSC-IN is on: incoming OSC drives widgets whose messages receive. Hold 1 s to ignore all input (Alt+I)'
          : 'OSC-IN is off: incoming OSC is ignored (still shown in TRAFFIC). Hold 1 s to let it drive widgets (Alt+I)'}
      />
      <!-- OSC-OUT off is PAUSE: nothing leaves the app. Off is a safety state, so it is red. -->
      <HoldSwitch
        bind:this={outSwitch}
        label="OSC-OUT"
        wide
        offTone="alarm"
        blinkOff
        on={!networkStore.paused}
        onchange={(on) => networkStore.setPaused(!on)}
        tip={networkStore.paused
          ? 'OSC-OUT is off: output of all desks is paused, nothing is sent. Hold 1 s to resume (Alt+P)'
          : 'OSC-OUT is on: every desk sends. Hold 1 s to pause all outgoing OSC (Alt+P)'}
      />
      <HoldSwitch
        bind:this={lockSwitch}
        label="FREEZE"
        onLabel="FROZEN"
        onTone="warn"
        on={ui.locked}
        onchange={setLocked}
        nudge={ui.lockNudge}
        tip={ui.locked
          ? 'Frozen: hold 1 s to unfreeze (Alt+L)'
          : 'Hold 1 s to freeze widgets and settings for a show (Alt+L)'}
      />
      <HoldSwitch
        bind:this={presentSwitch}
        label="PRESENT"
        wide
        holdOff
        on={ui.presenting}
        onchange={setPresenting}
        tip={ui.presenting
          ? 'Presenting: only this desk’s widgets, full screen. Hold 1 s to stop (or hold Esc or F11)'
          : 'PRESENT: only this desk’s widgets, full screen. Desk tabs and these switches stay (F11)'}
      />
    </div>
  </header>

  <section class="frame" aria-label={ui.view === 'desk' ? `Desk ${desk.name}` : 'Global settings'}>
    {#if !ui.presenting}
      <div class="frame-head">
        <div class="sections" role="tablist" aria-label="Sections">
          {#each currentSections() as s, i (s.id)}
            {@const bad = failing(s.id)}
            <button
              class="section"
              role="tab"
              aria-selected={currentSection() === s.id}
              class:on={currentSection() === s.id}
              data-tip="{s.hint} (F{i + 1})"
              onclick={() => showSectionAt(i)}
              ><span class="fkey">F{i + 1}</span><span class="section-label">{s.label}</span
              >{#if bad > 0}<span class="badge">{bad}!</span>{/if}</button
            >
          {/each}
        </div>
        {#if ready && ui.view === 'desk' && ui.deskView === 'controls'}<DeskSwitches />{/if}
      </div>
    {/if}

    <main class:locked={ui.locked} data-look style={frameVars}>
      {#if fatal}
        <div class="fatal">
          <h2>Cannot start</h2>
          <p>{fatal}</p>
        </div>
      {:else if !ready}
        <div class="loading faint">starting<span class="blink">_</span></div>
      {:else if ui.view === 'desk'}
        {#if ui.deskView === 'controls'}
          <Desk />
        {:else if ui.deskView === 'network'}
          <DeskNetwork />
        {:else if ui.deskView === 'traffic'}
          {#key desk.id}
            <Traffic scope={desk.id} />
          {/key}
        {:else if ui.deskView === 'look'}
          <DeskLook />
        {:else}
          <DeskSync />
        {/if}
      {:else if ui.globalView === 'network'}
        <GlobalNetwork />
      {:else if ui.globalView === 'traffic'}
        <Traffic />
      {:else if ui.globalView === 'library'}
        <Library />
      {:else if ui.globalView === 'look'}
        <Look />
      {:else}
        <GlobalSync />
      {/if}
    </main>
  </section>

  <ConfirmDialog />
  <Tooltip />

  {#if ui.toast}
    {#key ui.toast.id}
      <div class="toast {ui.toast.kind}" role="status">
        <span class="tag">{ui.toast.kind === 'error' ? 'ERR' : 'OK'}</span>{ui.toast.text}
      </div>
    {/key}
  {/if}
</div>

<style>
  .app {
    height: 100%;
    display: flex;
    flex-direction: column;
    padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom)
      env(safe-area-inset-left);
  }

  /* ---- top bar ------------------------------------------------------------------------ */
  .top {
    flex: none;
    display: flex;
    align-items: flex-end;
    gap: 1ch;
    height: 42px;
    padding: 0 1ch;
    background: var(--bg);
    /* The frame's top line, painted here so the active tab can cover it (see ContainerTabs). */
    box-shadow: inset 0 -2px 0 0 var(--scope);
    transition: box-shadow var(--t-ui) steps(2);
  }
  .brand {
    align-self: center;
    display: flex;
    margin-right: 1ch;
  }
  .tabs-placeholder {
    flex: 1;
  }
  .master {
    align-self: center;
    display: flex;
    align-items: center;
    gap: 1ch;
    padding-left: 1.5ch;
    margin-bottom: 2px;
    border-left: 1px solid var(--line);
  }
  .rate {
    color: var(--fg-faint);
  }
  /* Between the readouts and the switches. */
  .sep {
    width: 1px;
    height: 20px;
    background: var(--line);
  }
  /* Narrow screens: the master controls get their own line on top, so the tabs keep the
     full width and still sit directly on the frame they open. */
  @media (max-width: 760px) {
    .top {
      flex-wrap: wrap;
      height: auto;
      padding-top: 4px;
      row-gap: 4px;
    }
    .brand {
      order: -2;
    }
    /* A phone is too narrow for all of it: it wraps, right-aligned, so each control stays
       reachable. */
    .master {
      order: -1;
      flex: 1;
      min-width: 0;
      flex-wrap: wrap;
      justify-content: flex-end;
      row-gap: 4px;
      margin-bottom: 0;
      padding-left: 0;
      border-left: 0;
    }
    .top > :global(.tabs) {
      order: 0;
      flex-basis: 100%;
      height: 36px;
    }
    .rate {
      display: none;
    }
  }

  /* ---- the frame: everything in it belongs to the active tab ------------------------------ */
  .frame {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    border: 2px solid var(--scope);
    border-top: 0;
    transition: border-color var(--t-ui) steps(2);
  }
  .frame-head {
    flex: none;
    display: flex;
    align-items: center;
    gap: 1ch;
    min-height: 36px;
    padding: 0 1ch;
    background: var(--bg-2);
    border-bottom: 1px solid var(--line);
  }
  /* The tab above already names the container, so the sections start at the edge. They scroll
     sideways when narrow; the desk's switches after them (DeskSwitches) never do. */
  .sections {
    flex: 1;
    min-width: 0;
    display: flex;
    overflow-x: auto;
    scrollbar-width: none;
  }
  /* F-key sections, Midnight Commander style: the key beside the label; active = reverse. */
  .section {
    display: flex;
    align-items: center;
    height: 26px;
    padding: 0 1.5ch 0 0;
    border: 0;
    background: none;
    color: var(--fg-dim);
    white-space: nowrap;
    transition:
      background var(--t-ui) steps(2),
      color var(--t-ui) steps(2);
  }
  .fkey {
    padding: 0 0.5ch;
    margin-right: 0.75ch;
    color: var(--fg-faint);
  }
  .section:hover {
    color: var(--fg);
  }
  .section.on {
    background: var(--scope);
    color: var(--scope-ink);
    font-weight: 700;
  }
  .section.on .fkey {
    color: var(--scope-ink);
    opacity: 0.7;
  }
  .badge {
    margin-left: 0.5ch;
    padding: 0 0.5ch;
    background: var(--danger);
    color: var(--bg);
    font-weight: 700;
  }
  @media (max-width: 760px) {
    .fkey {
      display: none;
    }
    .section {
      padding: 0 1ch;
    }
  }
  main {
    flex: 1;
    min-height: 0;
    position: relative;
  }

  /* ---- global banners ------------------------------------------------------------------ */
  .banner {
    flex: none;
    padding: 2px 1ch;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 700;
  }
  .banner.locked {
    background: var(--warn);
    color: var(--bg);
  }
  .banner.paused {
    background: repeating-linear-gradient(
      -45deg,
      var(--danger) 0 8px,
      color-mix(in srgb, var(--danger) 80%, black) 8px 16px
    );
    color: var(--bg);
    animation: stripes 1s steps(4) infinite;
  }
  @keyframes stripes {
    to {
      background-position: 22.6px 0;
    }
  }

  .loading,
  .fatal {
    margin: 40px auto;
    max-width: 60ch;
    padding: 2ch;
  }
  .blink {
    animation: blink 1s steps(1) infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0;
    }
  }
  .toast {
    position: fixed;
    left: 50%;
    bottom: calc(20px + env(safe-area-inset-bottom));
    display: flex;
    gap: 1ch;
    max-width: min(80ch, calc(100vw - 32px));
    padding: 4px 1ch;
    border: 1px solid var(--fg);
    background: var(--bg-2);
    box-shadow: 4px 4px 0 0 var(--shadow-px);
    translate: -50% 0;
    animation: pop var(--t-release) steps(3, end);
    z-index: 100;
    overflow-wrap: anywhere;
  }
  .tag {
    flex: none;
    padding: 0 1ch;
    background: var(--ok);
    color: var(--bg);
    font-weight: 700;
  }
  .toast.error {
    border-color: var(--danger);
  }
  .toast.error .tag {
    background: var(--danger);
  }
  @keyframes pop {
    from {
      transform: translateY(12px);
      opacity: 0;
    }
  }
</style>
