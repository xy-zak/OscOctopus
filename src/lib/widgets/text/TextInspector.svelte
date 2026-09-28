<script lang="ts">
  // INTERACTION for a text widget: what it shows (its mode and source text, in markup.ts's
  // marks), how big at most (fit.ts) and where, and for a monitor, which widget of this desk it
  // follows.
  import { LIMITS, type TextWidget } from '../../model/preset';
  import { presetStore } from '../../state/preset.svelte';
  import Field from '../../ui/Field.svelte';
  import NumberInput from '../../ui/NumberInput.svelte';
  import Segmented from '../../ui/Segmented.svelte';
  import { channelsFor, DEFS } from '../defs';
  import { MIN_TEXT_PX, TEXT_PX } from './fit';
  import { parseMarkup, placeholdersOf } from './markup';

  let { widget = $bindable(), onchange }: { widget: TextWidget; onchange: () => void } = $props();

  const p = $derived(widget.props);
  const others = $derived(presetStore.current.widgets.filter((w) => w.id !== widget.id));
  const target = $derived(others.find((w) => w.id === p.target));
  /** The placeholders the chosen mode fills. */
  const offered = $derived(
    p.mode === 'text'
      ? []
      : ['value', ...(p.mode === 'monitor' && target ? channelsFor(target).map((c) => c.id) : [])],
  );
  const used = $derived(placeholdersOf(parseMarkup(p.source)));
  const shows = $derived(used.some((name) => offered.includes(name)));
</script>

<section>
  <Field label="Shows" wide>
    <Segmented
      options={[
        { value: 'text', label: 'Text', title: 'The text as written' },
        { value: 'osc', label: 'OSC in', title: 'The value of a received message ({value})' },
        { value: 'monitor', label: 'Monitor', title: 'Another widget’s live value ({value})' },
      ]}
      bind:value={widget.props.mode}
      {onchange}
    />
  </Field>

  {#if p.mode === 'monitor'}
    <div class="grid2">
      <Field label="Widget" hint="On this desk">
        <select
          class="input"
          value={p.target ?? ''}
          onchange={(e) => {
            widget.props.target = e.currentTarget.value || null;
            onchange();
          }}
        >
          <option value="">(choose)</option>
          {#each others as w (w.id)}
            <option value={w.id}>{w.label || DEFS[w.type].label} · {DEFS[w.type].label}</option>
          {/each}
        </select>
      </Field>
      <Field label="Decimals">
        <NumberInput
          bind:value={widget.props.decimals}
          integer
          {...LIMITS.textDecimals}
          {onchange}
        />
      </Field>
    </div>
  {:else if p.mode === 'osc'}
    <p class="faint">
      Choose the message in MESSAGES: turn IN on and pick where it comes from. Its value fills
      {'{value}'}.
    </p>
  {/if}

  <Field label="Text" wide>
    <textarea
      class="input mono source"
      rows="6"
      maxlength={LIMITS.textChars.max}
      spellcheck="false"
      bind:value={widget.props.source}
      oninput={onchange}></textarea>
  </Field>
  <p class="faint marks">
    <span># Heading</span><span>- item</span><span>**bold**</span><span>==reverse==</span><span
      >{'{3:colour}'}</span
    ><span>\* as itself</span>{#if offered.length}<span
        >{offered.map((c) => `{${c}}`).join(' ')}</span
      >{/if}
  </p>
  {#if p.mode !== 'text' && !shows}
    <p class="warn">
      The text has no {'{value}'}{offered.length > 1 ? ' or channel' : ''}: nothing the
      {p.mode === 'osc' ? 'message receives' : 'widget does'} will show.
    </p>
  {/if}

  <div class="grid2">
    <Field
      label="Size"
      hint="The largest it gets: it shrinks to fit, down to {MIN_TEXT_PX} px, then ends in …"
      wide
    >
      <Segmented
        options={[
          { value: 'fit', label: 'Fit', title: 'As large as the box allows' },
          ...(['s', 'm', 'l', 'xl'] as const).map((value) => ({
            value,
            label: value.toUpperCase(),
            title: `At most ${TEXT_PX[value]} px`,
          })),
        ]}
        bind:value={widget.props.size}
        {onchange}
      />
    </Field>
    <Field label="Across">
      <Segmented
        options={[
          { value: 'left', label: 'Left' },
          { value: 'center', label: 'Centre' },
          { value: 'right', label: 'Right' },
        ]}
        bind:value={widget.props.align}
        {onchange}
      />
    </Field>
    <Field label="Down">
      <Segmented
        options={[
          { value: 'top', label: 'Top' },
          { value: 'middle', label: 'Middle' },
          { value: 'bottom', label: 'Bottom' },
        ]}
        bind:value={widget.props.valign}
        {onchange}
      />
    </Field>
  </div>
</section>

<style>
  .source {
    height: auto;
    padding: 4px 1ch;
    resize: vertical;
  }
  .marks {
    display: flex;
    flex-wrap: wrap;
    gap: 0 2ch;
  }
  .warn {
    color: var(--warn);
  }
</style>
