# macOS and iOS (planned)

Nothing in the code is Windows-specific: sockets go through `socket2`/`tokio`, and the UI is
built for WebKit (`safari15` build target, container queries, no Chromium-only APIs). Building
requires a Mac with Xcode.

## macOS

```sh
npm run tauri dev
npm run tauri build   # .app / .dmg
```

- The first time the app listens on a non-loopback address, macOS asks to allow incoming
  connections (application firewall).
- For distribution, sign and notarise (Tauri docs: *macOS code signing*). A sandboxed (App
  Store) build needs the `com.apple.security.network.client` and
  `com.apple.security.network.server` entitlements.

## iOS

```sh
rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
npm run tauri ios init
npm run tauri ios dev
```

Required additions to `src-tauri/gen/apple/<app>_iOS/Info.plist`:

```xml
<key>NSLocalNetworkUsageDescription</key>
<string>OscOctopus sends and receives OSC messages to control devices on your local network.</string>
<key>NSBonjourServices</key>
<array><string>_osc._udp</string></array>
```

- **Local Network permission.** Since iOS 14 the first local-network packet triggers a system
  prompt. If the user denies it, sends fail with `EHOSTUNREACH`/"No route to host". The Debug
  view will show that error text verbatim, and the Network view should point the user to
  *Settings → Privacy → Local Network*.
- **Broadcast and multicast** require Apple's
  `com.apple.developer.networking.multicast` entitlement. You must request it from Apple for
  your team. Without it, broadcast/multicast outputs fail with a permission error, which is
  again shown verbatim. Unicast needs no entitlement.
- Haptics already work through `tauri-plugin-haptics` (registered on mobile only).
