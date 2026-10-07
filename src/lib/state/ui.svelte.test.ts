// PRESENTING keeps the active desk's widgets on screen: entering shows them live, and nothing
// but a desk tab can change what is shown until it ends. FREEZE ends any edit in progress.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  confirmAction,
  setLocked,
  setPresenting,
  showDesk,
  showGlobal,
  showSectionAt,
  toggleEditMode,
  ui,
} from './ui.svelte';

beforeEach(() => {
  setPresenting(false);
  ui.confirm?.resolve(false);
  Object.assign(ui, {
    view: 'desk',
    deskView: 'controls',
    globalView: 'network',
    mode: 'live',
    selected: [],
    locked: false,
  });
});

describe('coming back to CONTROLS', () => {
  it('is LIVE after any other section, desk or global', () => {
    toggleEditMode();
    ui.selected = ['w1'];
    showDesk('traffic');
    expect(ui).toMatchObject({ mode: 'live', selected: [] });
    showDesk('controls');
    expect(ui).toMatchObject({ deskView: 'controls', mode: 'live' });

    toggleEditMode();
    showSectionAt(1);
    showSectionAt(0);
    expect(ui).toMatchObject({ deskView: 'controls', mode: 'live' });

    toggleEditMode();
    showGlobal('sync');
    showDesk();
    expect(ui).toMatchObject({ view: 'desk', deskView: 'controls', mode: 'live' });
  });

  it('keeps an edit while CONTROLS stay on screen', () => {
    toggleEditMode();
    ui.selected = ['w1'];
    showDesk('controls');
    showSectionAt(0);
    expect(ui).toMatchObject({ mode: 'edit', selected: ['w1'] });
  });

  it('still enters EDIT from another section (Alt+E)', () => {
    showDesk('traffic');
    toggleEditMode();
    expect(ui).toMatchObject({ deskView: 'controls', mode: 'edit' });
  });
});

describe('presenting', () => {
  it('shows the active desk’s controls, live, from anywhere', () => {
    Object.assign(ui, { view: 'global', deskView: 'network', mode: 'edit', selected: ['w1'] });
    setPresenting(true);
    expect(ui).toMatchObject({
      presenting: true,
      view: 'desk',
      deskView: 'controls',
      mode: 'live',
      selected: [],
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

describe('freeze', () => {
  it('leaves edit mode and cancels an open confirmation', async () => {
    Object.assign(ui, { mode: 'edit', selected: ['w1'] });
    const asked = confirmAction({ title: 'Delete', message: 'Sure?' });
    setLocked(true);
    expect(ui).toMatchObject({ locked: true, mode: 'live', selected: [], confirm: null });
    await expect(asked).resolves.toBe(false);
    toggleEditMode();
    expect(ui.mode).toBe('live');
  });

  it('unfreezes without touching anything else', () => {
    setLocked(true);
    ui.deskView = 'traffic';
    setLocked(false);
    expect(ui).toMatchObject({ locked: false, mode: 'live', deskView: 'traffic' });
    toggleEditMode();
    expect(ui.mode).toBe('edit');
  });
});
