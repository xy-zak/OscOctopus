<script lang="ts">
  // The exact messages a widget sends at its current value, and where they go.
  import type { Widget } from '../../lib/model/preset';
  import { formatArg, formatValue, typetags } from '../../lib/osc/format';
  import { buildMessages } from '../../lib/osc/mapping';
  import { networkStore } from '../../lib/state/network.svelte';
  import { presetStore } from '../../lib/state/preset.svelte';
  import { values } from '../../lib/state/values.svelte';
  import { initialValue } from '../../lib/widgets/defs';

  let { widget }: { widget: Widget } = $props();

  const value = $derived(values[widget.id] ?? initialValue(widget));
  const messages = $derived(buildMessages(widget, value));
  // The widget's own desk: its messages go to that desk's outputs.
  const desk = $derived(presetStore.findWidget(widget.id)?.desk ?? presetStore.current);
  const deskId = $derived(desk.id);
  const outputs = $derived(desk.network.outputs);
  const outputName = (id: string) =>
    outputs.find((o) => o.id === id)?.name ?? `missing output ${id}`;
</script>

<section>
  <h2>Preview <span class="faint">at {formatValue(value)}</span></h2>
  {#each messages as m (m.bindingId)}
    <div class="msg mono">
      <div class="line">
        <span class="addr">{m.message.address}</span>
        <span class="tags">{typetags(m.message.args)}</span>
        <span>{m.message.args.map(formatArg).join(' ')}</span>
      </div>
      <div class="targets">
        {#each m.outputIds as id (id)}
          {@const st = networkStore.status(deskId, id)}
          <span
            class="target"
            class:bad={!st || st.state !== 'ready'}
            class:held={networkStore.paused}
          >
            → {outputName(id)}{st?.remote ? ` (${st.remote})` : ''}{st && st.state !== 'ready'
              ? ` · ${st.state}`
              : ''}{networkStore.paused ? ' · OSC-OUT off: not sent' : ''}
          </span>
        {/each}
      </div>
    </div>
  {:else}
    <p class="faint">Nothing will be sent: no message sends to an output.</p>
  {/each}
</section>

<style>
  section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .msg {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 10px;
    background: var(--bg);
  }
  .line {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
  }
  .addr {
    color: var(--accent-text);
    overflow-wrap: anywhere;
  }
  .tags {
    color: var(--info);
  }
  .targets {
    display: flex;
    flex-direction: column;
    color: var(--fg-dim);
  }
  .target.bad {
    color: var(--warn);
  }
  .target.held {
    color: var(--danger);
  }
  p {
    margin: 0;
  }
</style>
