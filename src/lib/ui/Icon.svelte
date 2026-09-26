<script lang="ts">
  import { ICONS, type IconName } from './icons';
  let { name, label }: { name: IconName; label?: string } = $props();
</script>

<span
  class="icon"
  aria-hidden={label ? undefined : 'true'}
  aria-label={label}
  role={label ? 'img' : undefined}>{ICONS[name]}</span
>

<style>
  .icon {
    display: inline-block;
    width: 1ch;
    text-align: center;
    line-height: 1;
  }
</style>
