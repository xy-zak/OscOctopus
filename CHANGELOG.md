# Changelog

All notable changes to OscOctopus. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/). The version lives in `package.json`; see README ›
Scripts.

## [Unreleased]

### Added

- **Three new widgets**, drawn in every skin:
  - **Sequencer**: messages played in a loop, each followed by its wait, to the widget's
    outputs, forever or for a number of passes. A wait bar that fills until the next step,
    START/STOP and PAUSE/PLAY keys, and a step strip. The core times it (drift-free, never bursting to catch up, a pass never shorter
    than 10 ms), so it keeps playing on another tab or in the background. Edits reach a
    running sequence at its next step. It plays only on the device that started it.
  - **Text**: static text in a small markup, the value of a received OSC message, or another
    widget's live value. Received text can't add formatting. The text wraps and fits its box:
    FIT (the default) makes it as large as the box allows, S/M/L/XL are the largest it gets;
    it shrinks to 10 px, then ends in … where it no longer fits.
  - **Log**: a widget version of ACTIVITY for several widgets at once, with sent and received
    messages, a history of up to 200 rows and a choice of columns.
- **Looks: one way to colour and skin every desk.** A look is three choices: the palette, the
  **ACTIVE colour** (what is pressed, on, filled or held, until now always green) and the widget
  skin. GLOBAL SETTINGS › LOOK sets them for every desk, and adds or deletes palettes and skins;
  DESK › LOOK can give a desk its own palette, active colour or skin (each starts at
  _ALL DESKS_), with the same pickers. A widget's colour (EDIT › VISUAL) is one of its desk's
  palette colours. GREEN stays the default active colour; any colour can take its place, picked
  on the system's colour picker or typed as a hex code.
  Per device, like the rest of LOOK: a shared desk shows in each person's own look.
- **Hide a widget's title or value** (EDIT › VISUAL › _Show_): the title and the value readout
  set into its frame can each be switched off.
- **Preset schema v11** (for the new widgets and the title/value switches; old desks are
  unchanged). Devices on v10 or older can't join a v11 sync session.
- **Presenting** (`[ ] PRESENT` at the right end of the master bar, or F11): the desk's
  widgets fill the screen, and on desktop the window goes fullscreen. Only the desk tabs,
  OSC-IN, OSC-OUT, LOCK and `[■] PRESENT` (click it, or Esc / F11, to stop) stay; the sections, the
  tool row, the info panel and the banners are hidden, and nothing else can navigate away. It
  survives restarts, like LOCK and OSC-OUT.
- **Widget skins** (GLOBAL SETTINGS › LOOK › _Widget skin_): how widgets are drawn, apart from
  their colours. TERMINAL is the pixel look so far; GLASS draws clear, rounded panes tinted
  with the widget colour, with pill switches and round knobs; SKETCH draws them in coloured
  pencil, with hatching; WOBBLY keeps them clean and flat with every line an even wave; PIXELATED
  draws an 8-bit game screen of chunky pixels, notched borders and bevelled blocks. Seven more:
  HARDWARE (a mixing desk: metal panels, rubber keys, ridged fader caps), NEON (glowing tubes),
  BLUEPRINT (a technical drawing), BRUTALIST (thick borders, hard offset shadows), LED MATRIX
  (a grid of round LEDs), CRT (scanlines, vignette, phosphor glow) and ARCADE (domed buttons in
  chrome rings, ball-top levers). The text, the markers (fader scale, ON/OFF, pad numbers) and
  the desk's background are the same in every skin. A desk can have its own skin (DESK › LOOK).
  Per device, like the palette: a shared desk shows in each person's own skin. How to make one:
  docs/SKINS.md.
- **User skins:** skin files (JSON, with their images embedded) build on a built-in skin and
  change only what they list. _Import skin…_ in LOOK adds one (a copy, if its id is taken);
  _Export…_ saves one as a file for another device; _Delete_ removes it, and desks wearing it go
  back to TERMINAL. A file that isn't a valid skin is listed with the reason, so it can be
  deleted.
- **Custom palettes** (GLOBAL SETTINGS › LOOK › _New palette_). Pick a source colour and nine
  colours are generated from it, lightest to darkest, with the source as colour 4 (the middle),
  and an accent from its opposite hue. Lighter colours drift towards yellow and darker ones
  towards violet, like the built-in themed palettes, so neighbours stay distinct. Any colour, the
  accent included, can then be picked by hand, and it stays when the source changes, until
  reset. Saved palettes are listed with the built-in ones
  (_Edit_ to change or delete one) and kept per device, like the rest of LOOK. A new palette
  becomes every desk's; saving changes to one recolours wherever it is used.
- **OSC input drives widgets.** A widget's message can now also _receive_: from one of the
  desk's inputs, or from replies arriving on an output (X32-style devices). An external OSC
  sender or device can move faders, switches and graphs, light pads, pick list items,
  and flash buttons. Addresses can have `{placeholders}`, and incoming OSC wildcards are matched.
- **Loop-safe by design.**
  - Received OSC only moves the widget. Re-sending it (_forward_) is opt-in per message, never
    goes back to where it came from, and is never allowed on armed buttons.
  - Packets this app (or a sync peer) sent itself are recognised and never applied.
  - A widget you are touching ignores input, and our own echoes are dropped.
  - A breaker stops a widget that forwards more than 40 times a second.
  - **OSC-IN** (master bar, Alt+I) switches all input off.
  - TRAFFIC shows what happened to every received message.
- **Sync: share desks live between OscOctopus apps**, peer to peer, with no server.
  - Join a session (GLOBAL SETTINGS › SYNC, F5) with a generated key or a passphrase. Others
    see this device under its name, in the colour it picks there (in their own palette).
    Connections are authenticated and encrypted (Noise XXpsk3), and apps on the LAN find each
    other (mDNS) or are added by address.
  - Share a desk (DESK › SYNC, F5), and everyone in the session can play it and edit it at the
    same time.
  - **Editing:** changes merge per field, and the later change to the same field wins. Nothing
    is deleted by inference. A remote batch deleting many widgets asks first. _Soft locks_ show
    who is editing which widget.
  - **Offline and LOCK:** edits made offline merge on reconnect. LOCK holds remote edits until
    you unlock.
  - **Live values:** values show everywhere, but only the device that was touched sends OSC.
    PAUSE also stops sharing your touches, and one chosen device forwards device input.
  - **History:** earlier versions of shared desks are kept, restorable as a copy.
- **`OSCOCTOPUS_PROFILE`** runs an instance with its own data, to test sync on one machine.

### Changed

- **Each palette brings its own accent:** nine colours and an accent, last and set apart in
  every picker. The accent marks highlights and selection wherever the palette is worn, and
  widgets and desks can still use it as a tenth colour. The separate _Accent_ choice in LOOK is
  gone. The built-in palettes' accents are their last colours (RAINBOW, NEON and PASTEL now
  highlight in pink); GREYSCALE's is white, after its nine greys.
- **DESK › PRESET is now DESK › LOOK** (still F4): the desk's name, colour, preset file and look.
- **A desk tab always opens on the desk's CONTROLS**, whichever section was open before.
- **PAUSE is now OSC-OUT**, next to **OSC-IN**: both are on by default, and turning OSC-OUT
  off pauses all output as before (red, with the OUTPUT PAUSED banner; still Alt+P).
- **OSC-IN, OSC-OUT and LOCK change only after a 1 s press-and-hold**, on and off alike (LOCK
  used to lock on a single tap). The new state wipes in while held; a short tap says HOLD 1 SEC.
  Their shortcuts (Alt+I, Alt+P, Alt+L) must be held for a second too.
- **Switches fill with the accent colour while on:** OSC-IN, OSC-OUT, PRESENT, and the desk's
  INFO and EDIT. LOCK still fills amber while locked.
- **The master bar wraps on narrow screens** instead of running off the edge, so every
  control (LOCK was cut off on a phone) stays reachable.
- **Widget styles are skins:** each widget keeps only its layout; every colour, line, fill and
  animation is in a skin stylesheet, and widget parts are named (see ARCHITECTURE › Widget
  skins). The TERMINAL look is unchanged pixel for pixel.
- **Reduced motion** now also stops the release flashes, the armed blink, the selection ants
  and the lock-on brackets (before, it only shortened transitions).
- **Lists with many options** no longer turn into a cramped horizontal strip: AUTO only goes
  horizontal while each option still gets a few characters.
- **Preset schema v8:** a message's `enabled` became `send`, next to the new `receive`,
  `sourceIds` and `forward` (migrated automatically, all off).
- The master bar gained **SYNC** (connected devices) and **OSC-IN**. Desks gained **F5 SYNC**,
  and GLOBAL SETTINGS **F5 SYNC**.
- **The Inspector is in foldable sections:** VISUAL, INTERACTION, MESSAGES (with the preview)
  and ACTIVITY (folded by default). The LIVE info panel has the same look: VALUE, MESSAGES and
  ACTIVITY. Which ones are open is remembered per device.
- **The app icon is the pixel octopus** from the UI, in the default accent on a transparent
  background, drawn pixel-exact at every size (`scripts/make_icons.py`).
- **EDIT is a switch in the desk's tool row:** `[■] EDIT`, at the right end next to INFO, in
  the same shape as the master bar's switches. It no longer sits on the grid, so widgets can use
  every cell, the top-right one included.
- **The desk grid shows only in EDIT**, and more clearly: every cell is an outlined slot in the
  desk's colour. LIVE has no background grid, just the widgets.
- **One look for the master bar:** OUT and SYNC are status readouts (a lamp; click to open
  them), then the switches OSC-IN, OSC-OUT and LOCK, from least to most restrictive. All share
  one size and border, and each switch shows `[■]` when on.
- **Eight themed palettes** in GLOBAL SETTINGS › LOOK. Like SUNSET and UNDERWATER, each is
  inspired by one colour but travels across its neighbouring hues, then adds two contrasting
  accents: PHOSPHOR (terminal greens), AMBER (terminal golds), CRIMSON, SAKURA, VIOLET (after
  Shades of Purple), COBALT (after Cobalt2), FROST (after Nord) and SAND. Hover a palette to see
  what it follows.
- **AUTO widget colour follows the desk's colour** (it was the global accent), so a desk's
  widgets match its tab and frame unless given their own colour.
- **Each message is ruled into parts** (address, OUT, IN & FORWARD, arguments), so the two
  directions no longer run together; FORWARD's explanation has its own line.

### Safety

- **TCP outputs never hang.** A write that can't complete within 2 s (the peer stopped reading)
  fails with a clear error, and the connection is dropped and reconnected. Before, the send (and
  the widget behind it) could wait forever.
- **Hostname lookups time out after 3 s, and never block other desks.** They run before the
  endpoint lock is taken, so sends on every desk keep flowing while one desk waits on DNS.
- **Presets are written atomically _and_ durably.** Each save goes to a uniquely named temp
  file, which is fsynced and then renamed. Saves are serialised in Rust. In the frontend, saves
  of a desk never overlap, and an edit made during a save is no longer marked as saved.
- **Nothing is lost when leaving.** Pending edits are written when the window closes, when the
  app goes into the background, and when a desk is closed.
- **Failures are visible.** A setting that can't be saved (LOCK, PAUSE, theme, open desks) is
  reported in TRAFFIC and as a toast instead of being ignored.
- **Resource caps.** TCP inputs accept at most 64 clients. Import and export only read or write
  `.json` files. Preset and export file I/O no longer blocks async worker threads.

### Changed

- **One widget type = one folder** (`src/lib/widgets/<type>/`): its behaviour (`def.ts`), its
  view and its props editor. They are collected in two maps typed over every widget type, so a
  missing piece is a compile error. The Inspector shrank from 722 to about 120 lines.
- **Split `osc/mapping.ts`** into `value.ts` (value model), `curves.ts` (fader curves),
  `mapping.ts` (value → messages) and `format.ts` (text).
- **Single sources of truth:**
  - `LIMITS` feeds both the schema and the editor fields;
  - endpoint defaults come from Rust (`bindings/defaults.json`);
  - the version lives in `package.json`;
  - the section tables live in `ui.svelte.ts`;
  - desk actions and their confirmation texts live in `views/deskActions.ts`.
- **Internal names match the UI:** sections are `network`, `traffic` and so on; the view `global`
  is GLOBAL SETTINGS. `Debug.svelte` → `Traffic.svelte`, `Network.svelte` → `DeskNetwork.svelte`,
  and the IPC command `presets_dir` → `preset_dir`.
- **The graph's arrow keys follow each axis's step**, like the fader.
- **Stricter TypeScript** (`noUnusedLocals`, `noUnusedParameters`,
  `noFallthroughCasesInSwitch`) and `clippy -D warnings`.

### Removed

- **The knob widget.** Saved desks are migrated (preset schema v9): each knob becomes a fader in
  the same place, with the same range, curve, rate limit and messages. An endless knob's
  `value` and `delta` both become the fader's value. Devices on schema v8 can't join a v9
  sync session.
- **The per-packet `osc://incoming` event.** It had no consumer and cost one IPC message per
  inbound packet. Future widget feedback reads `IN` events from the batched debug stream instead.

### Added

- **CI** (GitHub Actions): formatting, types, unit tests, Rust lints and loopback tests on Linux
  and Windows, plus a check that the generated bindings are current.
- **Scripts:** `npm run verify` (every check) and `npm run lint`.
- **Docs:**
  - `docs/PLATFORMS.md`: a feature × OS support matrix, with Windows and Linux setup;
  - ARCHITECTURE: _Safety guarantees_ and _Conventions_ sections, and a rewritten _Adding a
    widget type_.
- **Tests (93 → 127 frontend, 42 → 50 Rust):**
  - widget-def consistency;
  - the autosave pipeline;
  - Rust-owned defaults;
  - interaction helpers;
  - TCP write timeouts;
  - DNS isolation between desks;
  - the TCP client cap;
  - concurrent preset saves.

## [0.1.0]

- First version:
  - desks of buttons, switches, faders, knobs, XY graphs, pads and lists on a grid;
  - OSC over UDP (unicast, broadcast, multicast) and TCP (SLIP, length-prefix);
  - presets with schema migrations (v1 → v7);
  - multiple desks at once;
  - PAUSE and LOCK;
  - a byte-exact TRAFFIC view.
