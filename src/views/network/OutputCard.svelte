<script lang="ts">
  import Icon from '../../lib/ui/Icon.svelte';
  import type { OutputConfig } from '../../lib/ipc/types';
  import { EDITOR_LIMITS, LIMITS } from '../../lib/model/preset';
  import { networkStore } from '../../lib/state/network.svelte';
  import { presetStore } from '../../lib/state/preset.svelte';
  import Field from '../../lib/ui/Field.svelte';
  import NumberInput from '../../lib/ui/NumberInput.svelte';
  import Segmented from '../../lib/ui/Segmented.svelte';
  import Toggle from '../../lib/ui/Toggle.svelte';
  import StatusLine from './StatusLine.svelte';

  interface Props {
    output: OutputConfig;
    usedBy: number;
    onchange: () => void;
    onremove: () => void;
  }
  let { output = $bindable(), usedBy, onchange, onremove }: Props = $props();

  const listId = $derived(`hosts-${output.id}`);
  const bindListId = $derived(`binds-${output.id}`);
  const v4 = $derived(networkStore.interfaces.filter((i) => !i.isIpv6));
  const broadcasts = $derived([
    '255.255.255.255',
    ...new Set(v4.map((i) => i.broadcast).filter((b): b is string => !!b)),
  ]);

  /** An input of this app (any desk) this output sends into, e.g. the first-run loopback. */
  const ownInput = $derived.by(() => {
    const host = output.host.trim().toLowerCase();
    const local =
      host === 'localhost' ||
      host === '::1' ||
      host.startsWith('127.') ||
      networkStore.interfaces.some((i) => i.ip === host);
    if (!local) return null;
    for (const desk of presetStore.desks) {
      const input = desk.network.inputs.find(
        (i) =>
          i.enabled &&
          i.transport === output.transport &&
          i.port === output.port &&
          (i.bindAddress === '0.0.0.0' || i.bindAddress === host || host === 'localhost'),
      );
      if (input)
        return desk.id === presetStore.current.id ? input.name : `${desk.name} › ${input.name}`;
    }
    return null;
  });

  // Point out likely mistakes instead of silently "fixing" them.
  const warning = $derived.by(() => {
    const h = output.host.trim();
    if (output.transport !== 'udp') return null;
    const first = Number(h.split('.')[0]);
    const looksMulticast = first >= 224 && first <= 239;
    const looksBroadcast = h === '255.255.255.255' || broadcasts.includes(h);
    if (output.mode === 'unicast' && looksBroadcast)
      return 'This looks like a broadcast address. Sending will fail with "permission denied" unless Mode is Broadcast (SO_BROADCAST).';
    if (output.mode === 'unicast' && looksMulticast)
      return 'This looks like a multicast group. Switch Mode to Multicast to control TTL and loopback.';
    if (output.mode === 'multicast' && !looksMulticast && !h.includes(':'))
      return 'Multicast mode needs a group address in 224.0.0.0 – 239.255.255.255.';
    return null;
  });
</script>

<div class="card endpoint" class:off={!output.enabled}>
  <div class="head">
    <label class="on"
      ><Toggle bind:checked={output.enabled} label="Enabled" {onchange} /><span class="field-label"
        >On</span
      ></label
    >
    <input class="input name" bind:value={output.name} {onchange} aria-label="Output name" />
    <button
      class="btn icon ghost danger"
      data-tip={usedBy
        ? `Delete output (used by ${usedBy} message${usedBy > 1 ? 's' : ''})`
        : 'Delete output'}
      aria-label="Delete output"
      onclick={onremove}><Icon name="trash" /></button
    >
  </div>

  <StatusLine
    status={networkStore.status(presetStore.current.id, output.id)}
    rates={networkStore.rate(presetStore.current.id, output.id)}
  />

  <div class="fields">
    <Field label="Transport" wide>
      <Segmented
        options={[
          { value: 'udp', label: 'UDP' },
          { value: 'tcp', label: 'TCP' },
        ]}
        bind:value={output.transport}
        {onchange}
      />
    </Field>
    {#if output.transport === 'udp'}
      <Field label="Mode" wide>
        <Segmented
          options={[
            { value: 'unicast', label: 'Unicast' },
            { value: 'broadcast', label: 'Broadcast' },
            { value: 'multicast', label: 'Multicast' },
          ]}
          bind:value={output.mode}
          {onchange}
        />
      </Field>
    {:else}
      <Field
        label="Framing"
        wide
        hint={output.framing === 'slip'
          ? 'OSC 1.1: SLIP double-END framing'
          : 'OSC 1.0: int32 size prefix'}
      >
        <Segmented
          options={[
            { value: 'slip', label: 'SLIP (1.1)' },
            { value: 'lengthPrefix', label: 'Length prefix (1.0)' },
          ]}
          bind:value={output.framing}
          {onchange}
        />
      </Field>
    {/if}
    <Field
      label={output.mode === 'broadcast' && output.transport === 'udp'
        ? 'Broadcast address'
        : 'Host'}
    >
      <input
        class="input mono"
        list={listId}
        bind:value={output.host}
        {onchange}
        placeholder="192.168.1.50 or mixer.local"
      />
      <datalist id={listId}>
        {#if output.mode === 'broadcast'}
          {#each broadcasts as b (b)}<option value={b}></option>{/each}
        {:else}
          <option value="127.0.0.1"></option>
        {/if}
      </datalist>
    </Field>
    <Field label="Port">
      <NumberInput bind:value={output.port} integer {...EDITOR_LIMITS.knownPort} {onchange} />
    </Field>
    <Field label="Send from (bind)" hint="0.0.0.0 = OS picks interface">
      <input class="input mono" list={bindListId} bind:value={output.bindAddress} {onchange} />
      <datalist id={bindListId}>
        <option value="0.0.0.0"></option>
        {#each networkStore.interfaces as i (i.name + i.ip)}<option value={i.ip}>{i.name}</option
          >{/each}
      </datalist>
    </Field>
    <Field label="Source port" hint="0 = ephemeral">
      <NumberInput bind:value={output.localPort} integer {...LIMITS.port} {onchange} />
    </Field>
    {#if output.transport === 'udp' && output.mode === 'multicast'}
      <Field label="TTL / hops">
        <NumberInput bind:value={output.multicastTtl} integer {...LIMITS.multicastTtl} {onchange} />
      </Field>
      <Field label="Loopback" hint="Receive own packets on this host">
        <Toggle bind:checked={output.multicastLoop} label="Multicast loopback" {onchange} />
      </Field>
    {/if}
    {#if output.transport === 'tcp'}
      <Field label="Reconnect (ms)">
        <NumberInput
          bind:value={output.reconnectMs}
          integer
          {...EDITOR_LIMITS.reconnectMs}
          {onchange}
        />
      </Field>
    {/if}
  </div>
  {#if warning}<p class="warn-text">{warning}</p>{/if}
  {#if ownInput}
    <p class="faint">
      Sends into this app's own input “{ownInput}”. Those packets show in TRAFFIC but never drive
      widgets, so this can't loop.
    </p>
  {/if}
  <p class="id mono faint">id {output.id}</p>
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
  .on {
    display: flex;
    align-items: center;
    gap: 0.5ch;
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
