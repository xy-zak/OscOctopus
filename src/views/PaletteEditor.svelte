<script lang="ts">
  // GLOBAL SETTINGS › LOOK: make or edit a custom palette. Pick a source colour and ten colours
  // are generated from it (theme/generate.ts); any of them can then be picked by hand, and
  // stays that way when the source changes, until reset. Nothing changes until SAVE; a new
  // palette then becomes every desk's (lookActions.savePalette).
  import { untrack } from 'svelte';
  import { LIMITS, type CustomPalette } from '../lib/model/preset';
  import { uid } from '../lib/model/parts';
  import { appearance } from '../lib/state/appearance.svelte';
  import { lookStore } from '../lib/state/look.svelte';
  import { generatePalette, normalizeHex, regenerate } from '../lib/theme/generate';
  import { DEFAULT_ACCENT, inkFor, PALETTE_SIZE } from '../lib/theme/palettes';
  import Field from '../lib/ui/Field.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import Panel from '../lib/ui/Panel.svelte';
  import { deletePalette, PALETTES_FULL, savePalette } from './lookActions';

  interface Props {
    /** The palette to edit, or null for a new one. */
    palette: CustomPalette | null;
    onclose: () => void;
  }
  let { palette, onclose }: Props = $props();

  /** A new palette starts from the colour the accent has now, in every desk's palette. */
  function fresh(): CustomPalette {
    const taken = new Set(appearance.theme.custom.map((p) => p.name));
    let n = 1;
    while (taken.has(`CUSTOM ${n}`)) n++;
    const source =
      normalizeHex(lookStore.global.palette.colors[appearance.theme.accent] ?? '') ?? '#3cb4ff';
    return {
      id: uid('custom'),
      name: `CUSTOM ${n}`,
      source,
      colors: generatePalette(source),
      overridden: Array<boolean>(PALETTE_SIZE).fill(false),
    };
  }

  // The editor is keyed by the palette it opened (Look.svelte), so reading the prop once is right.
  const start = untrack(() => (palette ? $state.snapshot(palette) : fresh()));
  const isNew = untrack(() => palette === null);
  let name = $state(start.name);
  let source = $state(start.source);
  let hexText = $state(start.source);
  let colors = $state([...start.colors]);
  let overridden = $state([...start.overridden]);

  const trimmed = $derived(name.trim().toUpperCase());
  const nameOk = $derived(
    trimmed.length >= LIMITS.paletteName.min && trimmed.length <= LIMITS.paletteName.max,
  );
  const hexOk = $derived(normalizeHex(hexText) !== null);
  const manual = $derived(overridden.filter(Boolean).length);
  // Where the generator put the source (colour 5 unless it is nearly white or black).
  const sourceAt = $derived(generatePalette(source).indexOf(source));
  const full = $derived(isNew && appearance.customFull);

  function setSource(hex: string) {
    source = hex;
    hexText = hex;
    colors = regenerate(hex, colors, overridden);
  }

  function onHex(text: string) {
    hexText = text;
    const hex = normalizeHex(text);
    if (hex) setSource(hex);
  }

  function override(i: number, hex: string) {
    colors[i] = hex;
    overridden[i] = true;
  }

  function reset(i: number) {
    overridden[i] = false;
    colors[i] = generatePalette(source)[i]!;
  }

  function resetAll() {
    overridden = overridden.map(() => false);
    colors = generatePalette(source);
  }

  async function save() {
    if (!nameOk) return;
    const palette = {
      id: start.id,
      name: trimmed,
      source,
      colors: [...colors],
      overridden: [...overridden],
    };
    if (await savePalette(palette)) onclose();
  }

  async function remove() {
    if (await deletePalette(start.id, start.name)) onclose();
  }

  let root = $state<HTMLElement>();
  $effect(() => {
    root?.scrollIntoView({ block: 'nearest' });
  });
</script>

<div bind:this={root}>
  <Panel title={isNew ? 'New palette' : `Edit palette · ${start.name}`} active>
    <div class="top">
      <Field label="Name" hint="Up to {LIMITS.paletteName.max} characters">
        <input
          class="input name"
          class:invalid={!nameOk}
          maxlength={LIMITS.paletteName.max}
          bind:value={name}
        />
      </Field>
      <Field label="Source colour" hint="The ten colours are made from this one">
        <span class="source">
          <span class="pick" style:--c={source}>
            <input
              type="color"
              aria-label="Source colour"
              value={source}
              oninput={(e) => setSource(e.currentTarget.value)}
            />
          </span>
          <input
            class="input hex"
            class:invalid={!hexOk}
            aria-label="Source colour as hex"
            spellcheck="false"
            value={hexText}
            oninput={(e) => onHex(e.currentTarget.value)}
            onblur={() => (hexText = source)}
          />
        </span>
      </Field>
    </div>

    <div class="colours">
      {#each colors as c, i (i)}
        <div class="slot">
          <span class="pick big" class:manual={overridden[i]} style:--c={c} style:--ink={inkFor(c)}>
            <input
              type="color"
              aria-label="Palette colour {i}{overridden[i] ? ' (picked by hand)' : ''}"
              title={overridden[i]
                ? `Colour ${i}: picked by hand`
                : `Colour ${i}: click to pick your own`}
              value={c}
              oninput={(e) => override(i, e.currentTarget.value)}
            />
            <span class="n" aria-hidden="true">{i}</span>
          </span>
          {#if overridden[i]}
            <button
              type="button"
              class="btn ghost reset"
              title="Colour {i}: back to the generated colour"
              onclick={() => reset(i)}><Icon name="refresh" /></button
            >
          {:else}
            <span class="tag faint">{i === sourceAt ? 'SRC' : ''}</span>
          {/if}
        </div>
      {/each}
    </div>
    <p class="faint">
      Lightest to darkest, drifting towards yellow in the lights and violet in the darks. SRC is the
      source itself{sourceAt === DEFAULT_ACCENT ? ' (colour 5, the default accent)' : ''}. Click any
      colour to pick your own; <Icon name="refresh" /> puts it back.
    </p>

    <div class="actions">
      <button class="btn primary" disabled={!nameOk || full} onclick={save}
        ><Icon name="save" /> {isNew ? 'Save & use' : 'Save'}</button
      >
      <button class="btn" onclick={onclose}>Cancel</button>
      {#if manual > 0}
        <button class="btn ghost" onclick={resetAll}
          ><Icon name="refresh" /> Reset {manual} picked</button
        >
      {/if}
      {#if !isNew}
        <button class="btn danger delete" onclick={remove}><Icon name="trash" /> Delete</button>
      {/if}
    </div>
    {#if full}
      <p class="warn">{PALETTES_FULL}</p>
    {/if}
  </Panel>
</div>

<style>
  .top {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(24ch, 1fr));
    gap: 10px 2ch;
  }
  .name {
    text-transform: uppercase;
  }
  .source {
    display: flex;
    gap: 1ch;
  }
  .hex {
    width: 11ch;
    text-transform: lowercase;
  }
  /* A colour swatch with the native colour picker laid invisibly over it, so a click (or
     Enter/Space when focused) opens the system's RGB picker. */
  .pick {
    position: relative;
    flex: none;
    width: var(--control-h);
    height: var(--control-h);
    background: var(--c);
    box-shadow: 2px 2px 0 0 var(--shadow-px);
  }
  .pick:hover {
    translate: -1px -1px;
    box-shadow: 3px 3px 0 0 var(--shadow-px);
  }
  .pick:has(:focus-visible) {
    outline: 1px solid var(--fg);
    outline-offset: 2px;
  }
  .pick input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    padding: 0;
    border: 0;
    opacity: 0;
    cursor: pointer;
  }
  .colours {
    display: grid;
    grid-template-columns: repeat(10, minmax(0, 1fr));
    gap: 6px;
    max-width: 64ch;
  }
  .slot {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 4px;
  }
  .pick.big {
    width: auto;
    height: 40px;
  }
  .n {
    position: absolute;
    left: 4px;
    bottom: 2px;
    color: var(--ink);
    font-weight: 700;
    pointer-events: none;
  }
  /* Picked by hand: a corner notch in the colour's ink. */
  .pick.manual::after {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    border: 5px solid transparent;
    border-top-color: var(--ink);
    border-right-color: var(--ink);
    pointer-events: none;
  }
  .reset {
    height: 22px;
    padding: 0;
  }
  .tag {
    height: 22px;
    line-height: 22px;
    text-align: center;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 1ch;
  }
  .delete {
    margin-left: auto;
  }
  p {
    margin: 0;
  }
  .warn {
    color: var(--warn);
  }
</style>
