<script lang="ts">
  // App shell. The layout encodes scope:
  //
  //   ▓ global banners (LOCKED / PAUSED): the whole app, full width, above everything
  //   ┌ top bar ────────────────────────────────────────────────────────────────────────┐
  //   │ logo  [DESK A][DESK B][+]              [GLOBAL SETTINGS] │ out · PAUSE · LOCK             │
  //   └──────╥──────────────────────────────────────────────────────────────────────────┘
  //   ╔══════╝ frame in the active container's colour ═════════════════════════════════╗
  //   ║ F1 CONTROLS  F2 NETWORK  F3 TRAFFIC  F4 PRESET                       tools        ║
  //   ║ …section…                                                                        ║
  //   ╚══════════════════════════════════════════════════════════════════════════════════╝
  //
  // Everything inside the frame belongs to the tab it hangs from. NETWORK and TRAFFIC exist in
  // both a desk and GLOBAL SETTINGS; the frame's colour (the desk's own, or white) says which.
  import { onMount } from 'svelte';
  import { isTauri } from './lib/ipc/commands';
  import { getSetting, setSetting } from './lib/platform/settings';
  import { appearance } from './lib/state/appearance.svelte';
  import { debugStore } from './lib/state/debug.svelte';
  import { networkStore } from './lib/state/network.svelte';
  import { presetStore } from './lib/state/preset.svelte';
  import {
    errorText,
    toggleEditMode,
    ui,
    type DeskView,
    type SystemView,
  } from './lib/state/ui.svelte';
  import { colorVars, paletteVars } from './lib/theme/palettes';
  import ConfirmDialog from './lib/ui/ConfirmDialog.svelte';
  import Icon from './lib/ui/Icon.svelte';
  import LockButton from './lib/ui/LockButton.svelte';
  import PixelLogo from './lib/ui/PixelLogo.svelte';
  import { measureCharWidth } from './lib/ui/textfit';
  import ContainerTabs from './views/ContainerTabs.svelte';
  import Debug from './views/Debug.svelte';
  import Desk from './views/Desk.svelte';
  import DeskPreset from './views/DeskPreset.svelte';
  import GlobalNetwork from './views/GlobalNetwork.svelte';
  import Library from './views/Library.svelte';
  import Look from './views/Look.svelte';
  import Network from './views/Network.svelte';

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
      ui.locked = (await getSetting('locked')) ?? false;
      await presetStore.init();
      ui.infoOpen = (await getSetting('infoOpen')) ?? true;
      ready = true;
    } catch (e) {
      fatal = `Startup failed: ${errorText(e)}`;
    }
  });

  // Remember per-device state: info panel, LOCK and PAUSE survive restarts.
  $effect(() => {
    const open = ui.infoOpen;
    if (ready) void setSetting('infoOpen', open).catch(() => {});
  });
  $effect(() => {
    const locked = ui.locked;
    if (ready) void setSetting('locked', locked).catch(() => {});
  });
  $effect(() => {
    const paused = networkStore.paused;
    if (ready) void setSetting('paused', paused).catch(() => {});
  });

  function setLocked(locked: boolean) {
    ui.locked = locked;
    if (locked) {
      // Locking ends any edit in progress.
      ui.mode = 'live';
      ui.selectedId = null;
      ui.confirm?.resolve(false);
    }
  }

  // Global palette → CSS variables (registered with @property, so changes crossfade).
  $effect(() => {
    const root = document.documentElement.style;
    const { palette, accent, mode } = appearance.theme;
    for (const [k, v] of Object.entries(paletteVars(palette, accent))) root.setProperty(k, v);
    // Light/dark background: tokens.css switches the base colours on data-mode.
    document.documentElement.dataset.mode = mode;
  });

  const desk = $derived(presetStore.current);
  const deskFailing = $derived(
    networkStore.forDesk(desk.id).filter((s) => s.state === 'error').length,
  );
  const allFailing = $derived(
    Object.values(networkStore.statuses).filter((s) => s.state === 'error').length,
  );

  const deskSections: { id: DeskView; label: string; hint: string }[] = [
    { id: 'controls', label: 'CONTROLS', hint: 'This desk’s widgets: play them, or EDIT them' },
    { id: 'io', label: 'NETWORK', hint: 'This desk’s OSC outputs and inputs' },
    { id: 'monitor', label: 'TRAFFIC', hint: 'Traffic of this desk only' },
    { id: 'preset', label: 'PRESET', hint: 'This desk’s name, colour and preset file' },
  ];
  const systemSections: { id: SystemView; label: string; hint: string }[] = [
    {
      id: 'device',
      label: 'NETWORK',
      hint: 'This device’s interfaces, and every desk’s endpoints',
    },
    { id: 'traffic', label: 'TRAFFIC', hint: 'Traffic of all desks together' },
    { id: 'library', label: 'LIBRARY', hint: 'All saved desk presets on this device' },
    { id: 'look', label: 'LOOK', hint: 'Background, palette and accent, shared by every desk' },
  ];

  // The frame takes the active container's colour: the desk's identity colour, or neutral
  // white for GLOBAL SETTINGS.
  const scope = $derived(
    ui.view === 'desk' ? colorVars(desk.color) : { c: 'var(--fg)', ink: 'var(--bg)' },
  );

  // F1…F4: sections of whatever container you're in. Alt+E edit, Alt+P pause, Alt+L lock
  // (unlocking needs the press-and-hold on LOCK, never a single keystroke).
  function onkeydown(e: KeyboardEvent) {
    const f = /^F([1-4])$/.exec(e.key);
    if (f && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const i = Number(f[1]) - 1;
      if (ui.view === 'desk') ui.deskView = deskSections[i]!.id;
      else ui.systemView = systemSections[i]!.id;
      e.preventDefault();
      return;
    }
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.key.toLowerCase();
    if (k === 'e' && ui.view === 'desk') toggleEditMode();
    else if (k === 'p') void networkStore.setPaused(!networkStore.paused);
    else if (k === 'l' && !ui.locked) setLocked(true);
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
  const txRate = $derived(Object.values(networkStore.rates).reduce((a, r) => a + r.txPps, 0));
</script>

<svelte:window {onkeydown} />

<div class="app" style:--scope={scope.c} style:--scope-ink={scope.ink}>
  <!-- Whole-app states: full width, above everything, because they affect every desk. -->
  {#if ui.locked}
    <div class="banner locked" role="status">
      ■ LOCKED · all desks frozen · press and hold LOCK for 1 second to unlock
    </div>
  {/if}
  {#if networkStore.paused}
    <div class="banner paused" role="status">
      ▓▓ OUTPUT PAUSED · all desks · nothing leaves the app · held packets are logged ▓▓
    </div>
  {/if}

  <header class="top">
    <span class="brand" title="OscOctopus"><PixelLogo /></span>
    {#if ready}<ContainerTabs />{:else}<span class="tabs-placeholder"></span>{/if}
    <!-- Master section: affects ALL desks, so it sits outside every tab and frame. -->
    <div class="master" aria-label="All desks">
      <button
        class="net"
        class:bad={allFailing > 0}
        class:ok={allFailing === 0 && readyOutputs === outputs.length && outputs.length > 0}
        onclick={() => ((ui.view = 'system'), (ui.systemView = 'device'))}
        title="Outputs ready / enabled across all desks · messages per second"
      >
        <span class="led">●</span>{readyOutputs}/{outputs.length} OUT<span class="rate"
          >{txRate.toFixed(0)}/s</span
        >
      </button>
      <button
        class="pause"
        class:on={networkStore.paused}
        aria-pressed={networkStore.paused}
        title={networkStore.paused
          ? 'Output of all desks paused. Click to resume (Alt+P)'
          : 'Pause all outgoing OSC, on every desk (Alt+P)'}
        onclick={() => networkStore.setPaused(!networkStore.paused)}
      >
        {#if networkStore.paused}<span class="blink">■</span> PAUSED{:else}<Icon name="pause" /> PAUSE{/if}
      </button>
      <LockButton locked={ui.locked} onchange={setLocked} nudge={ui.lockNudge} />
    </div>
  </header>

  <section class="frame" aria-label={ui.view === 'desk' ? `Desk ${desk.name}` : 'Global settings'}>
    <div class="frame-head">
      <nav class="sections" aria-label="Sections">
        {#each ui.view === 'desk' ? deskSections : systemSections as s, i (s.id)}
          {@const on = (ui.view === 'desk' ? ui.deskView : ui.systemView) === s.id}
          <button
            class="section"
            class:on
            title="{s.hint} (F{i + 1})"
            onclick={() => {
              if (ui.view === 'desk') ui.deskView = s.id as DeskView;
              else ui.systemView = s.id as SystemView;
            }}
            ><span class="fkey">F{i + 1}</span><span class="section-label">{s.label}</span
            >{#if (s.id === 'io' && deskFailing > 0) || (s.id === 'device' && allFailing > 0)}<span
                class="badge">{s.id === 'io' ? deskFailing : allFailing}!</span
              >{/if}</button
          >
        {/each}
      </nav>
      <!-- The EDIT / LIVE switch lives on the desk itself, in its top-right cells (see Desk). -->
      {#if ui.view === 'desk' && ui.deskView === 'controls' && ui.mode === 'live'}
        <div class="tools">
          <button
            class="btn icon ghost"
            class:lit={ui.infoOpen}
            title={ui.infoOpen ? 'Hide widget info' : 'Show widget info (preview & activity)'}
            aria-pressed={ui.infoOpen}
            onclick={() => (ui.infoOpen = !ui.infoOpen)}><Icon name="panel" /></button
          >
        </div>
      {/if}
    </div>

    <main class:locked={ui.locked}>
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
        {:else if ui.deskView === 'io'}
          <Network />
        {:else if ui.deskView === 'monitor'}
          {#key desk.id}
            <Debug scope={desk.id} />
          {/key}
        {:else}
          <DeskPreset />
        {/if}
      {:else if ui.systemView === 'traffic'}
        <Debug />
      {:else if ui.systemView === 'device'}
        <GlobalNetwork />
      {:else if ui.systemView === 'library'}
        <Library />
      {:else}
        <Look />
      {/if}
    </main>
  </section>

  <ConfirmDialog />

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
  .net {
    height: 28px;
    padding: 0 1ch;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--fg-dim);
    white-space: nowrap;
  }
  .led {
    margin-right: 1ch;
    color: var(--warn);
  }
  .net.ok .led {
    color: var(--ok);
  }
  .net.bad .led {
    color: var(--danger);
    animation: blink 1s steps(1) infinite;
  }
  .rate {
    margin-left: 1ch;
    color: var(--fg-faint);
  }
  .pause {
    height: 28px;
    padding: 0 1ch;
    border: 1px solid var(--line-strong);
    background: var(--bg);
    color: var(--fg-dim);
    white-space: nowrap;
    transition:
      background var(--t-ui) steps(2),
      color var(--t-ui) steps(2);
  }
  .pause:hover {
    color: var(--fg);
  }
  .pause.on {
    border-color: var(--danger);
    background: var(--danger);
    color: var(--bg);
    font-weight: 700;
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
    .master {
      order: -1;
      margin-left: auto;
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
    overflow-x: auto;
    scrollbar-width: none;
  }
  /* The tab above already names the container, so the sections start at the edge. */
  .sections {
    display: flex;
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
  .tools {
    display: flex;
    align-items: center;
    gap: 1ch;
    margin-left: auto;
  }
  .tools .btn {
    height: 26px;
  }
  .lit {
    color: var(--accent-text);
    border-color: var(--accent);
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
