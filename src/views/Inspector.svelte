<script lang="ts">
  import Icon from '../lib/ui/Icon.svelte';
  import type { ArgTemplate, Axis, ConstArgType, ValueArgType, Widget } from '../lib/model/preset';
  import { newBinding } from '../lib/model/factory';
  import { addressError } from '../lib/osc/mapping';
  import { networkStore } from '../lib/state/network.svelte';
  import { presetStore } from '../lib/state/preset.svelte';
  import Field from '../lib/ui/Field.svelte';
  import NumberInput from '../lib/ui/NumberInput.svelte';
  import Segmented from '../lib/ui/Segmented.svelte';
  import Toggle from '../lib/ui/Toggle.svelte';
  import { appearance } from '../lib/state/appearance.svelte';
  import { PALETTES } from '../lib/theme/palettes';
  import Swatches from '../lib/ui/Swatches.svelte';
  import { channelsFor, WIDGETS } from '../lib/widgets/registry';
  import WidgetActivity from './widget/WidgetActivity.svelte';
  import WidgetPreview from './widget/WidgetPreview.svelte';

  let { widget = $bindable() }: { widget: Widget } = $props();

  const touch = () => presetStore.touch();
  const outputs = $derived(presetStore.current.network.outputs);
  /** Named channels of this widget's value (empty = a single value). */
  const channels = $derived(channelsFor(widget));
  /** New value-arguments pick the widget's first channel, if it has any. */
  const newValueArg = (): ArgTemplate =>
    channels[0]
      ? { kind: 'value', type: 'f', channel: channels[0].id }
      : { kind: 'value', type: 'f' };

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

  function moveOption(i: number, d: -1 | 1) {
    if (widget.type !== 'list') return;
    const o = widget.props.options;
    const j = i + d;
    if (j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j]!, o[i]!];
    touch();
  }
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

  function setArgKind(args: ArgTemplate[], i: number, kind: ArgTemplate['kind']) {
    args[i] = kind === 'value' ? newValueArg() : { kind: 'const', type: 'i', value: '0' };
    touch();
  }

  function toggleOutput(outputIds: string[], id: string) {
    const i = outputIds.indexOf(id);
    if (i >= 0) outputIds.splice(i, 1);
    else outputIds.push(id);
    touch();
  }
</script>

<div class="inspector">
  <header>
    <div class="head">
      <span class="kind">{WIDGETS[widget.type].label.toUpperCase()}</span>
      <span class="faint">{widget.id}</span>
    </div>
    <div class="actions">
      <button
        class="btn icon"
        title="Duplicate"
        onclick={() => presetStore.duplicateWidget(widget.id)}><Icon name="copy" /></button
      >
      <button
        class="btn icon danger"
        title="Delete"
        onclick={() => presetStore.removeWidget(widget.id)}><Icon name="trash" /></button
      >
    </div>
  </header>

  <section class="grid2">
    <Field label="Label" wide>
      <input class="input" bind:value={widget.label} oninput={touch} />
    </Field>
    <Field label="Colour · {PALETTES[appearance.theme.palette].name}" wide>
      <Swatches
        value={widget.color}
        onchange={(c) => {
          widget.color = c;
          touch();
        }}
      />
    </Field>
    <Field label="Cell" wide>
      <span class="readout">x{widget.x} y{widget.y} · {widget.w}×{widget.h}</span>
    </Field>
  </section>

  {#snippet curveField(target: { curve: Axis['curve'] })}
    <Segmented
      size="sm"
      options={[
        { value: 'linear', label: 'Lin' },
        { value: 'exp', label: 'Exp', title: 'Finer control near min' },
        { value: 'log', label: 'Log', title: 'Finer control near max' },
      ]}
      bind:value={target.curve}
      onchange={touch}
    />
  {/snippet}

  {#snippet touchField(target: { touch: 'absolute' | 'relative' })}
    <Field
      label="Touch"
      wide
      hint={target.touch === 'relative'
        ? 'Drag moves from the current value; nothing jumps on touch.'
        : 'The value jumps to where you touch.'}
    >
      <Segmented
        options={[
          { value: 'relative', label: 'Relative' },
          { value: 'absolute', label: 'Absolute' },
        ]}
        bind:value={target.touch}
        onchange={touch}
      />
    </Field>
  {/snippet}

  {#snippet rateField(target: { maxRateHz: number })}
    <Field
      label="Max rate (msg/s)"
      wide
      hint="0 = send on every pointer event. The final value is always sent."
    >
      <NumberInput bind:value={target.maxRateHz} min={0} max={1000} onchange={touch} />
    </Field>
  {/snippet}

  {#if widget.type === 'button'}
    <section class="grid2">
      <Field
        label="Mode"
        wide
        hint={widget.props.mode === 'momentary'
          ? 'On value while held, off value on release.'
          : 'On value on press only. For on/off state use a Switch.'}
      >
        <Segmented
          options={[
            { value: 'momentary', label: 'Momentary' },
            { value: 'trigger', label: 'Trigger' },
          ]}
          bind:value={widget.props.mode}
          onchange={touch}
        />
      </Field>
      <Field label="On value"
        ><NumberInput bind:value={widget.props.onValue} onchange={touch} /></Field
      >
      <Field label="Off value"
        ><NumberInput bind:value={widget.props.offValue} onchange={touch} /></Field
      >
      <Field
        label="Arm then fire"
        wide
        hint={widget.props.arm === 'none'
          ? 'Fires on press.'
          : widget.props.arm === 'double'
            ? 'First press arms it; a second press fires. It disarms after the timeout.'
            : 'Fires only after being held down; letting go early cancels.'}
      >
        <Segmented
          options={[
            { value: 'none', label: 'Off' },
            { value: 'double', label: 'Double-tap' },
            { value: 'hold', label: 'Hold' },
          ]}
          bind:value={widget.props.arm}
          onchange={touch}
        />
      </Field>
      {#if widget.props.arm === 'double'}
        <Field label="Disarm after ms"
          ><NumberInput
            bind:value={widget.props.armTimeoutMs}
            integer
            min={300}
            max={20000}
            onchange={touch}
          /></Field
        >
      {:else if widget.props.arm === 'hold'}
        <Field label="Hold for ms"
          ><NumberInput
            bind:value={widget.props.holdMs}
            integer
            min={200}
            max={5000}
            onchange={touch}
          /></Field
        >
      {/if}
    </section>
  {:else if widget.type === 'switch'}
    <section class="grid2">
      <Field label="On value"
        ><NumberInput bind:value={widget.props.onValue} onchange={touch} /></Field
      >
      <Field label="Off value"
        ><NumberInput bind:value={widget.props.offValue} onchange={touch} /></Field
      >
      <p class="faint wide-note">
        Tap flips it; dragging the knob sets the side you release on. Sends once per change.
      </p>
    </section>
  {:else if widget.type === 'slider'}
    <section class="grid2">
      <Field label="Orientation" wide>
        <Segmented
          options={[
            { value: 'vertical', label: 'Vertical' },
            { value: 'horizontal', label: 'Horizontal' },
          ]}
          bind:value={widget.props.orientation}
          onchange={touch}
        />
      </Field>
      <Field label="Min"><NumberInput bind:value={widget.props.min} onchange={touch} /></Field>
      <Field label="Max"><NumberInput bind:value={widget.props.max} onchange={touch} /></Field>
      <Field label="Step" hint="0 = continuous">
        <NumberInput bind:value={widget.props.step} min={0} onchange={touch} />
      </Field>
      <Field label="Default" hint="Double-tap resets">
        <NumberInput bind:value={widget.props.defaultValue} onchange={touch} />
      </Field>
      <Field label="Curve" wide>{@render curveField(widget.props)}</Field>
      {@render touchField(widget.props)}
      {@render rateField(widget.props)}
    </section>
  {:else if widget.type === 'graph'}
    <section>
      <div class="axes">
        <span></span><span class="axis-head">X</span><span class="axis-head">Y</span>
        <span class="axis-label">Name</span>
        <input class="input" bind:value={widget.props.x.label} oninput={touch} />
        <input class="input" bind:value={widget.props.y.label} oninput={touch} />
        <span class="axis-label">Min</span>
        <NumberInput bind:value={widget.props.x.min} onchange={touch} />
        <NumberInput bind:value={widget.props.y.min} onchange={touch} />
        <span class="axis-label">Max</span>
        <NumberInput bind:value={widget.props.x.max} onchange={touch} />
        <NumberInput bind:value={widget.props.y.max} onchange={touch} />
        <span class="axis-label" title="0 = continuous">Step</span>
        <NumberInput bind:value={widget.props.x.step} min={0} onchange={touch} />
        <NumberInput bind:value={widget.props.y.step} min={0} onchange={touch} />
        <span class="axis-label" title="Double-tap resets">Default</span>
        <NumberInput bind:value={widget.props.x.defaultValue} onchange={touch} />
        <NumberInput bind:value={widget.props.y.defaultValue} onchange={touch} />
        <span class="axis-label">Curve</span>
        {@render curveField(widget.props.x)}
        {@render curveField(widget.props.y)}
      </div>
      <div class="grid2">
        {@render touchField(widget.props)}
        {@render rateField(widget.props)}
        <Field label="Trail" hint="Fading line of recent points">
          <Toggle bind:checked={widget.props.trail} label="Trail" onchange={touch} />
        </Field>
      </div>
    </section>
  {:else if widget.type === 'knob'}
    <section class="grid2">
      <Field
        label="Mode"
        wide
        hint={widget.props.mode === 'bounded'
          ? 'A pot with a range. Drag up/down; double-tap resets.'
          : 'An encoder: each detent sends {value, delta}; delta is ±step.'}
      >
        <Segmented
          options={[
            { value: 'bounded', label: 'Bounded' },
            { value: 'endless', label: 'Endless' },
          ]}
          bind:value={widget.props.mode}
          onchange={touch}
        />
      </Field>
      {#if widget.props.mode === 'bounded'}
        <Field label="Min"><NumberInput bind:value={widget.props.min} onchange={touch} /></Field>
        <Field label="Max"><NumberInput bind:value={widget.props.max} onchange={touch} /></Field>
        <Field label="Step" hint="0 = continuous">
          <NumberInput bind:value={widget.props.step} min={0} onchange={touch} />
        </Field>
        <Field label="Default" hint="Double-tap resets">
          <NumberInput bind:value={widget.props.defaultValue} onchange={touch} />
        </Field>
        <Field label="Curve" wide>{@render curveField(widget.props)}</Field>
      {:else}
        <Field label="Step per detent" hint="the delta">
          <NumberInput bind:value={widget.props.deltaStep} min={0.000001} onchange={touch} />
        </Field>
        <Field label="Px per detent" hint="drag sensitivity">
          <NumberInput
            bind:value={widget.props.detentPx}
            integer
            min={2}
            max={200}
            onchange={touch}
          />
        </Field>
        <Field label="Start value" hint="Double-tap resets to it">
          <NumberInput bind:value={widget.props.defaultValue} onchange={touch} />
        </Field>
      {/if}
      {@render rateField(widget.props)}
    </section>
  {:else if widget.type === 'pads'}
    <section class="grid2">
      <Field label="Rows"
        ><NumberInput
          bind:value={widget.props.rows}
          integer
          min={1}
          max={8}
          onchange={touch}
        /></Field
      >
      <Field label="Columns"
        ><NumberInput
          bind:value={widget.props.cols}
          integer
          min={1}
          max={8}
          onchange={touch}
        /></Field
      >
      <Field
        label="Mode"
        wide
        hint={{
          momentary: 'On while held, off on release.',
          toggle: 'Each hit flips the pad on or off.',
          trigger: 'On only (release sends nothing).',
        }[widget.props.mode]}
      >
        <Segmented
          options={[
            { value: 'momentary', label: 'Momentary' },
            { value: 'toggle', label: 'Toggle' },
            { value: 'trigger', label: 'Trigger' },
          ]}
          bind:value={widget.props.mode}
          onchange={touch}
        />
      </Field>
      <p class="faint wide-note">
        Numbered 1–{widget.props.rows * widget.props.cols} from the top-left. Each hit sends
        {'{'}number, row, col, on{'}'}.
      </p>
    </section>
  {:else if widget.type === 'list'}
    <section>
      <Field label="Layout" hint="auto: a strip when wide, a list when tall">
        <Segmented
          options={[
            { value: 'auto', label: 'Auto' },
            { value: 'vertical', label: 'Vertical' },
            { value: 'horizontal', label: 'Horizontal' },
          ]}
          bind:value={widget.props.layout}
          onchange={touch}
        />
      </Field>
      <div class="options-head">
        <span class="axis-label">Label</span><span class="axis-label">Value</span>
      </div>
      {#each widget.props.options as o, i (i)}
        <div class="option">
          <input class="input" bind:value={o.label} oninput={touch} placeholder="label" />
          <input class="input mono" bind:value={o.value} oninput={touch} placeholder="value" />
          <button
            class="btn icon ghost"
            title="Move up"
            disabled={i === 0}
            onclick={() => moveOption(i, -1)}>▲</button
          >
          <button
            class="btn icon ghost"
            title="Move down"
            disabled={i === widget.props.options.length - 1}
            onclick={() => moveOption(i, 1)}>▼</button
          >
          <button
            class="btn icon ghost"
            title="Remove option"
            disabled={widget.props.options.length <= 1}
            onclick={() => (widget.props.options.splice(i, 1), touch())}
            ><Icon name="close" /></button
          >
        </div>
      {/each}
      <div class="row">
        <button
          class="btn ghost"
          disabled={widget.props.options.length >= 64}
          onclick={() => {
            if (widget.type !== 'list') return;
            const n = widget.props.options.length + 1;
            widget.props.options.push({ label: `Option ${n}`, value: String(n) });
            touch();
          }}><Icon name="plus" /> Option</button
        >
        <Field label="Start on">
          <select class="input" bind:value={widget.props.defaultIndex} onchange={touch}>
            {#each widget.props.options as o, i (i)}<option value={i}>{o.label || o.value}</option
              >{/each}
          </select>
        </Field>
      </div>
      <p class="faint">
        Sends {'{'}index, label, value{'}'}; numeric-looking values are sent as numbers.
      </p>
    </section>
  {/if}

  <section>
    <div class="section-head">
      <h2>Messages</h2>
      <button
        class="btn"
        onclick={() => (
          widget.bindings.push(newBinding('/octopus/new', outputs[0] ? [outputs[0].id] : [])),
          touch()
        )}
      >
        <Icon name="plus" /> Add
      </button>
    </div>
    {#each widget.bindings as b (b.id)}
      {@const addrErr = addressError(b.address)}
      <div class="binding card">
        <div class="row">
          <Toggle bind:checked={b.enabled} label="Binding enabled" onchange={touch} />
          <input
            class="input mono"
            class:invalid={addrErr}
            bind:value={b.address}
            oninput={touch}
            placeholder="/address"
            title={addrErr ?? ''}
          />
          <button
            class="btn icon ghost"
            title="Remove message"
            onclick={() => (
              (widget.bindings = widget.bindings.filter((x) => x.id !== b.id)),
              touch()
            )}><Icon name="close" /></button
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
          {#if outputs.length === 0}<span class="faint">No outputs: add one in Network.</span>{/if}
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
                    touch();
                  }}
                >
                  <option value="">(default)</option>
                  {#each channels as c (c.id)}<option value={c.id} title={c.hint}>{c.id}</option
                    >{/each}
                </select>
              {/if}
              <select class="input" bind:value={a.type} onchange={touch}>
                {#each valueTypes as t (t.value)}<option value={t.value}>{t.label}</option>{/each}
              </select>
            {:else}
              <select class="input" bind:value={a.type} onchange={touch}>
                {#each CONST_TYPES as t (t.value)}<option value={t.value}>{t.label}</option>{/each}
              </select>
              {#if !['T', 'F', 'N', 'I'].includes(a.type)}
                <input class="input mono" bind:value={a.value} oninput={touch} />
              {/if}
            {/if}
            <button
              class="btn icon ghost"
              title="Remove argument"
              onclick={() => (b.args.splice(i, 1), touch())}><Icon name="close" /></button
            >
          </div>
        {/each}
        <button class="btn ghost add-arg" onclick={() => (b.args.push(newValueArg()), touch())}
          ><Icon name="plus" /> Argument</button
        >
      </div>
    {/each}
  </section>

  <WidgetPreview {widget} />
  <WidgetActivity widgetId={widget.id} />
</div>

<style>
  .inspector {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .head {
    display: flex;
    gap: 1ch;
    min-width: 0;
  }
  .kind {
    padding: 0 1ch;
    background: var(--accent);
    color: var(--accent-ink);
    font-weight: 700;
  }
  header,
  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .actions {
    display: flex;
    gap: 6px;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .readout {
    line-height: var(--control-h);
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
  .arg:has(input) {
    grid-template-columns: 110px minmax(0, 1fr) minmax(0, 1fr) auto;
  }
  .arg.with-channel {
    grid-template-columns: 110px minmax(0, 1fr) minmax(0, 1fr) auto;
  }
  .hint {
    overflow-wrap: anywhere;
  }
  .options-head,
  .option {
    display: grid;
    grid-template-columns: 1fr 1fr auto auto auto;
    gap: 4px;
    align-items: center;
  }
  .options-head {
    grid-template-columns: 1fr 1fr calc(3 * var(--control-h) + 8px);
  }
  .axes {
    display: grid;
    grid-template-columns: auto 1fr 1fr;
    gap: 6px 8px;
    align-items: center;
  }
  .axis-head {
    font-weight: 700;
    text-align: center;
    color: var(--fg-dim);
  }
  .axis-label {
    color: var(--fg-dim);
  }
  .wide-note {
    grid-column: 1 / -1;
  }
  .add-arg {
    align-self: flex-start;
  }
  p {
    margin: 0;
  }
</style>
