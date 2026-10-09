// Wires the tour (tour.svelte.ts) to the app: the workspace for the TUTORIAL desk, the UI's
// navigation, and the settings that remember the desk until the tour ends.
import { getSetting } from '../platform/settings';
import { persistSetting } from '../state/persist';
import { presetStore } from '../state/preset.svelte';
import { endEdit, showDesk, showGlobal, toggleEditMode, ui } from '../state/ui.svelte';
import { STEPS } from './steps';
import { Tour, type TourOps } from './tour.svelte';

const TUTORIAL_DESK = 'TUTORIAL';

const ops: TourOps = {
  blocked: () => ui.locked || ui.presenting,

  snapshot() {
    const desk = presetStore.activeId;
    const { view, deskView, globalView, mode, editPanel, infoOpen } = ui;
    const selected = [...ui.selected];
    const inspectorOpen = { ...ui.inspectorOpen };
    return () => {
      presetStore.activate(desk);
      Object.assign(ui, { view, deskView, globalView, editPanel, infoOpen, inspectorOpen });
      // Back in EDIT only on the desk's CONTROLS, where EDIT is.
      if (mode === 'edit' && view === 'desk' && deskView === 'controls') {
        ui.mode = 'edit';
        ui.selected = selected;
      } else endEdit();
    };
  },

  openDesk: () => presetStore.newDesk(TUTORIAL_DESK),

  removeDesk: (id) => presetStore.remove(id),

  apply(place, deskId) {
    presetStore.activate(deskId);
    if (place.view === 'global') {
      showGlobal(place.section);
      return;
    }
    showDesk(place.section);
    if (!place.edit) {
      endEdit();
      ui.infoOpen = true;
      return;
    }
    if (ui.mode !== 'edit') toggleEditMode();
    // The desk's first widget: a fader that sends, on the TUTORIAL desk (model/factory.ts).
    const first = presetStore.current.widgets[0];
    if (place.select && first) {
      presetStore.select(first.id);
      ui.editPanel = 'inspect';
    } else {
      presetStore.select(null);
      ui.editPanel = place.panel ?? 'add';
    }
    if (place.fold) ui.inspectorOpen[place.fold] = true;
  },

  remember: async (deskId) => void (await persistSetting('tourDesk', deskId)),
  recall: async () => (await getSetting('tourDesk')) ?? null,
};

export const tour = new Tour(STEPS, ops);
