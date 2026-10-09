// The tour's steps, as data: where the UI goes, what is highlighted and what the popup says.
// Show only: a step never waits for the user to do anything (tour.svelte.ts runs it, and
// views/Tour.svelte draws it). Each level walks the sections in order, finishing one before it
// moves to the next, so the tour never jumps back and forth.
//
// A target is a `data-tour` id in the markup (Panel, Collapsible and HoldSwitch take a `tour`
// prop for it); every element with it is highlighted together. steps.test.ts checks that each
// id exists somewhere in src, so renaming a hook without its step fails the tests. A step with
// no target, or whose target is not on screen (an empty state, a narrow layout), shows its popup
// in the middle.
import type { DeskView, EditPanel, GlobalView, InspectorSection } from '../state/ui.svelte';

export type Level = 'easy' | 'intermediate' | 'advanced';
export const LEVELS: readonly { id: Level; label: string }[] = [
  { id: 'easy', label: 'Easy' },
  { id: 'intermediate', label: 'Intermediate' },
  { id: 'advanced', label: 'Advanced' },
];

/** Where the UI must be before a step shows. Desk steps are on the TUTORIAL desk. */
export type Place =
  | {
      view: 'desk';
      section: DeskView;
      /** EDIT (default: LIVE). */
      edit?: boolean;
      panel?: EditPanel;
      /** Select the desk's first widget (and show INSPECT). */
      select?: boolean;
      /** An Inspector fold to unfold. */
      fold?: InspectorSection;
    }
  | { view: 'global'; section: GlobalView };

export interface TourStep {
  id: string;
  level: Level;
  title: string;
  body: string;
  at: Place;
  /** `data-tour` id(s) to highlight; none = a popup in the middle. */
  target?: string | readonly string[];
}

const controls: Place = { view: 'desk', section: 'controls' };
const adding: Place = { view: 'desk', section: 'controls', edit: true, panel: 'add' };
const inspecting: Place = { view: 'desk', section: 'controls', edit: true, select: true };
const messages: Place = { ...inspecting, fold: 'messages' };
const deskNetwork: Place = { view: 'desk', section: 'network' };
const deskTraffic: Place = { view: 'desk', section: 'traffic' };
const deskLook: Place = { view: 'desk', section: 'look' };
const deskSync: Place = { view: 'desk', section: 'sync' };
const network: Place = { view: 'global', section: 'network' };
const traffic: Place = { view: 'global', section: 'traffic' };
const library: Place = { view: 'global', section: 'library' };
const look: Place = { view: 'global', section: 'look' };
const sync: Place = { view: 'global', section: 'sync' };

export const STEPS: readonly TourStep[] = [
  // ---- EASY: a desk, its widgets, the switches up top, its look, saving and loading -------
  {
    id: 'welcome',
    level: 'easy',
    title: 'Welcome',
    body: 'This tour walks through the app on a TUTORIAL desk opened for it, and deleted when the tour ends: your own desks are left as they are. Where you are is always framed (the tab and the section) and named at the top of this box. ← → or the buttons move; a level on the bar below jumps to it; Esc leaves.',
    at: controls,
  },
  {
    id: 'desks',
    level: 'easy',
    title: 'Desks',
    body: 'Each tab is a desk: a page of controls with its own network. All open desks run at once; the tab only picks the one you see. + opens another: a new one, a copy of this one, or one saved before.',
    at: controls,
    target: ['desk-tab', 'add-desk'],
  },
  {
    id: 'frame',
    level: 'easy',
    title: 'The frame',
    body: 'Everything inside the coloured frame belongs to the tab it hangs from. These are the desk’s sections, F1 to F5: you are in F1 CONTROLS.',
    at: controls,
    target: 'sections',
  },
  {
    id: 'controls',
    level: 'easy',
    title: 'Controls',
    body: 'CONTROLS is where you play. Each widget sends OSC messages as you move it: faders, buttons, switches, pads, graphs and more.',
    at: controls,
    target: 'desk',
  },
  {
    id: 'info',
    level: 'easy',
    title: 'Info',
    body: 'INFO, beside the desk, shows the widget you touched last: its value, the messages it sends and receives, and what it did recently.',
    at: controls,
    target: 'side-panel',
  },
  {
    id: 'readouts',
    level: 'easy',
    title: 'Status',
    body: 'The top right is for every desk at once. OUT counts the outputs ready to send, SYNC the devices this one shares with. Click either to open its settings.',
    at: controls,
    target: ['out-readout', 'sync-readout'],
  },
  {
    id: 'osc-io',
    level: 'easy',
    title: 'OSC-IN and OSC-OUT',
    body: 'OSC-OUT lets every desk send; off, nothing leaves the app. OSC-IN lets received OSC move widgets. Both change only after a one-second hold, so a stray touch can’t flip them.',
    at: controls,
    target: ['osc-in', 'osc-out'],
  },
  {
    id: 'show',
    level: 'easy',
    title: 'For the show',
    body: 'FREEZE locks widgets and settings with one click. PRESENT (F11) fills the screen with this desk’s widgets alone. To undo either, hold it for a second.',
    at: controls,
    target: ['freeze', 'present'],
  },
  {
    id: 'edit',
    level: 'easy',
    title: 'Edit mode',
    body: 'EDIT (Alt+E), at the end of the section bar, turns the desk from playing to building. Next: the desk in EDIT.',
    at: controls,
    target: 'desk-switches',
  },
  {
    id: 'add',
    level: 'easy',
    title: 'Adding widgets',
    body: 'Now in EDIT. ADD lists every kind of widget: click one to put it in the first free spot, or drag it onto the desk.',
    at: adding,
    target: 'add-panel',
  },
  {
    id: 'inspect',
    level: 'easy',
    title: 'Inspect',
    body: 'Click a widget to INSPECT it: its look, how it behaves and its messages. Drag a widget to move it, pull its edge to resize it, Shift+click to select several.',
    at: inspecting,
    target: 'inspector',
  },
  {
    id: 'desk-look',
    level: 'easy',
    title: 'A desk’s look',
    body: 'F4 LOOK is this desk’s alone: its name, its colour (the tab and the frame), and a palette and skin of its own if you want one.',
    at: deskLook,
    target: 'desk-look',
  },
  {
    id: 'saving',
    level: 'easy',
    title: 'Saving',
    body: 'Desks save themselves as you go. Export… writes a copy of this one, to share or keep; Import… loads a desk file into it.',
    at: deskLook,
    target: 'desk-preset',
  },
  {
    id: 'global',
    level: 'easy',
    title: 'Global settings',
    body: 'GLOBAL SETTINGS, the last tab, holds what belongs to no single desk. Its frame is white, so you can tell at a glance which you are in.',
    at: library,
    target: 'global-tab',
  },
  {
    id: 'loading',
    level: 'easy',
    title: 'Loading',
    body: 'F3 LIBRARY lists every desk saved on this device: open one as a tab, import a desk file, or delete one for good.',
    at: library,
    target: 'library-desks',
  },

  // ---- INTERMEDIATE: a desk's network and traffic, every desk's, then the look ------------
  {
    id: 'scopes',
    level: 'intermediate',
    title: 'This desk or all desks',
    body: 'Back on the desk. NETWORK, TRAFFIC, LOOK and SYNC are both here and in GLOBAL SETTINGS: in the desk’s colour they are about this desk, in white about all of them. This level goes through both.',
    at: controls,
    target: 'sections',
  },
  {
    id: 'outputs',
    level: 'intermediate',
    title: 'Outputs',
    body: 'F2 NETWORK: where this desk’s messages go. An output is an address and a port, over UDP (to one device, broadcast or multicast) or TCP.',
    at: deskNetwork,
    target: 'outputs',
  },
  {
    id: 'output-settings',
    level: 'intermediate',
    title: 'Output settings',
    body: 'Each output can be switched off on its own, send from a chosen interface and source port, and for TCP set how messages are framed and how soon it reconnects.',
    at: deskNetwork,
    target: 'outputs',
  },
  {
    id: 'inputs',
    level: 'intermediate',
    title: 'Inputs',
    body: 'An input is a port this desk listens on. What arrives always shows in TRAFFIC, and can move widgets (that is in ADVANCED).',
    at: deskNetwork,
    target: 'inputs',
  },
  {
    id: 'apply',
    level: 'intermediate',
    title: 'Applied',
    body: 'Network changes apply as you make them: this line says when they last did, or why they failed. Re-apply applies them again.',
    at: deskNetwork,
    target: 'network-apply',
  },
  {
    id: 'desk-traffic',
    level: 'intermediate',
    title: 'Traffic',
    body: 'F3 TRAFFIC lists every message this desk sends and receives, with its exact bytes. Click one to take it apart.',
    at: deskTraffic,
    target: 'traffic-list',
  },
  {
    id: 'traffic-tools',
    level: 'intermediate',
    title: 'Narrowing it down',
    body: 'PAUSE holds the list still while traffic flows on; FOLLOW keeps the newest in view. Show only what goes out or comes in, packets, errors, or what OSC-OUT held back.',
    at: deskTraffic,
    target: 'traffic-toolbar',
  },
  {
    id: 'traffic-counts',
    level: 'intermediate',
    title: 'Counts',
    body: 'Along the bottom, what each output and input sent and received, its errors and bytes. The rate in messages per second is above the list.',
    at: deskTraffic,
    target: 'traffic-counters',
  },
  {
    id: 'all-endpoints',
    level: 'intermediate',
    title: 'Every desk’s network',
    body: 'GLOBAL SETTINGS › F1 NETWORK has every open desk’s outputs and inputs in one table. Click a desk’s name to go to its own NETWORK.',
    at: network,
    target: 'all-endpoints',
  },
  {
    id: 'interfaces',
    level: 'intermediate',
    title: 'Interfaces',
    body: 'Below it, this device’s network interfaces: the addresses to send from, listen on or broadcast to.',
    at: network,
    target: 'interfaces',
  },
  {
    id: 'all-traffic',
    level: 'intermediate',
    title: 'All traffic',
    body: 'F2 TRAFFIC here is every desk together. Pick one desk, or one of its outputs or inputs, to narrow it down.',
    at: traffic,
    target: 'traffic-toolbar',
  },
  {
    id: 'background',
    level: 'intermediate',
    title: 'Dark or light',
    body: 'F4 LOOK sets the look of every desk. First the background: dark, or light for a bright room.',
    at: look,
    target: 'bg-all',
  },
  {
    id: 'palette',
    level: 'intermediate',
    title: 'Palette',
    body: 'The palette: nine colours and an accent, which widgets and desk tabs are coloured from.',
    at: look,
    target: 'palette-all',
  },
  {
    id: 'active',
    level: 'intermediate',
    title: 'Active colour',
    body: 'The ACTIVE colour marks what is on, pressed, filled or held: any colour of the palette, or one of your own.',
    at: look,
    target: 'active-all',
  },
  {
    id: 'skin',
    level: 'intermediate',
    title: 'Skins',
    body: 'A skin is how widgets are drawn, from a plain terminal to hardware, neon or hand-sketched. A desk can still pick its own palette, colour and skin in its LOOK.',
    at: look,
    target: 'skin-all',
  },

  // ---- ADVANCED: your own look, projects, sync, then driving widgets with OSC --------------
  {
    id: 'custom-palette',
    level: 'advanced',
    title: 'Your own palette',
    body: 'Still in LOOK. New palette makes one from a single colour of your choice; each of its colours can then be changed. It is listed with the others, for every desk.',
    at: look,
    target: 'new-palette',
  },
  {
    id: 'own-skin',
    level: 'advanced',
    title: 'Your own skin',
    body: 'Import skin… adds a skin file made on another device or shared with you. A skin is a file you can write yourself (docs/SKINS.md).',
    at: look,
    target: 'import-skin',
  },
  {
    id: 'projects',
    level: 'advanced',
    title: 'Projects',
    body: 'F3 LIBRARY › Projects saves the whole setup in one go: the open desks with their networks, the one shown, and the look. Load one to get all of it back.',
    at: library,
    target: 'projects',
  },
  {
    id: 'project-save',
    level: 'advanced',
    title: 'Saving a project',
    body: 'Name it and Save project. Export… on a project writes it to a file; Import project… brings one in from another machine.',
    at: library,
    target: 'project-save',
  },
  {
    id: 'sync-device',
    level: 'advanced',
    title: 'Sync: this device',
    body: 'F5 SYNC shares desks live with other devices. This name and colour are how the others see this device; compare the fingerprint to know who is who.',
    at: sync,
    target: 'sync-device',
  },
  {
    id: 'session',
    level: 'advanced',
    title: 'Sessions',
    body: 'Join a session: the same name and key on every device. The key never leaves this device.',
    at: sync,
    target: 'sync-session',
  },
  {
    id: 'connection',
    level: 'advanced',
    title: 'Connection',
    body: 'Devices on the same network find each other by themselves. Where they can’t, add one by its address and listen port.',
    at: sync,
    target: 'sync-connection',
  },
  {
    id: 'devices',
    level: 'advanced',
    title: 'Devices',
    body: 'Every device in the session and how it is connected. One you don’t trust can be blocked.',
    at: sync,
    target: 'sync-devices',
  },
  {
    id: 'share',
    level: 'advanced',
    title: 'Sharing a desk',
    body: 'Back on the desk, F5 SYNC shares it with the session: everyone sees it, plays it and edits it live. Earlier versions can be brought back.',
    at: deskSync,
    target: 'desk-share',
  },
  {
    id: 'receive-input',
    level: 'advanced',
    title: 'Driving widgets with OSC',
    body: 'Widgets can be moved by OSC from outside too. It starts here in F2 NETWORK, with an input: a port this desk listens on.',
    at: deskNetwork,
    target: 'inputs',
  },
  {
    id: 'receive',
    level: 'advanced',
    title: 'Receiving',
    body: 'Then, in EDIT, a widget’s messages: turn on IN, and a matching message arriving on that input sets the widget.',
    at: messages,
    target: 'messages',
  },
  {
    id: 'forward',
    level: 'advanced',
    title: 'Forwarding',
    body: 'With IN on, FORWARD also re-sends what was received to the widget’s outputs, to bridge two systems. It stops by itself if messages loop back.',
    at: messages,
    target: 'messages',
  },
  {
    id: 'osc-in',
    level: 'advanced',
    title: 'The input gate',
    body: 'OSC-IN is the gate for all of it, on every desk: off, received OSC moves nothing (TRAFFIC still shows it).',
    at: messages,
    target: 'osc-in',
  },
  {
    id: 'keys',
    level: 'advanced',
    title: 'Keys',
    body: 'F1–F5 open sections. Alt+1…9 opens a desk, Alt+0 GLOBAL SETTINGS, Alt+[ and Alt+] the desk before or after. Alt+E is EDIT, F11 PRESENT, Alt+L FREEZE. Hold Alt+I or Alt+P for a second for OSC-IN or OSC-OUT, and Alt+L to unfreeze.',
    at: messages,
  },
  {
    id: 'done',
    level: 'advanced',
    title: 'That’s it',
    body: 'One rule finds everything: a desk’s own settings are in its tab, in its colour; what is for every desk is in GLOBAL SETTINGS, in white. Done closes the TUTORIAL desk and takes you back. The tour stays in ABOUT (the octopus, top left).',
    at: messages,
  },
];

/** Each level's first step and its number of steps, in order. Steps are grouped by level. */
export function levelRanges(
  steps: readonly TourStep[],
): { level: Level; start: number; count: number }[] {
  return LEVELS.map(({ id }) => {
    const start = steps.findIndex((s) => s.level === id);
    return { level: id, start, count: steps.filter((s) => s.level === id).length };
  });
}

/** The `data-tour` ids a step highlights. */
export function targetsOf(step: TourStep): readonly string[] {
  return step.target === undefined
    ? []
    : typeof step.target === 'string'
      ? [step.target]
      : step.target;
}

/** Where a step is, as a key: two steps with the same key show the same page. */
export function placeKey(at: Place): string {
  return at.view === 'global'
    ? `global/${at.section}`
    : `desk/${at.section}/${at.edit ? 'edit' : 'live'}`;
}
