<script lang="ts">
  import Icon from '../lib/ui/Icon.svelte';
  import { networkStore } from '../lib/state/network.svelte';
  import { presetStore } from '../lib/state/preset.svelte';
  import { confirmAction, showGlobal } from '../lib/state/ui.svelte';
  import Lockable from '../lib/ui/Lockable.svelte';
  import InputCard from './network/InputCard.svelte';
  import OutputCard from './network/OutputCard.svelte';

  const network = $derived(presetStore.current.network);
  const change = () => presetStore.touch({ network: true });

  /** Asks first when messages send to (or listen on) the endpoint being deleted. */
  async function confirmRemove(kind: 'output' | 'input', id: string): Promise<boolean> {
    const sends = kind === 'output' ? presetStore.outputUsage(id) : 0;
    const listens = presetStore.sourceUsage(id);
    if (sends + listens === 0) return true;
    const uses = [
      sends ? `${sends} message(s) send to it` : '',
      listens ? `${listens} message(s) listen on it` : '',
    ].filter(Boolean);
    return confirmAction({
      title: `Delete ${kind}`,
      message: `${uses.join(' and ')}. Delete it and remove it from those messages?`,
      confirmLabel: `Delete ${kind}`,
      danger: true,
    });
  }

  async function removeOutput(id: string) {
    if (await confirmRemove('output', id)) presetStore.removeOutput(id);
  }

  async function removeInput(id: string) {
    if (await confirmRemove('input', id)) presetStore.removeInput(id);
  }

  const apply = $derived(networkStore.applyState(presetStore.current.id));
  const lastApplied = $derived(apply.at ? new Date(apply.at).toLocaleTimeString() : null);
</script>

<div class="network scroll">
  <Lockable>
    <div class="bar">
      <div class="apply">
        {#if apply.applying}
          <span class="pill warn">applying</span>
        {:else if apply.error}
          <span class="pill bad">apply failed</span>
          <span class="mono err">{apply.error}</span>
        {:else if lastApplied}
          <span class="pill ok">applied</span><span class="faint">at {lastApplied}</span>
        {/if}
      </div>
      <button
        class="btn"
        onclick={() => networkStore.apply(presetStore.current.id, presetStore.snapshot().network)}
        ><Icon name="refresh" /> Re-apply</button
      >
    </div>

    <div class="columns">
      <section>
        <div class="section-head">
          <h2>Outputs</h2>
          <button
            class="btn icon"
            title="Add output"
            aria-label="Add output"
            onclick={() => presetStore.addOutput()}><Icon name="plus" /></button
          >
        </div>
        {#each network.outputs as output, i (output.id)}
          <OutputCard
            bind:output={network.outputs[i]!}
            usedBy={presetStore.outputUsage(output.id)}
            onchange={change}
            onremove={() => removeOutput(output.id)}
          />
        {:else}
          <p class="faint">No outputs. Widgets have nowhere to send.</p>
        {/each}
      </section>

      <section>
        <div class="section-head">
          <h2>Inputs</h2>
          <button
            class="btn icon"
            title="Add input"
            aria-label="Add input"
            onclick={() => presetStore.addInput()}><Icon name="plus" /></button
          >
        </div>
        {#each network.inputs as input, i (input.id)}
          <InputCard
            bind:input={network.inputs[i]!}
            onchange={change}
            onremove={() => removeInput(input.id)}
          />
        {:else}
          <p class="faint">
            No inputs. Incoming OSC (and replies to outputs) still appears in TRAFFIC.
          </p>
        {/each}
      </section>
    </div>
  </Lockable>

  <p class="faint">
    Device interfaces and every desk's endpoints at a glance: <button
      class="link"
      onclick={() => showGlobal('network')}>GLOBAL SETTINGS › NETWORK</button
    >
  </p>
</div>

<style>
  .network {
    height: 100%;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .apply {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .err {
    color: var(--danger);
    overflow-wrap: anywhere;
  }
  .columns {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
    gap: 16px;
    align-items: start;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  p {
    margin: 0;
  }
</style>
