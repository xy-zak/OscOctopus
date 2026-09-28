<script lang="ts">
  // A block of text (markup.ts), laid out by the widget's alignment. Its `{placeholders}` show
  // the value this widget received (`osc`), another widget's live value (`monitor`), or stay
  // as written (`text`). Runs are rendered as text, never as HTML, and filled after parsing, so
  // no received or synced text can add marks. Size, weight and reverse video come from
  // skins/base.css: the same in every skin.
  import type { TextWidget } from '../../model/preset';
  import { displayValue } from '../../osc/format';
  import type { WidgetValue } from '../../osc/value';
  import { flag } from '../../skins/anatomy';
  import { presetStore } from '../../state/preset.svelte';
  import { values } from '../../state/values.svelte';
  import { initialValue } from '../defs';
  import WidgetFrame from '../WidgetFrame.svelte';
  import { placeholderValue } from './def';
  import { fill, parseMarkup } from './markup';

  let { widget, live }: { widget: TextWidget; live: boolean } = $props();

  const p = $derived(widget.props);
  const blocks = $derived(parseMarkup(p.source));
  /** The widget a monitor shows: one on this widget's own desk. */
  const target = $derived.by(() => {
    if (p.mode !== 'monitor' || p.target === null) return undefined;
    return presetStore.findWidget(widget.id)?.desk.widgets.find((w) => w.id === p.target);
  });
  const value = $derived.by((): WidgetValue | undefined => {
    if (p.mode === 'osc') return values[widget.id] ?? initialValue(widget);
    if (target) return values[target.id] ?? initialValue(target);
    return undefined;
  });
  const shown = $derived(
    value === undefined
      ? blocks
      : fill(blocks, (name) => {
          const v = placeholderValue(value, name);
          return v === undefined ? undefined : displayValue(v, p.decimals);
        }),
  );
</script>

<WidgetFrame
  type="text"
  {live}
  title={widget.label}
  color={widget.color}
  role="region"
  aria-label={widget.label || 'Text'}
>
  {#snippet children()}
    <div
      class="body"
      data-part="text.body"
      data-size={p.size}
      data-align={p.align}
      data-valign={p.valign}
    >
      {#each shown as b, i (i)}
        <div class="block" data-part="text.block" data-kind={b.kind}>
          {#if b.kind === 'item'}<span class="bullet">•</span>{/if}{#each b.runs as r, j (j)}<span
              class="run"
              data-part="text.run"
              data-strong={flag(r.strong)}
              data-reverse={flag(r.reverse)}
              data-tinted={flag(r.tone !== null)}
              style:--tone={r.tone === null ? undefined : `var(--p${r.tone})`}
              style:--tone-ink={r.tone === null ? undefined : `var(--p${r.tone}-ink)`}
              >{r.text}</span
            >{/each}
        </div>
      {/each}
    </div>
  {/snippet}
</WidgetFrame>

<style>
  .body {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .body[data-valign='middle'] {
    justify-content: center;
  }
  .body[data-valign='bottom'] {
    justify-content: flex-end;
  }
  .body[data-align='center'] {
    text-align: center;
  }
  .body[data-align='right'] {
    text-align: right;
  }
  /* A gap line keeps its height. */
  .block {
    min-height: 1lh;
  }
  /* Spaces as typed (only in the text: the template's own whitespace never shows). */
  .run {
    white-space: pre-wrap;
  }
  .bullet {
    margin-right: 1ch;
  }
</style>
