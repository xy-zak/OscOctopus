<script lang="ts" module>
  /** The box every switch shows: `[■]` while on, `[ ]` while off (a no-break space). */
  export const switchBox = (on: boolean) => `[${on ? '■' : ' '}]`;
</script>

<script lang="ts">
  // A switch in the master bar's shape (.mbtn.switch, app.css) that changes on a click: it
  // shows [■] and fills with the accent while on: the desk's INFO and EDIT. The master
  // switches that must be held for a second (PRESENT only to stop) are HoldSwitch.
  interface Props {
    on: boolean;
    label: string;
    title: string;
    onclick: () => void;
    /** For a longer label (.mbtn.switch.wide). */
    wide?: boolean;
    disabled?: boolean;
  }
  let { on, label, title, onclick, wide = false, disabled = false }: Props = $props();
</script>

<button
  type="button"
  class="mbtn switch"
  class:wide
  class:accent={on}
  role="switch"
  aria-checked={on}
  {disabled}
  {title}
  {onclick}><span class="box">{switchBox(on)}</span>{label}</button
>

<style>
  .mbtn:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
