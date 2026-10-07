<script lang="ts">
  // The Inspector's MESSAGES section (above the preview). Each binding is an
  // address (with `{channel}` placeholders) and its argument templates, and it can go both ways:
  //   OUT: sent to the chosen outputs whenever the widget changes (osc/mapping.ts);
  //   IN:  received from the chosen inputs (or replies on outputs) to set the widget
  //        (osc/input.ts), optionally forwarded to the outputs (a bridge; guarded).
  // A widget whose messages only receive (`WidgetDef.messages`) has no OUT and no FORWARD.
  import type { ArgTemplate, Binding, ValueArgType, Widget } from '../../lib/model/preset';
  import { newBinding, valueArg } from '../../lib/model/parts';
  import { forwardProblem, receiveProblem } from '../../lib/osc/input';
  import { addressError } from '../../lib/osc/mapping';
  import { rearmForward } from '../../lib/osc/receiver.svelte';
  import { inputStore } from '../../lib/state/input.svelte';
  import { networkStore } from '../../lib/state/network.svelte';
  import { presetStore } from '../../lib/state/preset.svelte';
  import Chips from '../../lib/ui/Chips.svelte';
  import Icon from '../../lib/ui/Icon.svelte';
  import Segmented from '../../lib/ui/Segmented.svelte';
  import { toneOf } from '../../lib/ui/status';
  import Toggle from '../../lib/ui/Toggle.svelte';
  import { channelsFor, messagesOf } from '../../lib/widgets/defs';
  import ConstArgFields from '../../lib/widgets/fields/ConstArgFields.svelte';

  let { widget = $bindable(), onchange }: { widget: Widget; onchange: () => void } = $props();

  const outputs = $derived(presetStore.current.network.outputs);
  const inputs = $derived(presetStore.current.network.inputs);
  const receiveOnly = $derived(messagesOf(widget) === 'receive');
  const outputChips = $derived(
    outputs.map((o) => ({
      id: o.id,
      name: o.name,
      lamp: toneOf(networkStore.status(presetStore.current.id, o.id)?.state),
    })),
  );
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
  /** MIDI only makes sense for values that carry a note; hide it otherwise. */
  const valueTypes = $derived(
    channels.some((c) => c.id === 'note')
      ? VALUE_TYPES
      : VALUE_TYPES.filter((t) => t.value !== 'm'),
  );

  function addBinding() {
    const b = newBinding('/octopus/new', receiveOnly || !outputs[0] ? [] : [outputs[0].id]);
    if (receiveOnly) b.send = false;
    widget.bindings.push(b);
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
    {@const fwdProblem = forwardProblem(widget)}
    <div class="binding card">
      <div class="part">
        <div class="row">
          <input
            class="input mono"
            class:invalid={addrErr}
            bind:value={b.address}
            oninput={onchange}
            placeholder="/address"
            data-tip={channels.length
              ? `Placeholders: ${channels.map((c) => `{${c.id}}`).join(' ')}`
              : undefined}
          />
          <button
            class="btn icon ghost danger"
            data-tip="Delete message"
            aria-label="Delete message"
            onclick={() => removeBinding(b.id)}><Icon name="trash" /></button
          >
        </div>
        {#if addrErr}<span class="error-text">{addrErr}</span>{/if}
      </div>

      <!-- OUT: where it goes when the widget changes. -->
      {#if !receiveOnly}
        <div class="part way">
          <Toggle bind:checked={b.send} label="Send this message to outputs" {onchange} />
          <span
            class="way-label field-label has-tip"
            class:off={!b.send}
            data-tip="Sent to the chosen outputs when the widget changes">OUT</span
          >
          {#if b.send}
            <Chips
              items={outputChips}
              picked={b.outputIds}
              {onchange}
              empty="No outputs: add one in NETWORK."
              missingTitle="This output no longer exists; click to remove"
            />
          {:else}
            <span class="faint">not sent</span>
          {/if}
        </div>
      {/if}

      <!-- IN (and FORWARD): what received OSC does to the widget. -->
      <div class="part">
        <div class="way">
          <Toggle
            bind:checked={b.receive}
            label="Receive this message: it sets the widget"
            onchange={(on) => setReceive(b, on)}
          />
          <span
            class="way-label field-label has-tip"
            class:off={!b.receive}
            data-tip="Received from the chosen inputs (or as replies on an output): it sets the widget"
            >IN</span
          >
          {#if b.receive}
            <Chips
              items={sources}
              picked={b.sourceIds}
              {onchange}
              empty="No inputs: add one in NETWORK."
              missingTitle="This endpoint no longer exists; click to remove"
            />
          {:else}
            <span class="faint">not received</span>
          {/if}
        </div>
        {#if b.receive}
          {#if inProblem}
            <span class="error-text">Not receiving: {inProblem}</span>
          {/if}
          {#if !receiveOnly}
            <div class="way">
              <Toggle
                bind:checked={b.forward}
                label="Forward received values to this widget's outputs"
                {onchange}
              />
              <span
                class="way-label field-label has-tip"
                class:off={!b.forward || !!fwdProblem}
                data-tip="Received values are re-sent to the outputs (never back to their sender). Only for bridging: a device that echoes can loop, and forwarding stops if it does. Off, received values only move the widget."
                >FORWARD</span
              >
              <span class="faint">{b.forward && !fwdProblem ? 're-sent to outputs' : 'off'}</span>
            </div>
            {#if fwdProblem}<span class="error-text">Never forwarded: {fwdProblem}.</span>{/if}
          {/if}
          {#if inputStore.tripped[widget.id]}
            <div class="row">
              <span class="error-text">Forwarding stopped: values kept coming back (a loop?).</span>
              <button class="btn ghost" onclick={() => rearmForward(widget.id)}>Re-arm</button>
            </div>
          {/if}
        {/if}
      </div>

      <!-- ARGUMENTS: how the value becomes OSC arguments (and back, when received). -->
      <div class="part">
        <span
          class="part-label has-tip"
          data-tip="Used both ways: to build what is sent, and to read what is received"
          >Arguments</span
        >
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
                  data-tip="Which part of the value"
                  value={a.channel ?? ''}
                  onchange={(e) => {
                    const v = e.currentTarget.value;
                    if (a.kind === 'value') a.channel = v || undefined;
                    onchange();
                  }}
                >
                  <option value="">(default)</option>
                  {#each channels as c (c.id)}<option value={c.id}>{c.id}</option>{/each}
                </select>
              {/if}
              <select class="input" bind:value={a.type} {onchange}>
                {#each valueTypes as t (t.value)}<option value={t.value}>{t.label}</option>{/each}
              </select>
            {:else}
              <ConstArgFields arg={a} {onchange} />
            {/if}
            <button
              class="btn icon ghost danger"
              data-tip="Delete argument"
              aria-label="Delete argument"
              onclick={() => (b.args.splice(i, 1), onchange())}><Icon name="trash" /></button
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
  <button class="btn ghost add-binding" onclick={addBinding}><Icon name="plus" /> Message</button>
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
  .add-binding {
    align-self: flex-start;
  }
  /* One direction of a message: [■] OUT  chips…  /  [■] IN  chips… */
  .way {
    display: grid;
    grid-template-columns: auto 8ch minmax(0, 1fr);
    align-items: center;
    gap: 6px;
  }
  .way-label.off {
    color: var(--fg-faint);
  }
  .arg {
    display: grid;
    grid-template-columns: 110px 1fr auto;
    gap: 6px;
    align-items: center;
  }
  .arg:has(:global(input)),
  .arg.with-channel {
    grid-template-columns: 110px minmax(0, 1fr) minmax(0, 1fr) auto;
  }
  .add-arg {
    align-self: flex-start;
  }
</style>
