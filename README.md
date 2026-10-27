# Money Tracker

An offline-first personal and SARL finance app for Android, built with Expo SDK 58 and SQLite. It tracks where every dirham is, what you earn and spend, and keeps company money separate from personal money.

- Architecture, ledger rules and schema: [PLAN.md](PLAN.md)
- Status and remaining work: [PROGRESS.md](PROGRESS.md)
- Original requirements: [project.md](project.md)

## Commands

```bash
npm install          # install dependencies
npm start            # start Metro (scan the QR code with Expo Go)
npm test             # ledger + domain unit tests (Node's built-in SQLite)
npm run typecheck    # TypeScript
npx eslint src       # lint
npm run verify       # typecheck + tests
```

## Running on the Samsung Galaxy S22

### Option A — Expo Go (fastest, works for Phase 1–3)

Phase 1 uses only modules bundled in Expo Go, so no build is needed.

1. On the S22, install **Expo Go** from the Play Store.
2. Connect the phone and the Mac to the same Wi-Fi.
3. Run `npm start` on the Mac and scan the QR code with Expo Go.
   - If the network blocks local traffic, run `npx expo start --tunnel` instead.

Data lives inside Expo Go's sandbox for this project. It's fine for trying things out, but use Option B or C for real day-to-day data.

### Option B — Install a standalone APK with free EAS cloud builds (no Android Studio needed)

```bash
npx eas-cli@latest login                                  # free Expo account
npx eas-cli@latest build --platform android --profile preview
```

When the build finishes, open the link on the S22 and install the APK. Allow "Install unknown apps" for your browser when Android asks. The free tier is enough for occasional builds, and there is no subscription.

### Option C — Build locally on the Mac (USB)

One-time setup:

1. Install Android Studio. Then, in *SDK Manager*, install **Android SDK Platform-Tools** and the latest **Android SDK Platform**.
   This Mac currently has a partial SDK at `~/Library/Android/sdk`, **no JDK and no `adb`**.
2. Point the shell at the SDK and at Android Studio's bundled JDK (add to `~/.zshrc`):
   ```bash
   export ANDROID_HOME="$HOME/Library/Android/sdk"
   export PATH="$ANDROID_HOME/platform-tools:$PATH"
   export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
   ```
3. On the S22, enable developer mode: *Settings → About phone → Software information → tap "Build number" 7 times*. Then turn on *Developer options → USB debugging*.
4. Plug in the phone, accept the "Allow USB debugging" prompt, and check that `adb devices` lists it.

Build and install:

```bash
npx expo run:android --device                 # debug build on the connected phone
npx expo run:android --device --variant release   # release build (signed with the debug key — see note)
```

For wireless debugging: *Developer options → Wireless debugging → Pair device with pairing code*. Then run `adb pair <ip:port>` followed by `adb connect <ip:port>`.

Notes:
- `npx expo run:android` generates the `android/` folder (Continuous Native Generation). Never edit it by hand; configure through `app.json`.
- **Signing:** the generated release build is signed with the debug keystore. That's fine for your own phone. Before Phase 4, create a real upload keystore, because Google Sign-In is tied to the signing certificate's SHA-1.
- **The folder name contains a space** (`money tracker`). Some native toolchains (CMake/NDK) handle spaces in paths badly. If a native build fails with path errors, rename the folder to `money-tracker`.
- **Watchman on this Mac is broken** (`libfmt.11.dylib` missing). Fix it with `brew reinstall fmt watchman`. Metro and Jest still work without it (Jest is configured with `watchman: false`).

### Testing data persistence

- Data is stored in `money-tracker.db` inside the app's private storage. It survives app restarts and APK upgrades installed over the existing app.
- **Uninstalling the app deletes the data.** Until Google Drive backup lands (Phase 4), don't uninstall the app with real data in it.
- To check: add a location and an expense, force-stop the app (*Settings → Apps → Money Tracker → Force stop*), reopen it, and confirm both are still there. Then install a newer APK over it and check again.
- Backup and restore after a reinstall will be documented in Phase 4.

### Google authentication (Phase 4)

Phase 4 will add Google Sign-In (`@react-native-google-signin/google-signin`) and Drive's `drive.appdata` scope. It needs:
- An Android OAuth client in Google Cloud Console for package `dev.moneytracker.app` and the SHA-1 of the signing key (`keytool -list -v -keystore <keystore>`).
- A development build (Option B or C), because Expo Go can't load this native module.

Change `android.package` in `app.json` **before** creating the OAuth client if you want a different ID.

## Web preview

`npx expo start --web` runs the app in a browser using expo-sqlite's WebAssembly build (see `metro.config.js`). It's handy for quick UI checks; the app targets Android, and native tabs render as a top bar on web.
