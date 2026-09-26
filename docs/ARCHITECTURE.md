# Architecture

```
┌──────────────────────────── Svelte 5 frontend (system webview) ────────────────────────────┐
│ views/        Desk · Inspector · Network · Debug · Presets                                  │
│ lib/widgets/  Button Switch Slider Knob Graph Pads List ──pointer──► lib/osc/sender.ts       │
│ lib/osc/      mapping.ts (value → OscMessage) · throttle.ts (Throttle / OrderedQueue gates)  │
│ lib/grid/     engine.ts (pure layout math) · GridCanvas / GridItem (drag, resize, ghost)     │
│ lib/state/    rune stores: preset · network · debug · values · ui                            │
│ lib/model/    zod preset schema · migrations · factories                                     │
│ lib/ipc/      THE ONLY place that calls invoke()/Channel; types generated from Rust           │
└──────────────┬───────────────────────────────────────────────────────────▲─────────────────┘
   invoke: osc_send, net_apply_config, preset_*, debug_*                     │ Channel<DebugBatch> ~30 Hz
                                                                              │ events: net://status, osc://incoming
┌──────────────▼───────────────────────────────────────────────────────────┴───── Rust core ─┐
│ commands.rs   thin IPC wrappers                                                            │
│ net/manager   NetworkManager: reconciles running endpoints against the desired config      │
│ net/udp       unicast / broadcast (SO_BROADCAST) / multicast (TTL, loop, IF) via socket2    │
│ net/tcp       client with reconnect loop · server with per-client sessions                  │
│ net/framing   SLIP (OSC 1.1) and int32 length prefix (OSC 1.0), incremental decoder         │
│ net/status    StatusBoard: authoritative state + counters per endpoint                      │
│ osc/codec     rosc-based encode/decode, address validation                                  │
│ debug.rs      DebugHub: seq-numbered ring buffer, batched flush, explicit drop counting     │
│ presets.rs    one JSON file per preset, atomic writes, id sanitisation                      │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Principles

1. **Rust owns the wire.** Messages are encoded in Rust right before the socket call, and the
   debug event is recorded *after* that call returns, carrying its real result. What the Debug
   view shows is what was sent. It is never the frontend's guess.
2. **Nothing implicit.** Every socket option comes from the user's config. The UI can suggest
   (broadcast addresses from interfaces, warnings like "this looks like a broadcast address")
   but never applies anything silently.
3. **Nothing lost silently.** Debug events carry sequence numbers. If the pending buffer
   overflows, the drop is counted and reported. The UI also counts sequence gaps that aren't
   explained by a reported drop (this should always be 0). Throttled values are counted as
   *coalesced*. IPC failures that never reach Rust are logged locally as `ui` events.
4. **Types have one owner.** Rust owns network/debug/OSC types, and TS gets them via ts-rs
   (`npm run bindings`). The frontend owns the preset schema (zod). Rust treats presets as opaque
   JSON, but validates the embedded `network` block with serde. The zod network schemas use
   `satisfies z.ZodType<RustType>`, so drift is a compile error.

## Send path

```
pointermove ─► Slider.setPos ─► emitValue(id, v) ─► Throttle.push(v)
                                                      │  • ≤ maxRateHz while dragging
                                                      │  • ≤ 1 send in flight (ordering)
                                                      │  • last value always sent; flush() on release
                                                      ▼
                                   buildMessages(widget, v) ─► invoke('osc_send')
                                                                   ▼
                              NetworkManager.send ─► encode once ─► each output: send_to / write_all
                                                                   ▼
                                           Ctx.packet_out(bytes, result) ─► StatusBoard + DebugHub
```

Tauri runs commands concurrently. Without the in-flight gate, two quick fader updates could hit
the socket out of order, and the receiver would end up on a stale value.

`sender.ts` picks a gate per widget type:
- **Continuous widgets (fader, graph, knob)** use a `Throttle`: under a fast drag only the newest
  value matters. The endless knob's throttle *merges* instead of replacing (`mergeDeltas`:
  +1 +1 +1 → +3), so deltas are never lost.
- **Discrete widgets (button, switch, pads, list)** use an `OrderedQueue`. It is FIFO with one
  send in flight and never merges, so every press, pad hit and selection goes out, in order.

## Widget values and channels

A widget's live value is a `WidgetValue` (`lib/osc/mapping.ts`):
- a `Scalar` (number, string or bool): Button, Switch, Fader, bounded Knob;
- a `ValueList` of scalars (unused by the built-in widgets, but carried end to end for future
  ones);
- a `ValueRecord` of named channels:
  - Graph: `{x, y}`
  - endless Knob: `{value, delta}`
  - Pads: `{number, row, col}` (1-based, reading order from the top-left) plus `on`
  - List: `{index, label, value}`

`registry.channelsFor(widget)` lists the channels the Inspector offers. The rules:
- **Channel selection:** a value argument's optional `channel` selects part of the value
  (`channelValue`). For records it is a key, with no channel meaning `value`, else the first
  key. For lists it is a numeric index. Scalars ignore it.
- **Address placeholders:** `{channel}` in the address is filled the same way (`fillAddress`).
  Unknown placeholders are left as written, so the preview shows the literal text.
- **Type coercion:** fixed types coerce: strings parse as numbers, `"false"`/`"0"`/`""` are
  false, and numbers print with up to 6 decimals.
- **Special types:**
  - `auto` follows the value's own type.
  - `[]` wraps the value in an OSC array.
  - `...` spreads a list into separate arguments. It is the only template that can produce
    more than one argument.
  - `m` builds an OSC MIDI argument `[port 0, 0x90|0x80 + channel-1, note, velocity*127]`
    from any record with a `note`. No built-in widget produces note events yet, so the
    Inspector offers `m` only for widgets whose channels include `note`.
- **Resending:** every change resends all of a widget's messages, so a receiver that missed a
  packet resynchronises on the next one.

Values are live state (`state/values.svelte.ts`) and are never saved in presets.

## Live-mode info panel

In Live mode, a touch cannot also mean "select", so the side panel follows the widget touched
last. `GridItem` reports it through a capture-phase `pointerdown`, so the widget still gets the
event. The panel is read-only: it reuses the Inspector's `WidgetPreview` and `WidgetActivity`
components (`views/widget/`), so both views show exactly the same information.

## Receive path

UDP inputs, TCP server sessions, *and replies arriving on output sockets* (many devices answer to
the sender's port) are all decoded and recorded as `IN` events. Decoded packets are also emitted
as `osc://incoming`, which is the hook for future widget feedback (motorised-fader style).

## Navigation (scope by containment)

- `ui.view` picks the **container**: `desk` (the active desk) or `system` (shown as GLOBAL SETTINGS).
- The container's **sections** are `ui.deskView`: `controls | io | monitor | preset`, or
  `ui.systemView`: `device | traffic | library | look`. They are shown as CONTROLS · NETWORK ·
  TRAFFIC · PRESET and NETWORK · TRAFFIC · LIBRARY · LOOK. NETWORK and TRAFFIC exist at both
  levels, so the frame colour (the desk's own, or white for GLOBAL SETTINGS) carries the scope.
- `ContainerTabs.svelte` renders the top row: desk tabs in each desk's identity colour
  (`preset.color`, schema v5), then GLOBAL SETTINGS, set apart.
- `App.svelte` renders the frame. The header paints the frame's top line along its bottom edge,
  and the active tab's background covers it, so tab and frame join like a folder tab. This uses
  no negative margins, so the tab strip can still scroll on phones. The frame border and the
  active section use `--scope`: the desk's colour, or `--fg` for GLOBAL SETTINGS.
- The master controls (PAUSE, LOCK, the all-desk OUT summary) and the global banners sit outside
  the tabs and the frame, because they affect every desk.
- Debug is one component: `scope = deskId` for a desk's TRAFFIC, unscoped for GLOBAL SETTINGS › TRAFFIC.

## Desks (multiple presets at once)

The workspace (`state/preset.svelte.ts`) holds every open desk. `current` is the active desk,
and everything that edits works on it. The network core namespaces endpoints by
**(desk, endpoint id)**:
- `net_apply_config(desk, config)` reconciles only that desk.
- `net_close_desk(desk)` stops it.
- `osc_send(desk, …)` resolves output ids inside that desk.

So two desks can reuse endpoint ids, and closing one never touches the others. Statuses and
debug events carry their `desk`. Live widget values are keyed by widget id, so opening a desk
whose widget ids collide with an open one (a duplicate or re-import) gives it fresh ids first.
The open desks and the active one are stored per device (`openDesks`, `activeDesk`).
`init()` is idempotent, so a webview reload or hot reload can't open a desk twice.

## PAUSE and LOCK

- **PAUSE** is enforced in Rust (`NetworkManager::set_paused`), not the UI.
  - `send` still encodes each message, but instead of writing to the socket it records a
    `blocked` debug event per output, with the exact bytes, and bumps `stats.blocked`.
  - The flag is checked once per message, so a message is never half-sent across outputs.
  - The UI restores a persisted PAUSE *before* any desk's network starts.
- **LOCK** is UI state (`ui.locked`), persisted per device. Widgets receive
  `live = !editing && !locked`, so while locked they ignore pointer and keyboard input
  entirely, and a capture-phase press on the desk bumps `ui.lockNudge` so the LOCK button hints.
  - `Lockable.svelte` wraps editable views in a disabled `<fieldset>`, which natively disables
    every control inside.
  - Locking also leaves edit mode and cancels any open confirmation. Unlocking needs the
    press-and-hold on `LockButton`, never a single keystroke.

## Reconciliation

`net_apply_config` takes the full desired config of one desk. An endpoint is kept only if its config is
identical *and* it is running (or disabled). Everything else is stopped first, which frees its
ports, and then started again. Endpoints that failed are retried on every apply. Each endpoint owns
a `TaskGroup`, and dropping it aborts its tasks and closes its sockets.

## Visual system (TUI)

- **One font, one size.** JetBrains Mono Nerd Font *Mono* (`src/assets/fonts`, OFL) at 13px
  everywhere. Hierarchy comes from case, weight, colour and reverse video, never from size.
  Icons are Nerd Font glyphs (`lib/ui/icons.ts`), so users can paste any Nerd Font icon into a label.
- **Text that doesn't fit turns vertical.** Because every character is the same width,
  "does it fit?" is arithmetic (`lib/ui/textfit.ts`, character width measured once at startup).
  `WidgetFrame` puts a widget's title into its top border if it fits, otherwise down the left
  border (reading bottom-to-top), otherwise truncates it. The status/value goes top-right,
  bottom or down the right border by the same rule.
- **Light / dark.** `appearance.theme.mode` sets `data-mode` on `<html>`. `tokens.css` swaps
  the base colours (registered, so they crossfade) and darkens the status colours. Palette
  colours used as text go through `--accent-text` and `--c-text`: in light mode these are
  darkened mixes of the hue, so bright colours stay readable on paper. Fills and borders keep
  the raw colour.
- **Colour.** The UI is near-black/near-white. Only active things are coloured, from the global
  palette (a device setting since preset schema v4, `state/appearance.svelte.ts`) (`lib/theme/palettes.ts`: six palettes × ten colours). `App.svelte` writes
  `--p0…--p9`, their reverse-video inks `--pN-ink`, and `--accent` to `:root`. They are
  registered with `@property`, so a palette change crossfades. A widget's colour is a palette
  index (`null` = accent).
- **Pixel motion.** Hard offset shadows that widgets sink into when pressed. `steps()` easing
  for state changes (tabs, toggles, lit segments). Dither patterns (inline conic gradients) for
  dissolves and grooves. Continuous things still follow the finger 1:1: fader caps, the graph
  cursor, the switch block while dragged.
- **Widgets.**
  - Button: reverse-video fill, then a dither dissolve on release.
  - Switch: a sliding block on a dithered track.
  - Fader: LED segments that snap to whole segments, plus an exact cap line.
  - Graph: a dot-grid plot, a dashed crosshair, a pixel cursor with lock-on brackets, and a
    trail of pixels that fade out.
  - Knob: a curved fader. The fader's 5 px segments and 2 px gaps, its lit fill, its exact cap
    line and its quarter ticks are bent round a 270° arc (a full ring when endless). They are
    rasterised onto a 2 px cell grid (`widgets/ring.ts`), so the edges step like pixel art.
    Nothing sits in the middle. Endless mode shows a short stepped trail behind the cap.
  - Pads: numbered keys that sink into their shadow.
  - List: a reverse-video cursor that slides to the selection.
  - Armed button: a blinking dither wash. Hold-to-fire: a fill that steps up the key.

## Interaction model

- Widgets use Pointer Events with `setPointerCapture` and `touch-action: none`. Each pointer is
  independent, which gives real multi-touch. A fader is owned by one finger at a time.
- Visual updates are transforms or CSS custom properties only (no layout). The fill follows the
  finger 1:1 while dragging. Programmatic changes (keyboard, double-tap reset) glide.
- Motion tokens (`--t-press` 40 ms, `--t-release` 180 ms with a spring curve) are in
  `lib/theme/tokens.css` and respect `prefers-reduced-motion`.
- The grid is a fixed cols × rows grid stretched to the viewport, with free placement and no
  auto-compaction. Invalid drops (overlap or out of bounds) show a red ghost and spring back.
  Shrinking the grid is refused if widgets would fall outside it.

## Adding a widget type

1. Schema: add `XWidgetSchema` to `lib/model/preset.ts` and to the `WidgetSchema` union.
2. Factory: add a case in `newWidget` and `DEFAULT_SIZE` (`lib/model/factory.ts`).
3. Component: `lib/widgets/X.svelte` taking `{ widget, live }`, calling `emitValue`.
4. Register it in `lib/widgets/registry.ts`, and add an Inspector section.
5. If existing saved presets need changes, bump `CURRENT_SCHEMA_VERSION` and add a step in
   `lib/model/migrations.ts`. Examples: v1→v2 turned toggle-mode buttons into Switch widgets.
   v2→v3 turned free CSS colours into palette indices (nearest RAINBOW colour).
   v3→v4 moved the palette out of presets into a global setting (seeded from the first desk).
   v4→v5 gave each desk an identity colour, derived from its id so it is stable everywhere.
   v5→v6 added the button arm fields (`arm: 'none'` by default) alongside the new knob, pads
   and list types.
   v6→v7 made pads a plain numbered grid. The note props were dropped, and bindings using the
   old channels were remapped: `index`/`note` → `number`, `velocity` → `on`, `m` → `i number`.
6. If its value has named channels, list them in `channelsFor` (registry.ts), and pick its gate
   in `sender.ts` (`continuousRate`).

## Extension points (not built yet)

- Widget feedback from `osc://incoming` (address → widget value).
- OSC bundles with timetags (the codec already decodes them; the sender has no bundle support yet).
- Label widget. Graph spring-back (joystick) mode. Per-orientation layouts for phones.
- Widgets producing `ValueList`s (e.g. a multi-fader bank) and note events (a keyboard). The
  mapping (including the `m` MIDI type) already handles both.
- Android `MulticastLock` plugin (see ANDROID.md).
