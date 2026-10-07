<script lang="ts">
  // GLOBAL SETTINGS › LOOK: make or edit a custom palette: nine colours and an accent, like
  // every palette. Pick a source colour and the nine are generated from it, with an accent that
  // stands apart from them (theme/generate.ts); any of the ten can then be picked by hand, and
  // stays that way when the source changes, until reset. Nothing changes until SAVE; a new
  // palette then becomes every desk's (lookActions.savePalette).
  import { untrack } from 'svelte';
  import { LIMITS, type CustomPalette } from '../lib/model/preset';
  import { uid } from '../lib/model/parts';
  import { appearance } from '../lib/state/appearance.svelte';
  import { lookStore } from '../lib/state/look.svelte';
  import { generatePalette, normalizeHex, regenerate, SOURCE_INDEX } from '../lib/theme/generate';
  import { ACCENT_INDEX, inkFor, PALETTE_SIZE } from '../lib/theme/palettes';
  import ColorField from '../lib/ui/ColorField.svelte';
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

  /** A new palette starts from the middle colour of every desk's palette. */
  function fresh(): CustomPalette {
    const taken = new Set(appearance.theme.custom.map((p) => p.name));
    let n = 1;
    while (taken.has(`CUSTOM ${n}`)) n++;
    const source = normalizeHex(lookStore.global.palette.colors[SOURCE_INDEX] ?? '') ?? '#3cb4ff';
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
  let colors = $state([...start.colors]);
  let overridden = $state([...start.overridden]);

  const trimmed = $derived(name.trim().toUpperCase());
  const nameOk = $derived(
    trimmed.length >= LIMITS.paletteName.min && trimmed.length <= LIMITS.paletteName.max,
  );
  const manual = $derived(overridden.filter(Boolean).length);
  // Where the generator put the source (colour 4 unless it is nearly white or black).
  const sourceAt = $derived(generatePalette(source).indexOf(source));
  /** How a colour is named: by its number, or the accent. */
  const nameOf = (i: number) => (i === ACCENT_INDEX ? 'Accent' : `Colour ${i}`);
  const full = $derived(isNew && appearance.customFull);

  function setSource(hex: string) {
    source = hex;
    colors = regenerate(hex, colors, overridden);
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
  <Panel
    title={isNew ? 'New palette' : `Edit palette · ${start.name}`}
    hint="Colours 0–8 run lightest to darkest, drifting towards yellow in the lights and violet in the darks; SRC is the source itself. A is the accent: it marks highlights and selection wherever the palette is worn, and widgets can use it as a tenth colour. It is made from the source's opposite hue, to stand apart. Click any colour to pick your own; ↻ puts it back."
    active
  >
    <div class="top">
      <Field label="Name" hint="Up to {LIMITS.paletteName.max} characters">
        <input
          class="input name"
          class:invalid={!nameOk}
          maxlength={LIMITS.paletteName.max}
          bind:value={name}
        />
      </Field>
      <Field label="Source colour" hint="The nine colours and the accent are made from this one">
        <ColorField value={source} label="Source colour" onchange={setSource} />
      </Field>
    </div>

    <div class="colours">
      {#each colors as c, i (i)}
        {@const accent = i === ACCENT_INDEX}
        <div class="slot" class:accent>
          <span
            class="color-well big"
            class:manual={overridden[i]}
            style:--c={c}
            style:--ink={inkFor(c)}
          >
            <input
              type="color"
              aria-label="{nameOf(i)}{overridden[i] ? ' (picked by hand)' : ''}"
              data-tip={overridden[i]
                ? `${nameOf(i)}: picked by hand`
                : `${nameOf(i)}: click to pick your own`}
              value={c}
              oninput={(e) => override(i, e.currentTarget.value)}
            />
            <span class="n" aria-hidden="true">{accent ? 'A' : i}</span>
          </span>
          {#if overridden[i]}
            <button
              type="button"
              class="btn sm icon ghost"
              data-tip="{nameOf(i)}: back to the generated colour"
              onclick={() => reset(i)}><Icon name="refresh" /></button
            >
          {:else}
            <span class="tag faint">{i === sourceAt ? 'SRC' : accent ? 'ACC' : ''}</span>
          {/if}
        </div>
      {/each}
    </div>

    <!-- Danger on the far left; Cancel, then the primary action, on the right. -->
    <div class="actions">
      {#if !isNew}
        <button class="btn danger" onclick={remove}><Icon name="trash" /> Delete</button>
      {/if}
      {#if manual > 0}
        <button class="btn ghost" onclick={resetAll}
          ><Icon name="refresh" /> Reset {manual} picked</button
        >
      {/if}
      <span class="push"></span>
      <button class="btn" onclick={onclose}>Cancel</button>
      <button class="btn primary" disabled={!nameOk || full} onclick={save}
        ><Icon name="save" /> {isNew ? 'Save & use' : 'Save'}</button
      >
    </div>
    {#if full}
      <p class="warn-text">{PALETTES_FULL}</p>
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
  /* The nine, then the accent set apart. */
  .colours {
    display: grid;
    grid-template-columns: repeat(9, minmax(0, 1fr)) 4px minmax(0, 1fr);
    gap: 6px;
    max-width: 66ch;
  }
  .slot.accent {
    grid-column: -2;
  }
  .slot {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 4px;
  }
  .color-well.big {
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
  .color-well.manual::after {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    border: 5px solid transparent;
    border-top-color: var(--ink);
    border-right-color: var(--ink);
    pointer-events: none;
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
  .push {
    flex: 1;
  }
  p {
    margin: 0;
  }
</style>
