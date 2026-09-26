<script lang="ts">
  // Pick one of the palette's ten colours (or AUTO = theme accent). The current palette is
  // read from CSS variables, so this always shows what the desk will actually look like.
  import { PALETTE_SIZE } from '../theme/palettes';

  interface Props {
    value: number | null;
    allowAuto?: boolean;
    onchange: (value: number | null) => void;
  }
  let { value, allowAuto = true, onchange }: Props = $props();
  const indices = Array.from({ length: PALETTE_SIZE }, (_, i) => i);
</script>

<div class="swatches" role="radiogroup">
  {#if allowAuto}
    <button
      type="button"
      role="radio"
      aria-checked={value === null}
      class="auto"
      class:on={value === null}
      onclick={() => onchange(null)}>AUTO</button
    >
  {/if}
  {#each indices as i (i)}
    <button
      type="button"
      role="radio"
      aria-checked={value === i}
      aria-label="Colour {i}"
      title="Colour {i}"
      class="sw"
      class:on={value === i}
      style:--sw="var(--p{i})"
      onclick={() => onchange(i)}
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
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    background: var(--sw);
    box-shadow: 2px 2px 0 0 var(--shadow-px);
    transition:
      translate var(--t-release) var(--ease-spring),
      box-shadow var(--t-release) var(--ease-spring);
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
  .auto {
    height: 22px;
    padding: 0 1ch;
    border: 1px solid var(--line-strong);
    background: var(--bg);
    color: var(--fg-dim);
  }
  .auto.on {
    background: var(--fg);
    color: var(--bg);
    font-weight: 700;
  }
</style>
