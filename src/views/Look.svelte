<script lang="ts">
  // GLOBAL SETTINGS › LOOK: the palette and accent, shared by every desk. Widgets and desk identity
  // colours are palette indices, so changing the palette recolours everything (it crossfades).
  import { appearance } from '../lib/state/appearance.svelte';
  import { PALETTES } from '../lib/theme/palettes';
  import Field from '../lib/ui/Field.svelte';
  import Lockable from '../lib/ui/Lockable.svelte';
  import Panel from '../lib/ui/Panel.svelte';
  import Swatches from '../lib/ui/Swatches.svelte';
  import Segmented from '../lib/ui/Segmented.svelte';
  import PalettePicker from './PalettePicker.svelte';
</script>

<div class="look scroll">
  <Lockable>
    <Panel title="Background · all desks">
      <Segmented
        options={[
          { value: 'dark', label: '■ DARK' },
          { value: 'light', label: '□ LIGHT' },
        ]}
        value={appearance.theme.mode}
        onchange={(mode) => appearance.set({ mode })}
      />
      <p class="faint">
        Dark (default) is near-black with near-white text; light is the inverse. The palette colours
        stay the same in both.
      </p>
    </Panel>

    <Panel title="Palette · all desks">
      <PalettePicker />
      <Field label="Accent ({PALETTES[appearance.theme.palette].name})">
        <Swatches
          value={appearance.theme.accent}
          allowAuto={false}
          onchange={(i) => appearance.set({ accent: i ?? 0 })}
        />
      </Field>
      <p class="faint">
        Widgets and each desk's identity colour pick one of these ten (widgets can also use AUTO =
        accent). The accent is used for highlights and selection.
      </p>
    </Panel>
  </Lockable>
</div>

<style>
  .look {
    height: 100%;
    padding: 16px 2ch 32px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-width: 110ch;
    margin: 0 auto;
  }
  p {
    margin: 0;
  }
</style>
