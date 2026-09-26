# Android

The Android project isn't generated yet, because it needs the SDK/NDK. Everything else is
already cross-platform: the Rust core (`#[cfg_attr(mobile, tauri::mobile_entry_point)]` in
`src-tauri/src/lib.rs`), haptics (`tauri-plugin-haptics`, registered only on mobile), and the
mobile capability file (`src-tauri/capabilities/mobile.json`).

## 1. Install the toolchain

1. **Android Studio** → SDK Manager. Install:
   - Android SDK Platform (API 34 or newer)
   - Android SDK Build-Tools, Platform-Tools, Command-line Tools
   - **NDK (Side by side)**
2. **JDK 17.** Android Studio's bundled JBR works.
3. Environment variables (Windows example):

   ```powershell
   [Environment]::SetEnvironmentVariable('JAVA_HOME', 'C:\Program Files\Android\Android Studio\jbr', 'User')
   [Environment]::SetEnvironmentVariable('ANDROID_HOME', "$env:LOCALAPPDATA\Android\Sdk", 'User')
   # Use the NDK version folder you installed:
   [Environment]::SetEnvironmentVariable('NDK_HOME', "$env:LOCALAPPDATA\Android\Sdk\ndk\<version>", 'User')
   ```

4. Rust targets:

   ```sh
   rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
   ```

## 2. Generate the Android project

```sh
npm run tauri android init     # creates src-tauri/gen/android (commit it)
npm run tauri android dev      # run on a device/emulator (same Wi-Fi as your OSC gear)
npm run tauri android build    # APK/AAB
```

`vite.config.ts` already honours `TAURI_DEV_HOST`, so the device can reach the dev server.

## 3. Manifest permissions

Edit `src-tauri/gen/android/app/src/main/AndroidManifest.xml` and make sure these are present:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
<uses-permission android:name="android.permission.CHANGE_WIFI_MULTICAST_STATE" />
<uses-permission android:name="android.permission.VIBRATE" />
```

`INTERNET` is required for any socket. The Wi-Fi and multicast permissions are needed for
receiving multicast/broadcast (below). `VIBRATE` is for haptics.

## 4. Multicast / broadcast *receive* on Android (planned plugin)

Android Wi-Fi drivers drop inbound multicast and broadcast packets unless an app holds a
`WifiManager.MulticastLock`. Sending works without it. Receiving on a multicast input, or
catching broadcast replies, won't work until it is held.

Plan: a small Tauri mobile plugin (Kotlin) exposing `acquire_multicast_lock` /
`release_multicast_lock`. `NetworkManager::apply` would call it whenever any enabled input has a
`multicastGroup` (or listens on 0.0.0.0), and show "multicast lock held" in the endpoint
status. Until then, TRAFFIC simply shows nothing arriving, which is the honest signal.

## 5. Device notes

- Keep the phone on the same subnet as the receiver. Some guest networks isolate clients
  ("AP isolation"), and then no unicast works either.
- The app's layout switches to a bottom-sheet Inspector and icon-only tabs below 760 px.
- Consider disabling battery optimisation for the app during a show. Android can throttle
  background networking when the screen is off.
