# Google OAuth configuration (Android)

Used by Phase 4 (Google Sign-In + Drive backup). No backend, no API key, no client secret, no Firebase.

Code: [src/lib/google-auth.ts](../src/lib/google-auth.ts) (configure, sign-in, tokens) and [src/services/drive-api.ts](../src/services/drive-api.ts) (Drive REST, `appDataFolder` only).

## Values

| Item | Value |
|---|---|
| Google Cloud project | `Money Tracker`, id `money-tracker-512916` (separate from Lifting Pal: Drive data is isolated per Cloud project) |
| API enabled | Google Drive API |
| Scope | `https://www.googleapis.com/auth/drive.appdata` only |
| Android package | `dev.moneytracker.app` |
| Signing keystore | EAS-managed (`npx eas-cli credentials` → Android), alias `7f038d0809a2db4d0c94ab5f7ca71ebf` |
| SHA-1 | `7B:D3:37:0E:28:9D:18:D6:88:79:A9:EC:63:17:D9:45:6B:0F:9C:EB` |
| SHA-256 | `A4:56:0E:02:03:E0:0F:3E:0C:2D:46:98:32:3E:95:1B:63:5B:1C:32:3B:A3:22:B9:31:A2:2A:61:2B:A0:40:73` |
| Web client ID (`webClientId`) | `563625916244-m4puampq7t01qacdbb1nrv3i0dmb3oht.apps.googleusercontent.com` |
| Android client ID | `563625916244-lvc1n0l4g7eda7ojloni2i1t9r1lng0v.apps.googleusercontent.com` (not used in code) |

Fingerprints and client IDs are public (they ship inside the APK), so they are safe to commit. The web client's **client secret is never used** (no backend) and must never be committed; the downloaded `client_secret_*.json` files are git-ignored.

## OAuth clients in the Cloud project

1. **Web application** — its client ID is passed to `GoogleSignin.configure({ webClientId })`.
2. **Android** — package `dev.moneytracker.app` + the SHA-1 above. Nothing is copied from it; Google matches the signed APK automatically.

## Things that break sign-in (`DEVELOPER_ERROR`)

- The APK is signed by a different key than the SHA-1 above. Every EAS profile (development, preview, production) uses the same EAS keystore, so one Android client covers them all. A local `npx expo run:android` build is signed with the debug keystore and needs a second Android client with that SHA-1.
- The EAS keystore is replaced or deleted. Never do this: add the new SHA-1 to the Android client first.
- The package name changes.
- The client was created less than ~5 minutes ago.

## Consent screen

External audience, test user = the owner's Gmail. While in "Testing", Google may ask to sign in again every 7 days; publish the app once backup works (`drive.appdata` is a non-sensitive scope).
