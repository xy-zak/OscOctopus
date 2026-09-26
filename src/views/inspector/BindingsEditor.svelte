<script lang="ts">
  // The Inspector's MESSAGES section: each binding is an address (with `{channel}`
  // placeholders), the outputs it goes to, and its argument templates (see osc/mapping.ts).
  import type { ArgTemplate, ConstArgType, ValueArgType, Widget } from '../../lib/model/preset';
  import { newBinding, valueArg } from '../../lib/model/parts';
  import { addressError } from '../../lib/osc/mapping';
  import { networkStore } from '../../lib/state/network.svelte';
  import { presetStore } from '../../lib/state/preset.svelte';
  import Icon from '../../lib/ui/Icon.svelte';
  import Segmented from '../../lib/ui/Segmented.svelte';
  import Toggle from '../../lib/ui/Toggle.svelte';
  import { channelsFor } from '../../lib/widgets/defs';

  let { widget = $bindable(), onchange }: { widget: Widget; onchange: () => void } = $props();

  const outputs = $derived(presetStore.current.network.outputs);
  /** Named channels of this widget's value (empty = a single value). */
  const channels = $derived(channelsFor(widget));
  /** New value arguments pick the widget's first channel, if it has any. */
  const newValueArg = () => valueArg('f', channels[0]?.id);

  const VALUE_TYPES: { value: ValueArgType; label: string }[] = [
    { value: 'f', label: 'f float32' },
    { value: 'i', label: 'i int32' },
    { value: 'd', label: 'd float64' },
    { value: 'h', label: 'h int64' },
    { value: 'TF', label: 'T/F bool' },
    { value: 's', label: 's string' },
    { value: 'auto', label: 'auto (from value)' },
    { value: '[]', label: '[] OSC array' },
    { value: '...', label: '… spread list' },
    { value: 'm', label: 'm MIDI (note)' },
  ];
  const CONST_TYPES: { value: ConstArgType; label: string }[] = [
    { value: 'f', label: 'f float32' },
    { value: 'i', label: 'i int32' },
    { value: 'd', label: 'd float64' },
    { value: 'h', label: 'h int64' },
    { value: 's', label: 's string' },
    { value: 'T', label: 'T true' },
    { value: 'F', label: 'F false' },
    { value: 'N', label: 'N nil' },
    { value: 'I', label: 'I impulse' },
  ];
  /** Constant types that carry no value. */
  const VALUELESS: readonly ConstArgType[] = ['T', 'F', 'N', 'I'];
  /** MIDI only makes sense for values that carry a note; hide it otherwise. */
  const valueTypes = $derived(
    channels.some((c) => c.id === 'note')
      ? VALUE_TYPES
      : VALUE_TYPES.filter((t) => t.value !== 'm'),
  );

  function addBinding() {
    widget.bindings.push(newBinding('/octopus/new', outputs[0] ? [outputs[0].id] : []));
    onchange();
  }

  function removeBinding(id: string) {
    widget.bindings = widget.bindings.filter((b) => b.id !== id);
    onchange();
  }

  function setArgKind(args: ArgTemplate[], i: number, kind: ArgTemplate['kind']) {
    args[i] = kind === 'value' ? newValueArg() : { kind: 'const', type: 'i', value: '0' };
    onchange();
  }

  function toggleOutput(outputIds: string[], id: string) {
    const i = outputIds.indexOf(id);
    if (i >= 0) outputIds.splice(i, 1);
    else outputIds.push(id);
    onchange();
  }
</script>

<section>
  <div class="section-head">
    <h2>Messages</h2>
    <button class="btn" onclick={addBinding}><Icon name="plus" /> Add</button>
  </div>
  {#each widget.bindings as b (b.id)}
    {@const addrErr = addressError(b.address)}
    <div class="binding card">
      <div class="row">
        <Toggle bind:checked={b.enabled} label="Binding enabled" {onchange} />
        <input
          class="input mono"
          class:invalid={addrErr}
          bind:value={b.address}
          oninput={onchange}
          placeholder="/address"
          title={addrErr ?? ''}
        />
        <button class="btn icon ghost" title="Remove message" onclick={() => removeBinding(b.id)}
          ><Icon name="close" /></button
        >
      </div>
      {#if addrErr}<span class="err">{addrErr}</span>{/if}
      {#if channels.length}
        <span class="faint hint">placeholders: {channels.map((c) => `{${c.id}}`).join(' ')}</span>
      {/if}

      <div class="chips">
        {#each outputs as o (o.id)}
          {@const st = networkStore.status(presetStore.current.id, o.id)?.state ?? 'disabled'}
          <button
            class="chip"
            class:on={b.outputIds.includes(o.id)}
            onclick={() => toggleOutput(b.outputIds, o.id)}
          >
            <span class="dot {st}"></span>{o.name}
          </button>
        {/each}
        {#each b.outputIds.filter((id) => !outputs.some((o) => o.id === id)) as missing (missing)}
          <button
            class="chip on missing"
            title="This output no longer exists; click to remove"
            onclick={() => toggleOutput(b.outputIds, missing)}>missing: {missing}</button
          >
        {/each}
        {#if outputs.length === 0}<span class="faint">No outputs: add one in NETWORK.</span>{/if}
      </div>

      {#each b.args as a, i (i)}
        <div
          class="arg"
          class:with-channel={a.kind === 'value' && channels.length && a.type !== 'm'}
        >
          <Segmented
            size="sm"
            options={[
              { value: 'value', label: 'Value' },
              { value: 'const', label: 'Const' },
            ]}
            value={a.kind}
            onchange={(k) => setArgKind(b.args, i, k)}
          />
          {#if a.kind === 'value'}
            {#if channels.length && a.type !== 'm'}
              <select
                class="input"
                title="Which part of the value"
                value={a.channel ?? ''}
                onchange={(e) => {
                  const v = e.currentTarget.value;
                  if (a.kind === 'value') a.channel = v || undefined;
                  onchange();
                }}
              >
                <option value="">(default)</option>
                {#each channels as c (c.id)}<option value={c.id} title={c.hint}>{c.id}</option
                  >{/each}
              </select>
            {/if}
            <select class="input" bind:value={a.type} {onchange}>
              {#each valueTypes as t (t.value)}<option value={t.value}>{t.label}</option>{/each}
            </select>
          {:else}
            <select class="input" bind:value={a.type} {onchange}>
              {#each CONST_TYPES as t (t.value)}<option value={t.value}>{t.label}</option>{/each}
            </select>
            {#if !VALUELESS.includes(a.type)}
              <input class="input mono" bind:value={a.value} oninput={onchange} />
            {/if}
          {/if}
          <button
            class="btn icon ghost"
            title="Remove argument"
            onclick={() => (b.args.splice(i, 1), onchange())}><Icon name="close" /></button
          >
        </div>
      {/each}
      <button class="btn ghost add-arg" onclick={() => (b.args.push(newValueArg()), onchange())}
        ><Icon name="plus" /> Argument</button
      >
    </div>
  {/each}
</section>

<style>
  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .binding {
    padding: 8px 1ch;
    display: flex;
    flex-direction: column;
    gap: 8px;
    border: 1px solid var(--line);
    border-left: 2px solid var(--accent);
    background: var(--bg);
  }
  .err {
    color: var(--danger);
  }
  .hint {
    overflow-wrap: anywhere;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  /* Output chips: [■ NAME] toggles, reverse video when on. */
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 1ch;
    height: 24px;
    padding: 0 1ch;
    border: 1px solid var(--line-strong);
    background: var(--bg);
    color: var(--fg-dim);
    transition:
      background var(--t-ui) steps(2),
      color var(--t-ui) steps(2);
  }
  .chip.on {
    border-color: var(--fg);
    background: var(--fg);
    color: var(--bg);
  }
  .chip.missing {
    border-color: var(--danger);
    color: var(--danger);
  }
  .dot {
    width: 7px;
    height: 7px;
    background: var(--fg-faint);
    box-shadow: 0 0 0 1px var(--bg);
  }
  .dot.ready {
    background: var(--ok);
  }
  .dot.error {
    background: var(--danger);
  }
  .dot.connecting,
  .dot.starting {
    background: var(--warn);
  }
  .arg {
    display: grid;
    grid-template-columns: 110px 1fr auto;
    gap: 6px;
    align-items: center;
  }
  .arg:has(input),
  .arg.with-channel {
    grid-template-columns: 110px minmax(0, 1fr) minmax(0, 1fr) auto;
  }
  .add-arg {
    align-self: flex-start;
  }
</style>
