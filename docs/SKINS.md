# Making a widget skin

A **skin** decides how OscOctopus widgets are drawn: their lines, fills, shapes, shadows and
motion. The app ships twelve skins:

- TERMINAL: pixel lines, the original look;
- GLASS: tinted rounded panes;
- SKETCH: coloured pencil;
- WOBBLY: clean, every line an even wave;
- PIXELATED: an 8-bit game screen;
- HARDWARE: a mixing desk, with metal panels, rubber keys and ridged fader caps;
- NEON: glowing tubes;
- BLUEPRINT: a technical drawing;
- BRUTALIST: thick borders, hard offset shadows, flat blocks of colour;
- LED MATRIX: a grid of round LEDs;
- CRT: an old monitor, with scanlines and phosphor glow;
- ARCADE: a cabinet panel of domed buttons and ball-top levers.

A skin is chosen in GLOBAL SETTINGS › LOOK, and a desk can have its own in DESK › LOOK.

This guide is written so that a person, or an LLM pointed at this file, can make a new
built-in skin that fits in. Read the whole of *The contract* before writing any CSS.

## The contract: what a skin may and may not change

**A skin may change** (on the widgets only):

- **Colour, through the colour roles.** The palette and light/dark mode then still apply.
- **Lines:** border width, style and colour, and outlines drawn with masks (see *Recipes*).
- **Fills:** solid colour, dithers, hatching, gradients, textures.
- **Shapes:** corner radius, and the geometry tokens (thumb and cap sizes, gaps, insets).
- **Depth:** shadows, highlights, glows.
- **Motion:** transitions and keyframes (e.g. `steps()` versus smooth easing).
- **Keys:** whether they stand out of the panel (`keycap: 'bevel'`) or are flat
  (`keycap: 'flat'`).

**A skin may not change**. These stay the same in every skin, so a desk reads the same whatever
it wears:

1. **Typography.** Use the app's one font and one size (a Text widget's own size, which
   base.css sets, is the one exception). The weights and case of titles, values, legends, pad
   numbers, list options, log headings and text marks are set once in `src/lib/skins/base.css`. So never use
   `font-*`, `text-transform`, `letter-spacing`, `line-height`, `text-align`, `writing-mode` or
   `@font-face` in a skin.
2. **Where titles and values go.** `WidgetFrame` sets them into the frame's border, horizontal
   if they fit, vertical along the side otherwise (`src/lib/widgets/labels.ts`). A skin
   colours them and gives them a background patch. It never moves, resizes or hides them.
3. **The markers:**
   - the fader's scale: long marks at 0/50/100%, short at 25/75%;
   - the switch's ON / OFF legend;
   - the pad numbers;
   - the graph's axis labels and its quarter lines;
   - the list's `▸`;
   - the sequencer's key legends (▶ START, ■ STOP, ❚❚ PAUSE, ▶ PLAY);
   - a Text widget's text, and a Log's cells.

   base.css draws the fader scale, and a skin only colours it with `--slider-tick-c`. A skin may
   restyle the other markers, but never hide or move any of them. The graph's quarter lines
   are the skin's to draw: keep them at 25/50/75%.
4. **The desk's background** stays plain `--bg` (near-black, or the light-mode paper). No skin
   rule reaches outside its own widgets.

`src/lib/skins/anatomy.test.ts` (run with `npm test`) enforces 1, 2 and the hiding part of 3.
It fails on typography properties, on anything that hides, moves or resizes a marker, and on
any selector not keyed on the skin's own frames. The graph's quarter lines can't be checked
automatically; check them by eye in the gallery.

## How skins work

### Parts and states

Every widget is split into named **parts**, and every change of look is a **state**. Both are
listed in [`src/lib/skins/anatomy.ts`](../src/lib/skins/anatomy.ts), which is the source of
truth. Components mark each part with `data-part="<name>"` and each state with a
`data-<state>` attribute. A state attribute sits in one of three places:

- **frame:** on the widget's root, e.g. `.frame[data-on]` when a switch is on;
- **self:** on the part itself, e.g. `[data-part='pads.pad'][data-on]` for a lit pad;
- **key:** on the enclosing key, e.g. `[data-part='keycap'][data-down]` for a pressed key.

| Widget | Parts (states) |
| --- | --- |
| every widget | `frame` (active, pressed, lifted†, live), `frame.body`, `frame.title` (active), `frame.status` (active) |
| keys (Button, Pads) | `keycap` (down), `keycap.wall` (`data-side` top/left/right/bottom; bevel keys only), `keycap.edges` (SVG lines; bevel only), `keycap.face` (down) |
| Button | `button.key` (frame: lit, armed, holding), `button.fill` (on, flash), `button.armed`, `button.hold` (animate `clip-path` with `var(--hold)` as the duration), `button.hint` |
| Switch | `switch.track`, `switch.legend` (`data-side` off/on), `switch.tag`, `switch.thumb`, `switch.grip`. States on the frame: on, dragging, vertical |
| Fader | `slider.rail`, `slider.ticks`, `slider.track`, `slider.fill`, `slider.cap`, `slider.grip`. States on the frame: dragging, vertical |
| Graph | `graph.plot`, `graph.grid`, `graph.trail` (fading), `graph.dot`, `graph.cross` (`data-axis` x/y), `graph.cursor`, `graph.lock`, `graph.tick` (`data-at` x-min/x-max/y-max). States on the frame: dragging |
| Pads | `pads.grid`, `pads.pad` (on), `pads.fill` (on, flash), `pads.num` (on) |
| List | `list.options`, `list.option` (current, held), `list.fill` (held, flash), `list.mark` (current), `list.text` (current, held). States on the frame: horizontal |
| Sequencer | `sequencer.timer` (the wait bar), `sequencer.elapsed` (its fill: base.css times it, a skin paints it), `sequencer.keys`, `sequencer.key` (`data-role` play/pause; each holds a `keycap`), `sequencer.fill` (on, flash), `sequencer.legend`, `sequencer.steps`, `sequencer.step` (current). States on the frame: running, paused |
| Text | `text.body` (`data-align`, `data-valign`; its size is fitted to the box, not a skin's), `text.block` (`data-kind` line/heading/item/gap), `text.run` (strong, reverse, tinted) |
| Log | `log.head`, `log.rows`, `log.row` (in, out, error, blocked), `log.cell` (`data-col` time, dir, widget, …), `log.empty` |
| Sub-desk | `subdesk.tabs`, `subdesk.tab` (current), `subdesk.text` (current), `subdesk.page` (the slot its page is drawn over: the page's widgets are not inside its frame), `subdesk.empty` |

† `lifted` is set on an ancestor while the widget is dragged in EDIT: style it as
`[data-lifted] .frame[data-base='<id>']`.

An item's states (a pad's `on`, an option's `current` and `held`) are on the item and on each
of its parts, so `[data-part='list.text'][data-current]` works as well as
`[data-part='list.option'][data-current] [data-part='list.text']`.

`flash` marks a release animation that restarts each time: the element is re-created, so a
keyframe animation on `[data-flash]` plays once per release.

### Colour roles

These are set on every frame by base.css. Build your colours from them, never from raw
colours, or the palette, the widget's own colour and light mode stop working.

| Role | Use |
| --- | --- |
| `--c` | the widget's own palette colour: lines, dots, tints |
| `--c-solid` | `--c` faded into the background: solid areas (faces, blocks, caps) |
| `--c-ink` | text on `--c-solid` |
| `--c-text` | `--c` as text (darkened in light mode) |
| `--w-bg` | the widget's neutral background |
| `--act`, `--act-ink` | the ACTIVE colour (pressed, on, held) and text on it: green by default, but any colour a desk's look picks, so never assume green |
| `--dither-50-act`, `--dither-25-act`, `--dither-25-c` | ready-made dither fills |
| `--bg`, `--bg-2`, `--fg`, `--fg-dim`, `--fg-faint`, `--line`, `--shadow-px` | the app's base colours (they flip with light/dark) |

Mix them freely, e.g. `color-mix(in srgb, var(--c) 30%, transparent)`. **ACTIVE must look
active in every skin:** whatever is pressed, on, lit or held uses `--act`.

### Tokens

Geometry a skin may change, set on the frame (defaults in `TOKENS` in anatomy.ts):

- frame insets: `--frame-inset-t/-x/-b`;
- switch: `--switch-inset`, `--switch-thumb-len`;
- fader: `--slider-cap-len`, `--slider-track-w`, `--slider-tick-c` (the scale's colour);
- graph: `--graph-cursor`, `--graph-dot`, `--graph-lock-inset`;
- pads and list: `--pads-gap`, `--list-gap`, `--list-row-h`;
- sequencer: `--seq-timer-h` (the wait bar's height), `--seq-gap` (between its keys),
  `--seq-steps-h`, `--seq-step-gap`;
- text: `--text-c` (its text colour: base.css draws reverse video and tints from it);
- log: `--log-row-h`;
- sub-desk: `--subdesk-tabs-h` (the tab strip's height), `--subdesk-tab-gap`.

Components use these in their own layout, so changing a token moves the part *and* keeps
pointer maths right. For example, the switch measures its thumb to work out the drag travel.

### Cascade layers

Declared at the top of `src/app.css`, lowest first:

```
reset         element resets
skin.base     base.css: colour roles, typography, markers, reduced motion
skin.builtin  terminal.css, glass.css, sketch.css, …: your skin goes here
skin.user     (reserved for user-made skins)
```

Unlayered CSS beats every layer. That's why widget components contain only layout, and why
your whole skin must sit inside `@layer skin.builtin { … }`.

### Keying

Every rule starts from the skin's frames: `.frame[data-base='<id>']`, with state attributes on
it (`.frame[data-base='<id>'][data-on]`) or on descendants
(`.frame[data-base='<id>'] [data-part='pads.pad'][data-on]`). Two exceptions, still keyed:
`:root[data-mode='light'] .frame[data-base='<id>']` for light mode, and
`[data-lifted] .frame[data-base='<id>']`.

## Making a built-in skin, step by step

Say the new skin is `chalk`.

1. **Register it** in `src/lib/skins/builtin.ts`:
   - add `'chalk'` to `BUILTIN_SKIN_IDS`;
   - add an entry to `BUILTIN_SKINS`:

     ```ts
     chalk: {
       id: 'chalk',
       name: 'CHALK', // short, uppercase, like palette names
       base: 'chalk',
       note: 'Chalk on a blackboard', // what it looks like, shown in the picker
       params: { keycap: 'flat' }, // or 'bevel' for keys with walls
     },
     ```
2. **Create `src/lib/skins/chalk.css`** from the template below, and import it in `src/app.css`
   after the other skins: `@import './lib/skins/chalk.css';`.
3. **Style every part in every state it has** (the table above). Work through the gallery (see
   *Checking it*) and look at each scenario. The easiest start is a copy of `terminal.css`
   with every `data-base='terminal'` replaced, then changed part by part.
4. **Light mode:** add `:root[data-mode='light'] .frame[data-base='chalk']` rules where raw
   colours (white highlights, black shadows) would look wrong on the light background.
5. **Motion:** give every animation and keyframe a skin prefix (`@keyframes chalk-flash`) so it
   can't collide with another skin's. Reduced motion is handled for you by base.css: it stops
   `[data-flash]` animations, the armed blink and the trail fade.
6. **Check it** (below), then add it to the screenshot baseline.

### Template

```css
/* CHALK: <one line on the look>. Every rule is keyed on .frame[data-base='chalk']. Parts and
   states: skins/anatomy.ts; the rules every skin keeps: docs/SKINS.md. */
@layer skin.builtin {
  /* frame: set tokens and the pane itself */
  .frame[data-base='chalk'] {
    --slider-tick-c: color-mix(in srgb, var(--fg) 40%, transparent);
    border: 1px solid var(--c);
    background: var(--w-bg);
    transition: border-color 150ms ease;
  }
  .frame[data-base='chalk'][data-active] { border-color: var(--act); }
  .frame[data-base='chalk'][data-pressed] { scale: 0.98; }
  [data-lifted] .frame[data-base='chalk'] { box-shadow: 0 12px 24px rgb(0 0 0 / 0.5); }
  /* labels sit on the border: give them a patch of the desk's colour to cut the line */
  .frame[data-base='chalk'] [data-part='frame.title'],
  .frame[data-base='chalk'] [data-part='frame.status'] { background: var(--bg); }
  .frame[data-base='chalk'] [data-part='frame.title'] { color: var(--fg); }
  .frame[data-base='chalk'][data-active] [data-part='frame.title'] { color: var(--act); }
  .frame[data-base='chalk'] [data-part='frame.status'] { color: var(--fg-dim); }

  /* keys (Button, Pads) */
  .frame[data-base='chalk'] [data-part='keycap.face'] { background: var(--c-solid); }
  .frame[data-base='chalk'] [data-part='keycap'][data-down] [data-part='keycap.face'] { scale: 0.96; }

  /* button: fill while pressed, a release animation, armed and hold */
  .frame[data-base='chalk'] [data-part='button.fill'][data-on] { background: var(--act); }
  .frame[data-base='chalk'] [data-part='button.fill'][data-flash] { animation: chalk-fade 300ms ease-out forwards; }
  @keyframes chalk-fade { from { background: var(--act); } to { background: transparent; } }
  .frame[data-base='chalk'] [data-part='button.armed'] { background: var(--dither-50-act); }
  .frame[data-base='chalk'] [data-part='button.hold'] { background: var(--act); animation: chalk-hold var(--hold) linear forwards; }
  @keyframes chalk-hold { from { clip-path: inset(100% 0 0 0); } to { clip-path: inset(0); } }
  .frame[data-base='chalk'] [data-part='button.hint'] { color: var(--c-ink); }

  /* switch */
  .frame[data-base='chalk'] [data-part='switch.track'] { border: 1px solid var(--c); }
  .frame[data-base='chalk'][data-on] [data-part='switch.track'] { border-color: var(--act); }
  .frame[data-base='chalk'] [data-part='switch.legend'][data-side='off'] { color: var(--c-text); }
  .frame[data-base='chalk'] [data-part='switch.legend'][data-side='on'] { color: var(--act); }
  .frame[data-base='chalk'] [data-part='switch.thumb'] { background: var(--c-solid); color: var(--c-ink); transition: transform 180ms ease; }
  .frame[data-base='chalk'][data-on] [data-part='switch.thumb'] { background: var(--act); color: var(--act-ink); }
  .frame[data-base='chalk'][data-dragging] [data-part='switch.thumb'] { transition: none; }

  /* fader (the scale is drawn for you; colour it with --slider-tick-c above) */
  .frame[data-base='chalk'] [data-part='slider.track'] { border: 1px solid var(--c); }
  .frame[data-base='chalk'] [data-part='slider.fill'] { background: var(--act); transition: clip-path 180ms ease; }
  .frame[data-base='chalk'][data-dragging] [data-part='slider.fill'] { transition: none; }
  .frame[data-base='chalk'] [data-part='slider.cap'] { background: var(--c-solid); transition: transform 180ms ease; }
  .frame[data-base='chalk'][data-dragging] [data-part='slider.cap'] { background: var(--act); transition: none; }
  .frame[data-base='chalk'] [data-part='slider.grip'] { width: 1px; height: 60%; background: var(--c-ink); }
  .frame[data-base='chalk'][data-vertical] [data-part='slider.grip'] { width: 60%; height: 1px; }

  /* graph: keep quarter lines at 25/50/75% */
  .frame[data-base='chalk'] [data-part='graph.plot'] { --paper: var(--bg-2); background: var(--paper); border: 1px solid var(--c); }
  .frame[data-base='chalk'] [data-part='graph.grid'] {
    background:
      linear-gradient(to right, color-mix(in srgb, var(--c) 40%, transparent) 1px, transparent 1px) 0 0 / 25% 100%,
      linear-gradient(to bottom, color-mix(in srgb, var(--c) 40%, transparent) 1px, transparent 1px) 0 0 / 100% 25%;
  }
  .frame[data-base='chalk'] [data-part='graph.cross'] { background: var(--act); }
  .frame[data-base='chalk'] [data-part='graph.cursor'] { background: var(--act); }
  .frame[data-base='chalk'] [data-part='graph.lock'] { border: 1px solid var(--fg); opacity: 0; }
  .frame[data-base='chalk'][data-dragging] { --graph-lock-inset: -6px; }
  .frame[data-base='chalk'][data-dragging] [data-part='graph.lock'] { opacity: 1; }
  .frame[data-base='chalk'] [data-part='graph.trail'][data-fading] { opacity: 0; transition: opacity 400ms ease; }
  .frame[data-base='chalk'] [data-part='graph.dot'] { background: var(--act); }
  .frame[data-base='chalk'] [data-part='graph.tick'] { color: var(--c-text); background: var(--paper); }

  /* pads */
  .frame[data-base='chalk'] [data-part='pads.pad'][data-on] [data-part='pads.fill'] { background: var(--act); }
  .frame[data-base='chalk'] [data-part='pads.fill'][data-flash] { animation: chalk-fade 300ms ease-out forwards; }
  .frame[data-base='chalk'] [data-part='pads.num'] { color: var(--c-ink); }
  .frame[data-base='chalk'] [data-part='pads.pad'][data-on] [data-part='pads.num'] { color: var(--act-ink); }

  /* list */
  .frame[data-base='chalk'] [data-part='list.option'] { background: var(--c-solid); color: var(--fg-dim); }
  .frame[data-base='chalk'] [data-part='list.option'][data-current] { color: var(--c-ink); }
  .frame[data-base='chalk'] [data-part='list.option'][data-held] { color: var(--act-ink); }
  .frame[data-base='chalk'] [data-part='list.option'][data-held] [data-part='list.fill'] { background: var(--act); }
  .frame[data-base='chalk'] [data-part='list.fill'][data-flash] { animation: chalk-fade 300ms ease-out forwards; }
}
```

Prettier will spread this over more lines; that's fine.

## Recipes

- **Rounded pill switch** (GLASS): `border-radius: 999px` on `switch.track` and
  `switch.thumb`, and a square thumb:
  - `--switch-thumb-len: calc(100cqh - 2 * var(--switch-inset))`;
  - on `[data-vertical]`, `calc(100cqw - …)`.

  The track is a size container, so `cq` units are its own size.
- **Round knob bigger than the track** (GLASS fader): leave `slider.cap` transparent and draw
  the knob as `slider.cap::before` (`width: min(22px, 100%)`, `aspect-ratio: 1`,
  `border-radius: 50%`). The cap already centres its content.
- **Hand-drawn outlines in the widget colour** (SKETCH): draw the line art as a black-on-
  transparent SVG, then use it as a *mask* on a pseudo-element with `background: var(--c)`.
  - Nine-slice: `-webkit-mask-box-image: url(…) 20 / 20px round`.
  - Otherwise: `-webkit-mask`, plus `mask`, with `url(…) center / contain no-repeat`.
  - Put it on `::before` (under the part's contents) or `::after` (over them). **Never mask a
    part itself**, which clips everything inside it.
  - Keep assets in `src/assets/skins/<id>/` and reference them relatively from the CSS.
- **Even wavy lines** (WOBBLY): make the nine-slice source's edge segments hold *whole* wave
  periods and tile them with `round` (`-webkit-mask-box-image: url(box.svg) 12 / 12px round`):
  the browser fits a whole number of tiles along each edge, so the waves stay even at any size.
  Grooves and grid lines tile a wave strip (`wave-h.svg`, `repeat-x`) the same way. Generate
  such art from a sine rather than drawing it.
- **Chunky pixels** (PIXELATED): one pixel size (`--px`) for every border, bevel, dither tile and
  shadow. Notched corners are squares of `var(--bg)` painted over the border's corners, which
  works because the desk is always plain `--bg`.
- **A knob in the fader cap** (GLASS, WOBBLY): position it absolutely at the cap's centre
  (`top: 50%; left: 50%; translate: -50% -50%`). As a grid item next to the (hidden) grip, the
  cap's grid would split it into rows and lift it off the track.
- **Room for a shadow or ring outside a key** (BRUTALIST, ARCADE): give `keycap.face` a
  `margin`. The widget's inside clips anything past its edge, and `inset` can't be changed: a
  component's own layout CSS is unlayered, so it beats every skin.
- **Solid-looking materials** (HARDWARE): metal is a few-stop `linear-gradient`, ridges a
  `repeating-linear-gradient` over it, a lit edge an `inset 0 1px 0` white shadow; turn the
  ridges with `[data-vertical]`.
- **Glow** (NEON, CRT): the same colour as a blurred `box-shadow` outside and `inset`, plus
  `text-shadow` on text. Keep the blur smaller in light mode, where glow reads as smudge.
- **Scanlines** (CRT): `repeating-linear-gradient(to bottom, rgb(0 0 0 / 0.25) 0 1px,
  transparent 1px 3px)` as the top background layer of each surface. It sits under the text, so
  labels stay sharp. Don't lay it over the whole widget.
- **A dot matrix** (LED MATRIX): `radial-gradient(circle, <colour> 1.5px, transparent 2px) 0 0 /
  5px 5px`, one variable per colour (unlit, widget colour, text colour, ACTIVE).
- **Registration marks and centre lines** (BLUEPRINT): corner crosses are eight small
  `linear-gradient` bars on the frame's `::before` (`inset: -6px`); a dash-dot line is a
  `repeating-linear-gradient` of an 8px dash, a gap, a 1px dot and a gap.
- **Domes** (ARCADE): `radial-gradient(circle at 38% 30%, <light>, <colour> 42%, <dark>)`.
- **Hatching:** `repeating-linear-gradient(-45deg, <colour> 0 1.5px, transparent 1.5px 5px)`;
  add a second at `45deg` for cross-hatching.
- **Glow for active:**
  `box-shadow: 0 0 18px -2px color-mix(in srgb, var(--act) 70%, transparent)`.
- **Text on a busy fill** (hatching, dithers): `text-shadow` with a halo of `var(--bg)` keeps it
  readable. That's colour, not typography, so it's allowed.
- **Label patches:** titles and values sit on the border line. Give them `background: var(--bg)`
  (the desk's colour) so they cut the line cleanly. A `border-radius` on the patch is fine.

**Traps:**
- **Only the last background layer may be a colour.** `background: var(--dots), var(--halo),
  var(--panel)` with a colour in `--halo` is invalid, and the part draws nothing. Wrap it:
  `linear-gradient(var(--halo), var(--halo))`.
- **A variable made of other variables resolves where it is declared.** Declared on the frame,
  `--dome: radial-gradient(… var(--tint) …)` uses the frame's `--tint`; setting `--tint` on a
  child doesn't change it. Declare one finished variable per colour on the frame
  (ARCADE's `--ar-dome` and `--ar-dome-act`).
- **Release backgrounds belong in the keyframes.** `[data-flash]` stays on the element after
  the animation, and reduced motion switches the animation off: a background set on the rule
  itself would stay lit. Put it in the keyframe steps only.
- **Light mode washes out pale widget colours.** For lines and text, use an "ink" variable that
  is `--c` in dark mode and `--c-text` in light mode (BLUEPRINT's `--bp-ink`, LED MATRIX's
  `--led-ink`). A part that stays dark in both modes (HARDWARE's XY screen) needs light text in
  both.

**Don't:**
- use `backdrop-filter` (the background is plain, so it costs speed and shows nothing);
- use live SVG `filter:url()` effects on widgets (redrawn on the CPU on every change);
- set `display` or `visibility` on markers;
- give `text.body`, `text.run` or `log.row` a `color` of their own: a skin always beats
  base.css, which colours text marks (through `--text-c`) and a log's error and held rows.
  Set `--text-c`, and colour only `log.row[data-in]` (received rows can't be errors);
- style anything outside `.frame[data-base='<id>']`.

## Checking it

1. `npm run dev`, then open **`/src/dev/gallery/?skin=neon`**, and again with `&mode=light`.
   This is every widget in every state and several sizes: pressed, dragged, armed, holding,
   lit, flashing, vertical and horizontal. Compare with `?skin=terminal`. In each shot, check:
   - the title and value are in the same place;
   - the fader scale, ON/OFF, pad numbers, `▸` and the graph's quarter lines are all there;
   - ACTIVE is the ACTIVE colour: green, and another with `&active=3cb4ff` (a hex code without
     `#`; this one is next to a widget's own, to be sure the two still tell apart).
2. `npm test`. `anatomy.test.ts` checks the contract and that you only used known part names.
3. `npm run shots -- compare`. It shoots every skin and compares against `.shots/baseline`:
   - the other skins must show **no differences**;
   - it only compares the shots the baseline has, so yours (or a new scenario) isn't listed:
     `npm run shots -- compare current baseline` lists every shot the baseline lacks. Look
     through `.shots/current/neon/`, then add them with `npm run shots -- save baseline`.
4. `npm run lint` (Prettier and svelte-check).
5. In the app, pick the skin in GLOBAL SETTINGS › LOOK and play a desk. EDIT mode (drag a
   widget: `lifted`) and LOCK should look right too.

## User skins (skin files)

Besides the built-in skins there are **user skins**: JSON files saved per device in
`<app data>/skins/<id>.json` (`src-tauri/src/skins.rs`), imported and exported in LOOK. A user
skin builds on a built-in skin (`base`) and lists only what it changes. The format is
`src/lib/skins/schema.ts` (validated on load and import), turned into CSS by
`src/lib/skins/compile.ts` in the `skin.user` layer, keyed on `.frame[data-skin='<id>']`. The
format can't express anything the contract forbids: there are no typography fields, marker
parts take no image or fade, and nothing reaches the desk.

```json
{
  "format": "oscoctopus-skin",
  "version": 1,
  "id": "skin-starry",
  "name": "Starry",
  "base": "glass",
  "keycap": "flat",
  "tokens": { "--slider-cap-len": 26 },
  "scale": { "role": "act", "alpha": 0.8 },
  "parts": {
    "frame": { "rest": { "line": { "width": 2, "style": "dashed", "paint": { "role": "c" } }, "radius": 4 } },
    "switch.thumb": { "rest": { "fill": { "paint": { "hex": "#ff00aa" } }, "radius": 2 } },
    "keycap.face": {
      "rest": { "fill": { "paint": { "role": "c", "alpha": 0.9 }, "texture": "crosshatch" } },
      "down": { "fill": { "paint": { "role": "act" } } }
    },
    "slider.cap": { "rest": { "image": { "ref": "img-star", "mode": "contain", "tint": "c" } } }
  },
  "light": {},
  "images": { "img-star": { "mime": "image/svg+xml", "data": "<base64>", "w": 24, "h": 24 } }
}
```

- **`parts`:** a part (anatomy table), then a state (`rest`, or one the part has), then a
  style. A style can set:
  - `fill`: a paint and a texture (`solid`, `dither50`, `dither25`, `hatch`, `crosshatch`,
    `dots`), or `null` for none;
  - `line`: `width` 0–8, `style`, `paint`, or `null`;
  - `radius`: 0–64;
  - `shadows`: up to 3, each `drop`, `glow` or `inset`;
  - `text`: a paint;
  - `opacity`: 0.1–1;
  - `image`: see below.
- **`rest` means "showing no other look".** A thumb styled at rest still turns the base skin's
  ACTIVE when on, unless the skin styles `on` too.
- **A paint** is `{ "role": "c" | "act" | "fg" | …, "alpha": 0–1 }`, which follows the palette
  and the mode, or `{ "hex": "#rrggbb" }`. `light` holds light-mode changes on top of `parts`.
- **An image** is one of `images` (PNG, WebP, JPEG or SVG, base64, at most 1024px and 512 KiB
  each), placed as `nine` (nine-slice by `slice`), `stretch`, `cover`, `contain` or `tile`.
  It sits `under` or `over` the part's contents. With `tint`, it is a mask drawn in that role:
  black line art takes the widget's colour. Which modes a part accepts is its `image` kind in
  anatomy.ts.

## A brief for an LLM

> Make a new built-in widget skin for OscOctopus called `<ID>` that looks like `<DESCRIPTION>`.
> Follow `docs/SKINS.md` exactly:
> - register it in `src/lib/skins/builtin.ts`;
> - write `src/lib/skins/<ID>.css` inside `@layer skin.builtin`, keying every rule on
>   `.frame[data-base='<ID>']`, and import it in `src/app.css`;
> - style every part and state in the anatomy table, using the colour roles (`--c`, `--act`,
>   …), not raw colours, with a light-mode variant.
>
> Do not change fonts or any text property, do not move, hide or resize titles, values or
> markers, and do not style the desk background. Then run `npm test`, `npm run lint` and
> `npm run shots -- compare`. No other skin may change.
