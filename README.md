# Money Tracker

An offline-first personal and SARL finance app for Android, built with Expo SDK 58 and SQLite. It tracks where every dirham is, what you earn and spend, and keeps company money separate from personal money.

- Architecture, ledger rules and schema: [PLAN.md](PLAN.md)
- Status and remaining work: [PROGRESS.md](PROGRESS.md)
- Original requirements: [project.md](project.md)

## Commands

```bash
npm install          # install dependencies
npm start            # start Metro (open the development build on the phone)
npm test             # ledger + domain unit tests (Node's built-in SQLite)
npm run typecheck    # TypeScript
npx eslint src       # lint
npm run verify       # typecheck + tests
```

## Running on the Samsung Galaxy S22

### Option A — Development build from EAS (day-to-day development)

Since Phase 4 the app includes Google Sign-In, which Expo Go cannot load. Use a development build instead (free EAS cloud build, same signing key as every other profile, so Google sign-in works):

```bash
npx eas-cli@latest build --platform android --profile development
```

Install the APK from the link on the S22, then run `npm start` on the Mac and open the project from the development build (same Wi-Fi, or `npx expo start --tunnel`). JavaScript changes reload instantly; only native changes (new native modules, `app.json` plugins) need a new build.

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
- **Signing:** a local build is signed with the debug keystore, whose SHA-1 is **not** registered for Google Sign-In: sign-in fails with `DEVELOPER_ERROR`. Either use EAS builds (Options A/B), or add a second Android OAuth client with the debug SHA-1 (see [docs/google-oauth.md](docs/google-oauth.md)).
- **The folder name contains a space** (`money tracker`). Some native toolchains (CMake/NDK) handle spaces in paths badly. If a native build fails with path errors, rename the folder to `money-tracker`.
- **Watchman on this Mac is broken** (`libfmt.11.dylib` missing). Fix it with `brew reinstall fmt watchman`. Metro and Jest still work without it (Jest is configured with `watchman: false`).

### Testing data persistence

- Data is stored in `money-tracker.db` inside the app's private storage. It survives app restarts and APK upgrades installed over the existing app.
- **Uninstalling the app deletes the data on the phone.** Back up first (Settings → Backup & export → Back up now), or save a full backup file (Export data → Full backup file).
- To check: add a location and an expense, force-stop the app (*Settings → Apps → Money Tracker → Force stop*), reopen it, and confirm both are still there. Then install a newer APK over it and check again.

### Backup and restore after a reinstall

1. Settings → Backup & export → **Sign in** with your Google account, then **Back up now**. The backup is uploaded to Money Tracker's private Drive folder (`appDataFolder`), downloaded again and its SHA-256 checked.
2. Note the balances on My Money. Uninstall the app, then reinstall the APK.
3. Settings → Backup & export → Sign in → **Backups & restore**. The backup is listed with its date, device, size, data version and counts. Tap **Check integrity**, then **Restore**.
4. Check that My Money shows the same balances. **Undo restore** puts back what was on the phone before (here, the empty new install).

This is backup and restore, not sync: restoring replaces all data on the phone with the backup. The app warns before replacing changes that are not in any backup, or data from another device.

### Google authentication

Google Sign-In (`@react-native-google-signin/google-signin`) with the `drive.appdata` scope only; no backend, API key or client secret. The Cloud project, client IDs, SHA-1 and what breaks sign-in are in [docs/google-oauth.md](docs/google-oauth.md). Never change `android.package` (`dev.moneytracker.app`) or replace the EAS keystore: both would break sign-in.

## Web preview

`npx expo start --web` runs the app in a browser using expo-sqlite's WebAssembly build (see `metro.config.js`). It's handy for quick UI checks; the app targets Android, and native tabs render as a top bar on web. Google Sign-In and Drive backup are Android-only (the web build says so); exports, full backup files and restoring from a file work on web.
