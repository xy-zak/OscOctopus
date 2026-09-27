// PRESENTING keeps the active desk's widgets on screen: entering shows them live, and nothing
// but a desk tab can change what is shown until it ends.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  setPresenting,
  showDesk,
  showGlobal,
  showSectionAt,
  toggleEditMode,
  ui,
} from './ui.svelte';

beforeEach(() => {
  setPresenting(false);
  Object.assign(ui, {
    view: 'desk',
    deskView: 'controls',
    globalView: 'network',
    mode: 'live',
    selectedId: null,
    locked: false,
  });
});

describe('presenting', () => {
  it('shows the active desk’s controls, live, from anywhere', () => {
    Object.assign(ui, { view: 'global', deskView: 'network', mode: 'edit', selectedId: 'w1' });
    setPresenting(true);
    expect(ui).toMatchObject({
      presenting: true,
      view: 'desk',
      deskView: 'controls',
      mode: 'live',
      selectedId: null,
    });
  });

  it('refuses every other way to navigate, and edit mode', () => {
    setPresenting(true);
    showGlobal('sync');
    showSectionAt(2);
    showDesk('traffic');
    toggleEditMode();
    expect(ui).toMatchObject({ view: 'desk', deskView: 'controls', mode: 'live' });
    // A desk tab shows that desk's controls, which is allowed.
    showDesk();
    expect(ui).toMatchObject({ view: 'desk', deskView: 'controls' });
  });

  it('navigates normally again once it ends', () => {
    setPresenting(true);
    setPresenting(false);
    expect(ui).toMatchObject({ presenting: false, view: 'desk', deskView: 'controls' });
    showSectionAt(2);
    expect(ui.deskView).toBe('traffic');
    toggleEditMode();
    expect(ui).toMatchObject({ mode: 'edit', deskView: 'controls' });
    showGlobal('sync');
    expect(ui).toMatchObject({ view: 'global', globalView: 'sync' });
  });
});
