<script lang="ts">
  // Widgets inside wear `skin` (previews in LOOK; see context.ts).
  import type { Snippet } from 'svelte';
  import type { SkinInfo } from './builtin';
  import { provideSkin } from './context';

  let { skin, children }: { skin: SkinInfo; children: Snippet } = $props();
  provideSkin(() => skin);
</script>

{@render children()}
