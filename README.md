# OscOctopus

A flexible OSC control desk. Build a dashboard of buttons, switches, faders and XY graphs on a
grid, bind each one to OSC messages, and send them over UDP (unicast / broadcast / multicast) or TCP (SLIP or
length-prefix framing). Incoming OSC can drive the same widgets, safely. Dashboards are saved as
presets, and can be **shared live** with other OscOctopus apps on the network, so several
people play and edit one desk together. The TRAFFIC view shows the exact bytes of every packet
sent and received.

**Stack:** Tauri 2 (Rust core) · Svelte 5 + TypeScript · Vite.
**Look:** a terminal UI in JetBrains Mono Nerd Font (bundled), near-black on near-white, coloured
from one of fourteen palettes of nine colours and an accent: RAINBOW, NEON and PASTEL (every
hue), themed ones inspired by one colour that travel across its neighbours, most with two
contrasting colours at the end (SUNSET, UNDERWATER, PHOSPHOR, AMBER, CRIMSON, SAKURA, VIOLET,
COBALT, FROST, SAND), and GREYSCALE. Or make your own from one colour. Every desk can have its own
palette, active colour and widget skin.
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
[■ DESK A ●][■ ⇄ DESK B ●][+]  [GLOBAL SETTINGS] │ ● 3/3 OUT  ● 2 SYNC │ [■] OSC-IN  [■] OSC-OUT  [ ] LOCK  [ ] PRESENT
╔ frame in the active tab's colour ════════════════════════════════════════════════════╗
║ F1 CONTROLS  F2 NETWORK  F3 TRAFFIC  F4 LOOK  F5 SYNC                                  ║
║ desk tool row: + ADD … (EDIT) or [ ] INFO (LIVE)                             [ ] EDIT ║
║ …                                                                                     ║
```

- **The top tabs pick a container.** It's either one of your **desks** or **GLOBAL SETTINGS**. The
  active tab flows into the frame below it. Everything inside the frame belongs to that tab and
  nothing else. A desk tab always opens on the desk's CONTROLS.
- **Every desk has an identity colour.** It is used for its tab and its frame, so you always know
  which desk you are in. GLOBAL SETTINGS is neutral white: it belongs to no desk.
- **Sections sit inside the frame.** NETWORK, TRAFFIC and SYNC exist at both levels. The frame colour tells you which one you're in: the desk's own colour, or white for GLOBAL SETTINGS.

| Desk (per desk) | | GLOBAL SETTINGS (all desks / this device) | |
| --- | --- | --- | --- |
| **F1 CONTROLS** | The widgets. *Live* plays them (multi-touch; the side panel shows the exact messages of the last-touched widget). *EDIT* adds, moves, resizes and edits them. The `[■] EDIT` switch at the right end of the desk's tool row (or Alt+E) flips between the two; the grid shows only while editing. | **F1 NETWORK** | This device's interfaces and broadcast addresses, plus a read-only table of every desk's endpoints. Click one to edit it in that desk. |
| **F2 NETWORK** | This desk's outputs and inputs (UDP unicast/broadcast/multicast, TCP SLIP or length-prefix), with live status and the OS's own errors. | **F2 TRAFFIC** | Every packet and lifecycle event of all desks, sequence-numbered, filterable. Hex/ASCII, decoded view, export. |
| **F3 TRAFFIC** | The traffic of this desk only. | **F3 LIBRARY** | Every saved desk preset: open as desk, delete, new blank desk, import as new desk. |
| **F4 LOOK** | This desk's name and colour, save, export, *import into this desk*, duplicate, remove. Its own **look**, on this device: palette, active colour and widget skin, each *ALL DESKS* or its own. | **F4 LOOK** | Dark (default) or light background, shared by every desk. The **look** of every desk: its palette (nine colours and an **accent**, which marks highlights and selection), its **active colour** (what is pressed, on, filled or held: any colour from the colour picker, GREEN by default) and its widget skin. *New palette* makes a custom one: pick a colour, and nine (light to dark) and an accent are generated from it; then pick any of them by hand. Custom palettes are listed with the others; *Edit* changes or deletes one. The widget skin says how widgets are drawn: TERMINAL (pixel lines), GLASS (tinted rounded panes), SKETCH (coloured pencil), WOBBLY (every line an even wave), PIXELATED (an 8-bit game screen), HARDWARE (a mixing desk), NEON (glowing tubes), BLUEPRINT (a technical drawing), BRUTALIST (thick borders, hard shadows), LED MATRIX (round LEDs), CRT (scanlines and glow) or ARCADE (domed buttons, ball-top levers). Text, markers and the background are the same in every skin. A desk can have its own palette, active colour or skin (DESK › LOOK). |
| **F5 SYNC** | Share this desk with the sync session, see who else is on it, choose the device that forwards input, restore an earlier version. | **F5 SYNC** | This device's name, colour and fingerprint; join or leave a session; listen port, LAN discovery and devices by address; the desks shared in the session (*Open*); every device with its state, round trip and clock. |

- **The master bar sits outside every tab and frame** (top right), because it affects all desks.
  Status first, then the switches from least to most restrictive, and PRESENT last:
  - **OUT** (readout): outputs ready / enabled across all desks, and messages per second. Its
    lamp is green when all are ready, red when one failed. Click it for GLOBAL SETTINGS ›
    NETWORK.
  - **SYNC** (readout): devices connected in your session; click it for GLOBAL SETTINGS › SYNC.
  - **OSC-IN** (switch, Alt+I, on by default): lets received OSC drive widgets. Off, it ignores
    it all (still shown in TRAFFIC).
  - **OSC-OUT** (switch, Alt+P, on by default): off, it pauses all outgoing OSC. It turns red and
    the OUTPUT PAUSED banner shows. This is enforced in the Rust core, and held packets are
    logged with their exact bytes.
  - **LOCK** (switch, Alt+L): freezes widgets and settings (amber while locked). Edits from
    other devices on shared desks wait until you unlock.
  - **PRESENT** (switch, F11): the active desk's widgets fill the screen (the window goes
    fullscreen on desktop). Only the desk tabs, OSC-IN, OSC-OUT, LOCK and `[■] PRESENT` stay.
    Click it, or press Esc or F11, to stop.
  - Switches show `[■]` and fill with the accent colour when what they name is on (LOCK fills
    amber). OSC-IN, OSC-OUT and LOCK survive restarts, and so does presenting.
  - **OSC-IN, OSC-OUT and LOCK change only after a 1 s press-and-hold**, on and off alike, so a
    stray touch can't flip them mid-show. The new state wipes in while you hold; let go early
    and it says HOLD 1 SEC. Their Alt shortcuts must be held for a second too.
- **All open desks run at the same time.** A tab only chooses which one you see. **+** adds a desk
  (new, duplicate, open saved) and **×** removes one, always after a confirmation. Removing keeps
  the preset saved.

**Widgets:**
- **Button**: momentary or trigger. Optional **arm-then-fire**: *double-tap* (the first press
  arms it, a second press within the timeout fires) or *hold* (fires only after being held for
  N ms). Nothing is sent until it fires.
- **Switch**, and **Fader** (range, step, curve, relative or absolute touch, rate limit).
- **Graph**: an XY pad with channels `x` and `y`.
- **Pads**: a grid of up to 8×8 numbered pads (1…N from the top-left; momentary / toggle /
  trigger), multi-touch. Each hit sends `{number, row, col, on}`, and no hit is ever merged
  away.
- **List**: pick one of up to 64 options, sending `{index, label, value}`. Numeric-looking
  values are sent as numbers.
- **Sequencer**: a list of up to 64 messages, each followed by a wait, played in a loop
  (forever or N passes) to its outputs. A bar fills over each wait until the next message;
  **▶ START / ■ STOP** and **❚❚ PAUSE / ▶ PLAY** keys, and a strip showing the step it is on. The timing runs in the app's core, so it keeps exact
  time on another tab, in the background or minimised. It plays on the device that started it.
- **Text**: a block of text in a small markup (`# heading`, `- item`, `**bold**`,
  `==reverse==`, `{3:colour}`), aligned as you like. It wraps and fits its box (FIT, or at
  most S, M, L or XL), ending in … when there's no room left. It can show the value of
  a received message (**OSC in**: `{value}`) or another widget's live value (**Monitor**:
  `{value}`, or a channel like `{x}`).
- **Log**: what widgets sent (→) and received (←) on this device, newest first: every widget of
  the desk or the ones you pick, up to 200 rows, with the columns you choose (time, widget,
  address, value, where, IP, result, size).
- **Frame**: one place on the desk with tabs, each holding widgets of its own (each person picks
  their own tab; it works while LOCKED too). Select a frame, or a widget on it, and ADD puts new
  widgets on the tab it shows; everything on it is edited right there. Drag widgets into a frame,
  out of it or into another, and hold one over a tab's name to open that tab. Its Inspector names,
  orders, adds and removes tabs and sets the grid they share.

**Messages:**
- **Both ways:** each message can **OUT** (send to outputs when the widget changes) and **IN**
  (receive from the desk's inputs, or replies on an output, and set the widget). **FORWARD**
  re-sends a received change to the outputs (a bridge), never back to where it came from.
- **Channels:** each value argument can pick a channel of the widget's value (e.g. `x`,
  `row`, `number`). With `(default)` it takes `value` if the widget has one, otherwise its first
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
- F11 presents (and stops); Esc also stops. While presenting, F1…F5, Alt+0 and Alt+E do nothing.
- Alt+E edit. Hold for 1 s: Alt+I OSC-IN, Alt+P OSC-OUT (pause), Alt+L lock.
- In edit mode: arrows nudge, Del removes, Esc deselects (or puts back a widget being dragged).

## Platforms

What works where, per feature, with setup notes for every OS:
[docs/PLATFORMS.md](docs/PLATFORMS.md). Mobile setup: [docs/ANDROID.md](docs/ANDROID.md),
[docs/APPLE.md](docs/APPLE.md).

Architecture, conventions, and how to add a widget type: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
