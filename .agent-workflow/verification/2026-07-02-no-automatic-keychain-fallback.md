# No Automatic Keychain Fallback Verification

## Goal
Stop repeated macOS system password prompts in local/ad-hoc AgentDock builds.

## Root Cause
`src/main/main.ts` still wired `createVaultBackedSecretAdapter` with `createKeytarAdapter()` as an automatic fallback. When the local encrypted vault did not contain a profile secret, launch/model fetch/show-key flows attempted a legacy Keychain read, causing macOS password prompts.

## Change
- Main process now uses `createEncryptedVaultAdapter` directly for `secrets.vault.json`.
- Automatic Keychain fallback is not used in the app entrypoint.
- Existing legacy adapter code remains in source for tests/future explicit migration, but `dist/main/main.js` and the packaged `app.asar` main entry do not import it.
- Users must paste an API Key once in Interface Config if the local vault lacks that key; after saving, reads come from the local encrypted vault.

## Verification
- `npx vitest run tests/app/mainSecretStorage.test.ts` — PASS, test fails if main reintroduces `createKeytarAdapter` or `createVaultBackedSecretAdapter`.
- `npx vitest run tests/app/mainSecretStorage.test.ts tests/app/secretVaultAdapter.test.ts tests/app/App.test.tsx tests/app/modelFetchService.test.ts` — PASS: 31 tests.
- `npm run test` — PASS: 23 files / 80 tests.
- `npm run build` — PASS.
- `npm run package:mac` — PASS, regenerated `release/AgentDock-darwin-arm64/AgentDock.app`.
- `codesign --verify --deep --strict --verbose=2 release/AgentDock-darwin-arm64/AgentDock.app` — PASS.
- `git diff --check` — PASS.
- Packaged asar entry scan for `createKeytarAdapter` / `createVaultBackedSecretAdapter` / `keychainAdapter` — PASS: no matches in main entry.
- Strict secret scan over source/tests/docs excluding mockup assets — PASS: no real API key/token/private key patterns found.

## User Impact
The app should no longer ask for the Mac system password during normal startup, launching terminal sessions, model fetch, or explicit API key display. If a profile key exists only in the old Keychain location, AgentDock will now show a missing-key error instead of prompting; paste/save the key once in the API config page to store it in the local encrypted vault.
