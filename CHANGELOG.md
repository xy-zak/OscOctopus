# Changelog

All notable changes to OscOctopus. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/). The version lives in `package.json`; see README ›
Scripts.

## [Unreleased]

### Added

- **OSC input drives widgets.** A widget's message can now also _receive_: from one of the
  desk's inputs, or from replies arriving on an output (X32-style devices). An external OSC
  sender or device can move faders, switches, knobs and graphs, light pads, pick list items,
  and flash buttons. Addresses can have `{placeholders}`, and incoming OSC wildcards are matched.
- **Loop-safe by design.**
  - Received OSC only moves the widget. Re-sending it (_forward_) is opt-in per message, never
    goes back to where it came from, and is never allowed on armed buttons or encoder deltas.
  - Packets this app (or a sync peer) sent itself are recognised and never applied.
  - A widget you are touching ignores input, and our own echoes are dropped.
  - A breaker stops a widget that forwards more than 40 times a second.
  - **IN** (master bar, Alt+I) switches all input off.
  - TRAFFIC shows what happened to every received message.
- **Sync: share desks live between OscOctopus apps**, peer to peer, with no server.
  - Join a session (GLOBAL SETTINGS › SYNC, F5) with a generated key or a passphrase. Others
    see this device under its name, in its LOOK accent colour.
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

- **Preset schema v8:** a message's `enabled` became `send`, next to the new `receive`,
  `sourceIds` and `forward` (migrated automatically, all off).
- The master bar gained **SYNC** (connected devices) and **IN**. Desks gained **F5 SYNC**,
  and GLOBAL SETTINGS **F5 SYNC**.
- **The Inspector is in foldable sections:** VISUAL, INTERACTION, MESSAGES (with the preview)
  and ACTIVITY (folded by default). The LIVE info panel has the same look: VALUE, MESSAGES and
  ACTIVITY. Which ones are open is remembered per device.
- **The app icon is the pixel octopus** from the UI, in the default accent on a transparent
  background, drawn pixel-exact at every size (`scripts/make_icons.py`).
- **The EDIT / LIVE switch is a toggle switch in one cell:** it takes only the top-right cell
  (it used to take two). Its bat lever flips left for LIVE (green) and right for EDIT. The lamp
  is gone.
- **One look for the master bar:** OUT and SYNC are status readouts (a lamp; click to open
  them), then the switches IN, PAUSE and LOCK, from least to most restrictive. All share one
  size and border. Each switch shows `[■]` when on and fills with a colour in its safety state,
  so IN ON / IN OFF is as clear as PAUSE and LOCK.
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
- **The graph's arrow keys follow each axis's step**, like the fader and knob.
- **Stricter TypeScript** (`noUnusedLocals`, `noUnusedParameters`,
  `noFallthroughCasesInSwitch`) and `clippy -D warnings`.

### Removed

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
