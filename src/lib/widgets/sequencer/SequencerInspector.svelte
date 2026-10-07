<script lang="ts">
  // INTERACTION for a sequencer: where it sends, its steps (each a message and the wait after
  // it) and how often it plays. An edit reaches a running sequence at its next step.
  import { LIMITS, type SequencerWidget } from '../../model/preset';
  import { addressError } from '../../osc/mapping';
  import { networkStore } from '../../state/network.svelte';
  import { presetStore } from '../../state/preset.svelte';
  import { sequencerStore } from '../../state/sequencer.svelte';
  import Chips from '../../ui/Chips.svelte';
  import Field from '../../ui/Field.svelte';
  import Icon from '../../ui/Icon.svelte';
  import NumberInput from '../../ui/NumberInput.svelte';
  import Segmented from '../../ui/Segmented.svelte';
  import { toneOf } from '../../ui/status';
  import ConstArgFields from '../fields/ConstArgFields.svelte';
  import { newStep } from './def';
  import { passMs } from './plan';

  let { widget = $bindable(), onchange }: { widget: SequencerWidget; onchange: () => void } =
    $props();
  const steps = $derived(widget.props.steps);
  const outputs = $derived(
    presetStore.current.network.outputs.map((o) => ({
      id: o.id,
      name: o.name,
      lamp: toneOf(networkStore.status(presetStore.current.id, o.id)?.state),
    })),
  );
  const pass = $derived(passMs(steps));

  function move(i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= steps.length) return;
    [steps[i], steps[j]] = [steps[j]!, steps[i]!];
    onchange();
  }

  function remove(i: number) {
    steps.splice(i, 1);
    onchange();
  }

  /** A new step continues from the last: same address, the next number, the same wait. */
  function add() {
    const last = steps.at(-1);
    steps.push(newStep(last?.address ?? '/octopus/seq', steps.length + 1, last?.delayMs ?? 500));
    onchange();
  }

  const seconds = (ms: number) =>
    ms >= 1000 ? `${(ms / 1000).toFixed(ms % 1000 ? 2 : 0)} s` : `${ms} ms`;
</script>

<section>
  <Field label="Sends to" hint="Every step goes to these outputs" wide>
    <Chips
      items={outputs}
      picked={widget.props.outputIds}
      {onchange}
      empty="No outputs: add one in NETWORK."
      missingTitle="This output no longer exists; click to remove"
    />
  </Field>

  <div class="row">
    <Field label="Plays">
      <Segmented
        options={[
          { value: 'forever', label: 'Forever' },
          { value: 'count', label: 'Passes' },
        ]}
        bind:value={widget.props.repeat}
        {onchange}
      />
    </Field>
    {#if widget.props.repeat === 'count'}
      <Field label="Passes">
        <NumberInput bind:value={widget.props.count} integer {...LIMITS.seqCount} {onchange} />
      </Field>
    {/if}
  </div>

  {#each steps as s, i (s.id)}
    {@const err = addressError(s.address)}
    <div class="step card">
      <div class="head">
        <span class="n">{i + 1}</span>
        <input
          class="input mono"
          class:invalid={err}
          bind:value={s.address}
          oninput={onchange}
          placeholder="/address"
          data-tip={err ?? ''}
        />
        <button
          class="btn icon ghost"
          data-tip="Move up"
          disabled={i === 0}
          onclick={() => move(i, -1)}>▲</button
        >
        <button
          class="btn icon ghost"
          data-tip="Move down"
          disabled={i === steps.length - 1}
          onclick={() => move(i, 1)}>▼</button
        >
        <button
          class="btn icon ghost"
          data-tip="Remove step"
          disabled={steps.length <= LIMITS.seqSteps.min}
          onclick={() => remove(i)}><Icon name="close" /></button
        >
      </div>
      {#if err}<span class="err">{err}</span>{/if}
      {#each s.args as a, j (j)}
        <div class="arg">
          <ConstArgFields arg={a} {onchange} />
          <button
            class="btn icon ghost"
            data-tip="Remove argument"
            onclick={() => (s.args.splice(j, 1), onchange())}><Icon name="close" /></button
          >
        </div>
      {/each}
      <div class="row">
        <button
          class="btn ghost"
          onclick={() => (s.args.push({ kind: 'const', type: 'i', value: '0' }), onchange())}
          ><Icon name="plus" /> Argument</button
        >
        <span class="then faint">then wait</span>
        <span class="wait">
          <NumberInput
            bind:value={s.delayMs}
            integer
            {...LIMITS.seqDelayMs}
            tip="Milliseconds before the next step"
            {onchange}
          />
        </span>
        <span class="faint">ms</span>
      </div>
    </div>
  {/each}
  <button class="btn ghost add" disabled={steps.length >= LIMITS.seqSteps.max} onclick={add}
    ><Icon name="plus" /> Step</button
  >

  <p class="faint">
    <span
      class="has-tip"
      data-tip="The sequence plays on this device only, timed by the app’s core, in the background too. OSC-OUT off holds its messages back; FREEZE leaves it playing."
      >One pass takes {seconds(pass.ms)}</span
    >{pass.floored ? ' (a pass never takes less, so it can’t flood the outputs)' : ''}.
  </p>
  {#if sequencerStore.edited[widget.id]}
    <p class="warn-text">
      Edited on another device: the running sequence keeps its steps until it is started again.
    </p>
  {/if}
</section>

<style>
  .step {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px 1ch;
    border: 1px solid var(--line);
    border-left: 2px solid var(--accent);
    background: var(--bg);
  }
  .head {
    display: grid;
    grid-template-columns: 3ch 1fr auto auto auto;
    gap: 4px;
    align-items: center;
  }
  .n {
    color: var(--fg-dim);
    font-weight: 700;
    text-align: right;
  }
  .arg {
    display: grid;
    grid-template-columns: 110px auto;
    gap: 6px;
    align-items: center;
  }
  /* A type that carries a value has its input between the type and the remove button. */
  .arg:has(:global(input)) {
    grid-template-columns: 110px minmax(0, 1fr) auto;
  }
  .wait {
    width: 11ch;
  }
  .then {
    margin-left: auto;
  }
  .add {
    align-self: flex-start;
  }
  .err {
    color: var(--danger);
  }
</style>
