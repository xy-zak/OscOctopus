# Changelog

All notable changes to OscOctopus. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/). The version lives in `package.json`; see README ›
Scripts.

## [Unreleased]

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
