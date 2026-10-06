<script lang="ts">
  // One widget in an edit-mode panel's list (DeskPanel, SelectionPanel): its colour, type, label
  // and cell. A click selects it alone, to edit it in the Inspector; Shift adds it to the
  // selection or takes it out (presetStore.select).
  import type { Widget } from '../lib/model/preset';
  import { colorOf } from '../lib/model/tabs';
  import { presetStore } from '../lib/state/preset.svelte';
  import { colorVars } from '../lib/theme/palettes';
  import { DEFS, WIDGET_TYPES } from '../lib/widgets/defs';

  let { widget, level = 0 }: { widget: Widget; level?: number } = $props();

  /** The type column fits the longest type label. */
  const LABEL_WIDTH = Math.max(...WIDGET_TYPES.map((t) => DEFS[t].label.length));
</script>

<li>
  <!-- Selected, it shows on its tab (widgets/tabs/Tabs.svelte). -->
  <button
    class="row"
    style:--level={level}
    onclick={(e) => presetStore.select(widget.id, e.shiftKey)}
  >
    <span class="sw" style:background={colorVars(colorOf(presetStore.current, widget)).c}></span>
    <span class="type faint">{DEFS[widget.type].label.padEnd(LABEL_WIDTH)}</span>
    <span class="name">{widget.label}</span>
    <span class="faint">{widget.x},{widget.y} {widget.w}×{widget.h}</span>
  </button>
</li>

<style>
  .row {
    width: 100%;
    display: grid;
    grid-template-columns: 1ch auto 1fr auto;
    gap: 1ch;
    align-items: center;
    padding: 2px 0.5ch 2px calc(0.5ch + var(--level, 0) * 2ch);
    border: 0;
    background: none;
    text-align: left;
  }
  .row:hover {
    background: var(--fg);
    color: var(--bg);
  }
  .row:hover .faint {
    color: var(--bg);
  }
  .sw {
    width: 1ch;
    height: 12px;
  }
  .type {
    white-space: pre;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-transform: uppercase;
  }
</style>
