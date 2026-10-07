<script lang="ts">
  import Icon from '../../lib/ui/Icon.svelte';
  import type { InputConfig } from '../../lib/ipc/types';
  import { EDITOR_LIMITS } from '../../lib/model/preset';
  import { networkStore } from '../../lib/state/network.svelte';
  import { presetStore } from '../../lib/state/preset.svelte';
  import Field from '../../lib/ui/Field.svelte';
  import NumberInput from '../../lib/ui/NumberInput.svelte';
  import Segmented from '../../lib/ui/Segmented.svelte';
  import Toggle from '../../lib/ui/Toggle.svelte';
  import StatusLine from './StatusLine.svelte';

  interface Props {
    input: InputConfig;
    onchange: () => void;
    onremove: () => void;
  }
  let { input = $bindable(), onchange, onremove }: Props = $props();

  const bindListId = $derived(`in-binds-${input.id}`);
</script>

<div class="card endpoint" class:off={!input.enabled}>
  <div class="head">
    <Toggle bind:checked={input.enabled} label="Enabled" {onchange} />
    <input class="input name" bind:value={input.name} {onchange} aria-label="Input name" />
    <button class="btn icon ghost danger" data-tip="Delete" onclick={onremove}
      ><Icon name="trash" /></button
    >
  </div>

  <StatusLine
    status={networkStore.status(presetStore.current.id, input.id)}
    rates={networkStore.rate(presetStore.current.id, input.id)}
  />

  <div class="fields">
    <Field label="Transport" wide>
      <Segmented
        options={[
          { value: 'udp', label: 'UDP' },
          { value: 'tcp', label: 'TCP server' },
        ]}
        bind:value={input.transport}
        {onchange}
      />
    </Field>
    <Field
      label="Listen on"
      hint={input.bindAddress === '0.0.0.0'
        ? 'All IPv4 interfaces: reachable from the LAN'
        : input.bindAddress === '127.0.0.1'
          ? 'This machine only'
          : undefined}
    >
      <input class="input mono" list={bindListId} bind:value={input.bindAddress} {onchange} />
      <datalist id={bindListId}>
        <option value="0.0.0.0"></option>
        <option value="127.0.0.1"></option>
        {#each networkStore.interfaces as i (i.name + i.ip)}<option value={i.ip}>{i.name}</option
          >{/each}
      </datalist>
    </Field>
    <Field label="Port">
      <NumberInput bind:value={input.port} integer {...EDITOR_LIMITS.knownPort} {onchange} />
    </Field>
    {#if input.transport === 'udp'}
      <Field
        label="Join multicast group"
        wide
        hint="Leave empty for unicast/broadcast. Bind to 0.0.0.0 or the interface IP."
      >
        <input
          class="input mono"
          value={input.multicastGroup ?? ''}
          placeholder="e.g. 239.255.0.1"
          onchange={(e) => {
            const v = e.currentTarget.value.trim();
            input.multicastGroup = v === '' ? null : v;
            onchange();
          }}
        />
      </Field>
    {:else}
      <Field label="Framing" wide>
        <Segmented
          options={[
            { value: 'slip', label: 'SLIP (1.1)' },
            { value: 'lengthPrefix', label: 'Length prefix (1.0)' },
          ]}
          bind:value={input.framing}
          {onchange}
        />
      </Field>
    {/if}
  </div>
  <p class="id mono faint">id {input.id}</p>
</div>

<style>
  .endpoint {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    transition: opacity var(--t-ui) var(--ease-out);
  }
  .off {
    opacity: 0.65;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .name {
    font-weight: 600;
  }
  .fields {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .id {
    margin: 0;
  }
</style>
