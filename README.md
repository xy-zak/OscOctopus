# OscOctopus

A flexible OSC control desk. Build a dashboard of buttons, switches, faders and XY graphs on a
grid, bind each one to OSC messages, and send them over UDP (unicast / broadcast / multicast) or TCP (SLIP or
length-prefix framing). Incoming OSC can drive the same widgets, safely. Dashboards are saved as
presets, and can be **shared live** with other OscOctopus apps on the network, so several
people play and edit one desk together. The TRAFFIC view shows the exact bytes of every packet
sent and received.

**Stack:** Tauri 2 (Rust core) · Svelte 5 + TypeScript · Vite.
**Look:** a terminal UI in JetBrains Mono Nerd Font (bundled), near-black on near-white, coloured
from one of fourteen palettes: RAINBOW, NEON and PASTEL (every hue), themed ones inspired by one
colour that travel across its neighbours, most with two contrasting accents (SUNSET, UNDERWATER,
PHOSPHOR, AMBER, CRIMSON, SAKURA, VIOLET, COBALT, FROST, SAND), and GREYSCALE.
**Targets:** Windows, Linux, Android (next: macOS, iOS).

## Quick start

Prerequisites: Node 20+, Rust (stable), and the [Tauri prerequisites](https://tauri.app/start/prerequisites/)
for your OS.

```sh
npm install
npm run tauri dev      # run the desktop app with hot reload
npm run tauri build    # release installer(s) in src-tauri/target/release/bundle
```

On first launch you get a demo desk with a **loopback** setup: an output sending to
`127.0.0.1:9000` and an input listening on `127.0.0.1:9000`. Move a fader, then open **TRAFFIC**
(F3) to see each packet leave (`OUT`) and arrive (`IN`) with identical bytes.

## Scripts

| Command            | What it does                                                        |
| ------------------ | ------------------------------------------------------------------- |
| `npm run tauri dev` | Desktop app in dev mode                                            |
| `npm run verify`   | Every check CI runs: formatting, types, all tests, Rust fmt and clippy |
| `npm test`         | Frontend unit tests (Vitest): widget defs, grid engine, value mapping, throttle, autosave, presets, formatting |
| `npm run check`    | Type-check Svelte + TS (`svelte-check`)                            |
| `npm run lint`     | Prettier check + type-check                                        |
| `npm run bindings` | Regenerate TS types and endpoint defaults from Rust (`src/lib/ipc/bindings/`, via ts-rs) |
| `npm run format`   | Prettier (write)                                                   |
| `python scripts/make_icons.py <dir>` | Re-render the app icons from the UI's pixel octopus (needs Pillow; see the script) |
| `cd src-tauri && cargo test` | Rust unit tests + real-socket tests: loopback (UDP, TCP SLIP / length-prefix, timeouts, client cap), input mapping, and sync between two apps (auth, wrong key, duplicates, chunking, bans, rate limits) |
| `cd src-tauri && cargo clippy --all-targets -- -D warnings` | Rust lints                  |

Change a Rust type (or an endpoint default) that crosses IPC → run `npm run bindings` →
`npm run check`. Generated files in `src/lib/ipc/bindings/` are committed and must not be edited
by hand; CI fails if they are stale. The version lives in `package.json` (`tauri.conf.json` reads
it); bump `src-tauri/Cargo.toml` with it (a Rust test checks they match). Changes are listed in
[CHANGELOG.md](CHANGELOG.md).

## Using it

The screen always shows **where you are**, by containment:

```
▓ LOCKED / PAUSED banners: the whole app, full width
[■ DESK A ●][■ ⇄ DESK B ●][+]  [GLOBAL SETTINGS] │ ● 3/3 OUT  ● 2 SYNC │ [■] IN ON  [ ] PAUSE  [ ] LOCK
╔ frame in the active tab's colour ════════════════════════════════════════════════════╗
║ F1 CONTROLS  F2 NETWORK  F3 TRAFFIC  F4 PRESET  F5 SYNC                                ║
║                              the desk's top-right grid cell → [LIVE ●━◯ EDIT]        ║
║ …                                                                                     ║
```

- **The top tabs pick a container.** It's either one of your **desks** or **GLOBAL SETTINGS**. The
  active tab flows into the frame below it. Everything inside the frame belongs to that tab and
  nothing else.
- **Every desk has an identity colour.** It is used for its tab and its frame, so you always know
  which desk you are in. GLOBAL SETTINGS is neutral white: it belongs to no desk.
- **Sections sit inside the frame.** NETWORK, TRAFFIC and SYNC exist at both levels. The frame colour tells you which one you're in: the desk's own colour, or white for GLOBAL SETTINGS.

| Desk (per desk) | | GLOBAL SETTINGS (all desks / this device) | |
| --- | --- | --- | --- |
| **F1 CONTROLS** | The widgets. *Live* plays them (multi-touch; the side panel shows the exact messages of the last-touched widget). *EDIT* adds, moves, resizes and edits them. The EDIT / LIVE toggle switch in the top-right cell flips between the two: lever left = LIVE (green), right = EDIT. | **F1 NETWORK** | This device's interfaces and broadcast addresses, plus a read-only table of every desk's endpoints. Click one to edit it in that desk. |
| **F2 NETWORK** | This desk's outputs and inputs (UDP unicast/broadcast/multicast, TCP SLIP or length-prefix), with live status and the OS's own errors. | **F2 TRAFFIC** | Every packet and lifecycle event of all desks, sequence-numbered, filterable. Hex/ASCII, decoded view, export. |
| **F3 TRAFFIC** | The traffic of this desk only. | **F3 LIBRARY** | Every saved desk preset: open as desk, delete, new blank desk, import as new desk. |
| **F4 PRESET** | This desk's name and colour, save, export, *import into this desk*, duplicate, remove. | **F4 LOOK** | Dark (default) or light background, plus the palette and accent. All are shared by every desk. |
| **F5 SYNC** | Share this desk with the sync session, see who else is on it, choose the device that forwards input, restore an earlier version. | **F5 SYNC** | This device's name, colour and fingerprint; join or leave a session; listen port, LAN discovery and devices by address; the desks shared in the session (*Open*); every device with its state, round trip and clock. |

- **The master bar sits outside every tab and frame** (top right), because it affects all desks.
  Status first, then the switches from least to most restrictive:
  - **OUT** (readout): outputs ready / enabled across all desks, and messages per second. Its
    lamp is green when all are ready, red when one failed. Click it for GLOBAL SETTINGS ›
    NETWORK.
  - **SYNC** (readout): devices connected in your session; click it for GLOBAL SETTINGS › SYNC.
  - **IN** (switch, Alt+I): `[■] IN ON` lets received OSC drive widgets; `[ ] IN OFF` (amber)
    ignores it all (still shown in TRAFFIC).
  - **PAUSE** (switch, Alt+P): blocks all outgoing OSC (red while paused). It is enforced in the
    Rust core, and held packets are logged with their exact bytes.
  - **LOCK** (switch, Alt+L): freezes widgets and settings (amber while locked). Unlock with a
    1 s press-and-hold. Edits from other devices on shared desks wait until you unlock.
  - Switches show `[■]` when what they name is on. IN, PAUSE and LOCK survive restarts.
- **All open desks run at the same time.** A tab only chooses which one you see. **+** adds a desk
  (new, duplicate, open saved) and **×** removes one, always after a confirmation. Removing keeps
  the preset saved.

**Widgets:**
- **Button**: momentary or trigger. Optional **arm-then-fire**: *double-tap* (the first press
  arms it, a second press within the timeout fires) or *hold* (fires only after being held for
  N ms). Nothing is sent until it fires.
- **Switch**, and **Fader** (range, step, curve, relative or absolute touch, rate limit).
- **Knob**: a curved fader. *Bounded* (a 270° arc with a range) or *endless* (an encoder that sends
  `{value, delta}` per detent; held-back deltas add up rather than being dropped).
- **Graph**: an XY pad with channels `x` and `y`.
- **Pads**: a grid of up to 8×8 numbered pads (1…N from the top-left; momentary / toggle /
  trigger), multi-touch. Each hit sends `{number, row, col, on}`, and no hit is ever merged
  away.
- **List**: pick one of up to 64 options, sending `{index, label, value}`. Numeric-looking
  values are sent as numbers.

**Messages:**
- **Both ways:** each message can **OUT** (send to outputs when the widget changes) and **IN**
  (receive from the desk's inputs, or replies on an output, and set the widget). **FORWARD**
  re-sends a received change to the outputs (a bridge), never back to where it came from.
- **Channels:** each value argument can pick a channel of the widget's value (e.g. `x`,
  `delta`, `number`). With `(default)` it takes `value` if the widget has one, otherwise its first
  channel.
- **Placeholders:** the address can contain channels in braces, e.g. `/grid/{row}/{col}` or
  `/scene/{label}`.
- **Argument types:**
  - `f i d h T/F s`
  - `auto`: the value's own type (number → `f`, string → `s`, bool → `T/F`, list → array)
  - `[]`: an OSC array
  - `…`: spreads a list into separate arguments
  - `m`: a MIDI message built from a note event. No widget produces note events yet, so it
    only appears for widgets that do (e.g. a future keyboard).

**Sharing a desk:**
1. On every device, open GLOBAL SETTINGS › SYNC (F5). On one device, *Generate* a key, and join
   with a session name. On the others, join with the same name and key. Devices on the same
   LAN find each other; otherwise add one by address.
2. On the desk to share: DESK › SYNC (F5) › *Share with session*. The others see it under *Shared in
   this session* and *Open* it.
3. Everyone can now play and edit it. Only the device you touch sends OSC; the others show the
   value. A widget someone has open in the Inspector shows their name. Take over to edit it
   anyway.

**Keys:**
- Alt+1…9 opens desk N, Alt+0 opens GLOBAL SETTINGS, and Alt+[ / Alt+] go to the previous / next desk.
- F1…F5 switch sections inside the current frame.
- Alt+E edit, Alt+P pause, Alt+I input on/off, Alt+L lock.
- In edit mode: arrows nudge, Del removes, Esc deselects.

## Platforms

What works where, per feature, with setup notes for every OS:
[docs/PLATFORMS.md](docs/PLATFORMS.md). Mobile setup: [docs/ANDROID.md](docs/ANDROID.md),
[docs/APPLE.md](docs/APPLE.md).

Architecture, conventions, and how to add a widget type: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
