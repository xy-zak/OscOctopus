<script lang="ts">
  // The Inspector's MESSAGES section (above the preview). Each binding is an
  // address (with `{channel}` placeholders) and its argument templates, and it can go both ways:
  //   OUT: sent to the chosen outputs whenever the widget changes (osc/mapping.ts);
  //   IN:  received from the chosen inputs (or replies on outputs) to set the widget
  //        (osc/input.ts), optionally forwarded to the outputs (a bridge; guarded).
  import type {
    ArgTemplate,
    Binding,
    ConstArgType,
    ValueArgType,
    Widget,
  } from '../../lib/model/preset';
  import { newBinding, valueArg } from '../../lib/model/parts';
  import { forwardProblem, receiveProblem } from '../../lib/osc/input';
  import { addressError } from '../../lib/osc/mapping';
  import { rearmForward } from '../../lib/osc/receiver.svelte';
  import { inputStore } from '../../lib/state/input.svelte';
  import { networkStore } from '../../lib/state/network.svelte';
  import { presetStore } from '../../lib/state/preset.svelte';
  import Icon from '../../lib/ui/Icon.svelte';
  import Segmented from '../../lib/ui/Segmented.svelte';
  import Toggle from '../../lib/ui/Toggle.svelte';
  import { channelsFor } from '../../lib/widgets/defs';

  let { widget = $bindable(), onchange }: { widget: Widget; onchange: () => void } = $props();

  const outputs = $derived(presetStore.current.network.outputs);
  const inputs = $derived(presetStore.current.network.inputs);
  /** Where a binding can listen: the desk's inputs, and replies arriving on its outputs. */
  const sources = $derived([
    ...inputs.map((i) => ({ id: i.id, name: `↓ ${i.name}`, title: 'Input' })),
    ...outputs.map((o) => ({
      id: o.id,
      name: `↩ ${o.name}`,
      title: 'Replies arriving on this output (devices that answer the sender)',
    })),
  ]);
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

  /** Turning IN on for the first time listens on the desk's first input (never an output). */
  function setReceive(b: Binding, on: boolean) {
    if (on && b.sourceIds.length === 0 && inputs[0]) b.sourceIds.push(inputs[0].id);
    onchange();
  }
</script>

<section>
  {#each widget.bindings as b (b.id)}
    {@const addrErr = addressError(b.address)}
    {@const inProblem = b.receive ? receiveProblem(widget, b) : null}
    {@const fwdProblem = forwardProblem(widget, b)}
    <div class="binding card">
      <div class="part">
        <div class="row">
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
      </div>

      <!-- OUT: where it goes when the widget changes. -->
      <div class="part way">
        <Toggle bind:checked={b.send} label="Send this message to outputs" {onchange} />
        <span class="way-label" class:off={!b.send}>OUT</span>
        {#if b.send}
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
            {#if outputs.length === 0}<span class="faint">No outputs: add one in NETWORK.</span
              >{/if}
          </div>
        {:else}
          <span class="faint">not sent</span>
        {/if}
      </div>

      <!-- IN (and FORWARD): what received OSC does to the widget. -->
      <div class="part">
        <div class="way">
          <Toggle
            bind:checked={b.receive}
            label="Receive this message: it sets the widget"
            onchange={(on) => setReceive(b, on)}
          />
          <span class="way-label" class:off={!b.receive}>IN</span>
          {#if b.receive}
            <div class="chips">
              {#each sources as s (s.id)}
                <button
                  class="chip"
                  class:on={b.sourceIds.includes(s.id)}
                  title={s.title}
                  onclick={() => toggleOutput(b.sourceIds, s.id)}>{s.name}</button
                >
              {/each}
              {#each b.sourceIds.filter((id) => !sources.some((s) => s.id === id)) as missing (missing)}
                <button
                  class="chip on missing"
                  title="This endpoint no longer exists; click to remove"
                  onclick={() => toggleOutput(b.sourceIds, missing)}>missing: {missing}</button
                >
              {/each}
              {#if sources.length === 0}<span class="faint">No inputs: add one in NETWORK.</span
                >{/if}
            </div>
          {:else}
            <span class="faint">not received</span>
          {/if}
        </div>
        {#if b.receive}
          {#if inProblem}
            <span class="err">Not receiving: {inProblem}</span>
          {/if}
          <div class="way">
            <Toggle
              bind:checked={b.forward}
              label="Forward received values to this widget's outputs"
              {onchange}
            />
            <span class="way-label" class:off={!b.forward || !!fwdProblem}>FORWARD</span>
            <span class="faint">{b.forward && !fwdProblem ? 're-sent to outputs' : 'off'}</span>
          </div>
          <p class="note faint">
            {fwdProblem
              ? `Never forwarded: ${fwdProblem}.`
              : b.forward
                ? 'Received values are re-sent to the outputs (never back to their sender). Only for bridging: a device that echoes can loop, and forwarding stops if it does.'
                : 'Received values only move the widget.'}
          </p>
          {#if inputStore.tripped[widget.id]}
            <div class="row">
              <span class="err">Forwarding stopped: values kept coming back (a loop?).</span>
              <button class="btn ghost" onclick={() => rearmForward(widget.id)}>Re-arm</button>
            </div>
          {/if}
        {/if}
      </div>

      <!-- ARGUMENTS: how the value becomes OSC arguments (and back, when received). -->
      <div class="part">
        <span class="part-label">Arguments <span class="faint">· used both ways</span></span>
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
    </div>
  {:else}
    <p class="faint">No messages: this widget sends and receives nothing.</p>
  {/each}
  <button class="btn add-binding" onclick={addBinding}><Icon name="plus" /> Message</button>
</section>

<style>
  .binding {
    padding: 8px 1ch;
    display: flex;
    flex-direction: column;
    gap: 10px;
    border: 1px solid var(--line);
    border-left: 2px solid var(--accent);
    background: var(--bg);
  }
  /* The parts of a message (address · OUT · IN & FORWARD · arguments), ruled apart. */
  .part {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .part + .part {
    padding-top: 10px;
    border-top: 1px solid var(--line);
  }
  .part-label {
    font-weight: 700;
    text-transform: uppercase;
    color: var(--fg-dim);
  }
  .note {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .add-binding {
    align-self: flex-start;
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
  /* One direction of a message: [■] OUT  chips…  /  [■] IN  chips… */
  .way {
    display: grid;
    grid-template-columns: auto 8ch minmax(0, 1fr);
    align-items: center;
    gap: 6px;
  }
  .way-label {
    font-weight: 700;
    color: var(--fg);
  }
  .way-label.off {
    color: var(--fg-faint);
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
