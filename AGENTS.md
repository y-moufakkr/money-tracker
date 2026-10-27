This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md

## Project rules (Money Tracker)

Read [PLAN.md](PLAN.md) and [PROGRESS.md](PROGRESS.md) first. Financial correctness comes before everything else: **one dirham is never counted twice.**

- Amounts are integer minor units (`*_minor`). Never store floats. Parse and format only via `src/domain/money.ts`.
- All writes that move money go through `src/services/ledger.ts` (or `reconciliation.ts`) inside `db.transaction`. Balances are only computed in `src/services/balances.ts` and never stored.
- Business money is never added to personal totals. Company ↔ personal transfers require a `transfer_class`.
- Schema changes need a new numbered migration in `src/db/migrations.ts`. Never edit an applied migration. A new user-data table also needs `changeTriggersSql(table)` in its migration (backup change tracking; a test enforces it).
- Backup/restore is not sync. Snapshots only via `takeSnapshot` (`wal_checkpoint(TRUNCATE)` + `VACUUM INTO`); never copy the live DB file. Drive scope stays `drive.appdata`; never change `dev.moneytracker.app` or the EAS keystore (see docs/google-oauth.md).
- Services depend on the `Db` interface (`src/db/types.ts`), so they can be tested with `node:sqlite`. Add a test in `src/services/*.test.ts` for every ledger rule.
- Before finishing: `npx tsc --noEmit`, `npx eslint src`, `npm test`, then update PROGRESS.md.
