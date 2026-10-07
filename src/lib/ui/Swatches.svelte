<script lang="ts" module>
  /** A choice before the palette's colours, e.g. AUTO (a widget takes its desk's colour). */
  export interface SwatchExtra<E> {
    value: E;
    label: string;
    title: string;
    /** The colour it stands for, shown beside the label. */
    color?: string;
  }
</script>

<script lang="ts" generics="V extends number | string | null">
  // Pick one of the palette's ten colours (its nine, then its accent, set apart), or one of the
  // `extras` before them. The palette is read from CSS variables, so this always shows the
  // colours of the look it sits in (a desk's own palette inside the desk).
  import { ACCENT_INDEX, PALETTE_SIZE } from '../theme/palettes';

  interface Props {
    /** A palette index, or one of the extras' values. */
    value: V;
    extras?: readonly SwatchExtra<Exclude<V, number>>[];
    onchange: (value: V) => void;
  }
  let { value, extras = [], onchange }: Props = $props();
  const indices = Array.from({ length: PALETTE_SIZE }, (_, i) => i);
  const nameOf = (i: number) => (i === ACCENT_INDEX ? 'Accent' : `Colour ${i}`);
</script>

<div class="swatches" role="radiogroup">
  {#each extras as x (x.value)}
    <button
      type="button"
      role="radio"
      aria-checked={value === x.value}
      class="extra"
      class:on={value === x.value}
      data-tip={x.title}
      onclick={() => onchange(x.value)}
      >{#if x.color}<span class="extra-sw" style:background={x.color}></span>{/if}{x.label}</button
    >
  {/each}
  {#each indices as i (i)}
    <button
      type="button"
      role="radio"
      aria-checked={value === i}
      aria-label={nameOf(i)}
      data-tip={nameOf(i)}
      class="sw"
      class:accent={i === ACCENT_INDEX}
      class:on={value === i}
      style:--sw="var(--p{i})"
      onclick={() => onchange(i as V)}
    ></button>
  {/each}
</div>

<style>
  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .sw {
    width: var(--control-h-sm);
    height: var(--control-h-sm);
    padding: 0;
    border: 0;
    background: var(--sw);
    box-shadow: 2px 2px 0 0 var(--shadow-px);
    transition:
      translate var(--t-release) var(--ease-spring),
      box-shadow var(--t-release) var(--ease-spring);
  }
  .sw.accent {
    margin-left: 6px;
  }
  .sw:hover {
    translate: -1px -1px;
    box-shadow: 3px 3px 0 0 var(--shadow-px);
  }
  /* Selected: sunk in, with a frame around it. */
  .sw.on {
    translate: 2px 2px;
    box-shadow:
      0 0 0 1px var(--bg),
      0 0 0 2px var(--fg);
  }
  .extra {
    display: inline-flex;
    align-items: center;
    gap: 0.75ch;
    height: var(--control-h-sm);
    padding: 0 1ch;
    border: 1px solid var(--line-strong);
    background: var(--bg);
    color: var(--fg-dim);
    text-transform: uppercase;
  }
  .extra.on {
    background: var(--fg);
    color: var(--bg);
    font-weight: 700;
  }
  .extra-sw {
    width: 10px;
    height: 10px;
    box-shadow: 0 0 0 1px var(--bg);
  }
</style>
