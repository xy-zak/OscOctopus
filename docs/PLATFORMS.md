# Platforms

The Rust core uses only portable APIs (`tokio`, `socket2`, `if-addrs`). Nothing in the socket code
is OS-specific, so every platform runs the same networking. What differs between systems is the
setup: firewalls, permissions and entitlements. This page lists them.

## Support matrix

| Feature | Windows | Linux | macOS | Android | iOS |
| --- | :-: | :-: | :-: | :-: | :-: |
| Build and run | ✓ | ✓ | ○ | ○ | ○ |
| UDP unicast send / receive | T | T | ✓ | ✓ | P |
| UDP broadcast send | ✓ | ✓ | ✓ | ✓ | P |
| UDP multicast send | ✓ | ✓ | ✓ | ✓ | P |
| UDP broadcast / multicast receive | F | ✓ | F | — | P |
| TCP client (SLIP, length-prefix) | T | T | ✓ | ✓ | P |
| TCP server (listen for clients) | T | T | F | ✓ | P |
| OSC input driving widgets | T | T | ✓ | ✓ | P |
| Sync: sessions, shared desks (TCP) | T | T | F | ✓ | P |
| Sync: LAN discovery (mDNS) | F | ✓ | F | — | P |
| Haptics | — | — | — | ✓ | ✓ |

**Legend**

- **T:** covered by the real-socket tests (`src-tauri/tests/loopback.rs`, `input.rs`,
  `sync.rs`), which CI runs on Windows and Linux.
- **✓:** supported; it uses the same code path, but isn't tested automatically on this OS.
- **F:** works once the OS firewall allows it (see below).
- **P:** needs an OS permission or entitlement (see [APPLE.md](APPLE.md)).
- **○:** planned; no build has been made on this OS yet (see its section).
- **—:** not available yet.

Whatever happens, TRAFFIC shows the OS's own error text for every failed send, bind or connect,
so a platform restriction is always visible rather than silent.

## Sync on every OS

- **The sync port.** Each app listens on TCP **9701** (GLOBAL SETTINGS › SYNC › Connection; if the
  port is taken, a free one is used and shown there). Other devices must be able to reach it:
  allow the app through the firewall on *private* networks, or open the port (see each OS below).
- **Discovery** uses mDNS (UDP 5353, multicast `224.0.0.251`) to find apps in the same session.
  Networks that block multicast (guest Wi-Fi, some corporate networks, many VPNs) need **devices
  by address** instead: add the other app's `host:port`. Only one side needs to add the other.
- **Two instances on one machine** (for testing): start the second with its own profile,
  `OSCOCTOPUS_PROFILE=b npm run tauri dev` (PowerShell: `$env:OSCOCTOPUS_PROFILE='b'; npm run
  tauri dev`). It gets its own presets, settings and device identity, and falls back to a free
  sync port.
- **Clocks.** Edits are ordered by a clock that tolerates normal drift. A device whose clock is
  more than 60 s ahead has its edits refused (SYNC shows *clock is N s ahead*). Keep automatic
  time on.

## Windows

- **Toolchain.** Rust with the MSVC target, plus Visual Studio Build Tools with *Desktop
  development with C++*. WebView2 is preinstalled on Windows 10/11, and the installer bundles its
  bootstrapper.
- **Firewall.** The first time the app listens on a non-loopback address (an input on `0.0.0.0` or
  a LAN IP), Windows Defender Firewall asks whether to allow it. Allow it for *private* networks,
  or inputs receive nothing from the LAN. To change it later: *Windows Security → Firewall &
  network protection → Allow an app through firewall*.
- **"Port unreachable" on outputs.** When a UDP output sends to a host where nothing is
  listening, Windows reports it on the socket's next receive. TRAFFIC shows it as *ICMP port
  unreachable from …: nothing is listening there*. This is informational: the packet did leave.
- **Sync.** The firewall prompt also covers the sync port; allow *private* networks. On a
  network marked *Public*, Windows blocks mDNS discovery and incoming sync connections: mark it
  *Private* (*Settings → Network → Properties*), or add devices by address from the other side.

## Linux

- **Toolchain.** Rust (stable) plus the WebKitGTK development packages:

  ```sh
  # Debian / Ubuntu
  sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev \
    libayatana-appindicator3-dev librsvg2-dev
  # Fedora
  sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file libappindicator-gtk3-devel \
    librsvg2-devel libxdo-devel && sudo dnf group install "c-development"
  # Arch
  sudo pacman -S --needed webkit2gtk-4.1 base-devel curl wget file openssl appmenu-gtk-module \
    libappindicator-gtk3 librsvg xdotool
  ```

- **Ports below 1024** need root (or `CAP_NET_BIND_SERVICE`). Use higher ports for inputs.
- **Firewall.** If a firewall is active, open the input ports, for example
  `sudo ufw allow 9000/udp`, or
  `sudo firewall-cmd --add-port=9000/udp --permanent && sudo firewall-cmd --reload`. For sync,
  open `9701/tcp` and mDNS (`sudo ufw allow 5353/udp`, or firewalld's `mdns` service).
- **Multicast** follows the routing table. If a group should use a specific interface, set the
  output's *Send from (bind)* address, or the input's bind address, to that interface's IP.

## macOS and iOS

See [APPLE.md](APPLE.md). No build has been made yet because it needs a Mac with Xcode.
- **macOS:** the application firewall prompts on the first non-loopback listen (inputs and
  the sync port).
- **iOS:** needs the Local Network permission, plus Apple's multicast entitlement for broadcast
  and multicast. Sync discovery also needs `NSBonjourServices` = `_oscoctopus._tcp` in
  Info.plist; without it, add devices by address.

## Android

See [ANDROID.md](ANDROID.md). The Android project isn't generated yet, because it needs the
SDK/NDK. Sending works everywhere. Receiving broadcast or multicast needs a `MulticastLock`,
which is a planned plugin; until then those inputs receive nothing, and TRAFFIC shows exactly that.
The same lock is needed for sync discovery (mDNS), so on Android, sync peers are added by address
for now (sessions and shared desks themselves work).
