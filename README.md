# OscOctopus

A flexible OSC control desk. Build a dashboard of buttons, switches, faders and XY graphs on a
grid, bind each one to OSC messages, and send them over UDP (unicast / broadcast / multicast) or TCP (SLIP or
length-prefix framing). Dashboards are saved as presets. A Debug view shows the exact bytes of
every packet sent and received.

**Stack:** Tauri 2 (Rust core) · Svelte 5 + TypeScript · Vite.
**Look:** a terminal UI in JetBrains Mono Nerd Font (bundled), near-black on near-white, coloured
from one of six palettes (RAINBOW, NEON, PASTEL, SUNSET, GREYSCALE, UNDERWATER).
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
`127.0.0.1:9000` and an input listening on `127.0.0.1:9000`. Move a fader, then open **Debug** to
see each packet leave (`OUT`) and arrive (`IN`) with identical bytes.

## Scripts

| Command            | What it does                                                        |
| ------------------ | ------------------------------------------------------------------- |
| `npm run tauri dev` | Desktop app in dev mode                                            |
| `npm test`         | Frontend unit tests (Vitest): grid engine, value mapping, throttle, presets, formatting |
| `npm run check`    | Type-check Svelte + TS (`svelte-check`)                            |
| `npm run bindings` | Regenerate TS types from Rust (`src/lib/ipc/bindings/`, via ts-rs) |
| `npm run format`   | Prettier                                                           |
| `cd src-tauri && cargo test` | Rust unit tests + real-socket loopback tests (UDP, TCP SLIP, TCP length-prefix) |
| `cd src-tauri && cargo clippy --all-targets` | Rust lints                                 |

Change a Rust type that crosses IPC → run `npm run bindings` → `npm run check`. Generated files
in `src/lib/ipc/bindings/` are committed and must not be edited by hand.

## Using it

The screen always shows **where you are**, by containment:

```
▓ LOCKED / PAUSED banners: the whole app, full width
[■ DESK A ●][■ DESK B ●][+]                [GLOBAL SETTINGS] │ 3/3 OUT · PAUSE · LOCK
╔ frame in the active tab's colour ════════════════════════════════════════════════════╗
║ F1 CONTROLS  F2 NETWORK  F3 TRAFFIC  F4 PRESET                                         ║
║                        the desk's two top-right grid cells → [ LIVE ▐██▌]             ║
║ …                                                                                     ║
```

- **The top tabs pick a container.** It's either one of your **desks** or **GLOBAL SETTINGS**. The
  active tab flows into the frame below it. Everything inside the frame belongs to that tab and
  nothing else.
- **Every desk has an identity colour.** It is used for its tab and its frame, so you always know
  which desk you are in. GLOBAL SETTINGS is neutral white: it belongs to no desk.
- **Sections sit inside the frame.** NETWORK and TRAFFIC exist at both levels. The frame colour tells you which one you're in: the desk's own colour, or white for GLOBAL SETTINGS.

| Desk (per desk) | | GLOBAL SETTINGS (all desks / this device) | |
| --- | --- | --- | --- |
| **F1 CONTROLS** | The widgets. *Live* plays them (multi-touch; the side panel shows the exact messages of the last-touched widget). *EDIT* adds, moves, resizes and edits them. The EDIT / LIVE switch in the two top-right cells flips between the two (green = LIVE). | **F1 NETWORK** | This device's interfaces and broadcast addresses, plus a read-only table of every desk's endpoints. Click one to edit it in that desk. |
| **F2 NETWORK** | This desk's outputs and inputs (UDP unicast/broadcast/multicast, TCP SLIP or length-prefix), with live status and the OS's own errors. | **F2 TRAFFIC** | Every packet and lifecycle event of all desks, sequence-numbered, filterable. Hex/ASCII, decoded view, export. |
| **F3 TRAFFIC** | The traffic of this desk only. | **F3 LIBRARY** | Every saved desk preset: open as desk, delete, new blank desk, import as new desk. |
| **F4 PRESET** | This desk's name and colour, save, export, *import into this desk*, duplicate, remove. | **F4 LOOK** | Dark (default) or light background, plus the palette and accent. All are shared by every desk. |

- **The master controls sit outside every tab and frame** (top right), because they affect all desks:
  - **PAUSE** blocks all outgoing OSC. It is enforced in the Rust core, and held packets are
    logged with their exact bytes.
  - **LOCK** freezes widgets and settings. Unlock with a 1 s press-and-hold.
  - Both survive restarts.
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

**Keys:**
- Alt+1…9 opens desk N, Alt+0 opens GLOBAL SETTINGS, and Alt+[ / Alt+] go to the previous / next desk.
- F1…F4 switch sections inside the current frame.
- Alt+E edit, Alt+P pause, Alt+L lock.
- In edit mode: arrows nudge, Del removes, Esc deselects.

## Platform notes

- **Linux:** needs `webkit2gtk-4.1` and friends. See Tauri's Linux prerequisites.
  Binding to ports below 1024 requires privileges; use higher ports.
- **Windows:** the first time the app listens on a non-loopback address, Windows Firewall asks
  whether to allow it. Say yes for private networks, or inputs will receive nothing from the LAN.
- **Android:** see [docs/ANDROID.md](docs/ANDROID.md).
- **macOS / iOS:** see [docs/APPLE.md](docs/APPLE.md).

Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
