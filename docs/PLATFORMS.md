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
| Haptics | — | — | — | ✓ | ✓ |

**Legend**

- **T:** covered by the real-socket loopback tests (`src-tauri/tests/loopback.rs`), which CI runs
  on Windows and Linux.
- **✓:** supported; it uses the same code path, but isn't tested automatically on this OS.
- **F:** works once the OS firewall allows it (see below).
- **P:** needs an OS permission or entitlement (see [APPLE.md](APPLE.md)).
- **○:** planned; no build has been made on this OS yet (see its section).
- **—:** not available yet.

Whatever happens, TRAFFIC shows the OS's own error text for every failed send, bind or connect,
so a platform restriction is always visible rather than silent.

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
  `sudo firewall-cmd --add-port=9000/udp --permanent && sudo firewall-cmd --reload`.
- **Multicast** follows the routing table. If a group should use a specific interface, set the
  output's *Send from (bind)* address, or the input's bind address, to that interface's IP.

## macOS and iOS

See [APPLE.md](APPLE.md). No build has been made yet because it needs a Mac with Xcode.
- **macOS:** the application firewall prompts on the first non-loopback listen.
- **iOS:** needs the Local Network permission, plus Apple's multicast entitlement for broadcast
  and multicast.

## Android

See [ANDROID.md](ANDROID.md). The Android project isn't generated yet, because it needs the
SDK/NDK. Sending works everywhere. Receiving broadcast or multicast needs a `MulticastLock`,
which is a planned plugin; until then those inputs receive nothing, and TRAFFIC shows exactly that.
