# 2026-07-02 Local Encrypted Secret Vault Verification

## Goal

Reduce repeated macOS system password prompts by moving normal AgentDock API key saves/reads away from direct Keychain access.

## Change Summary

- Added a local encrypted API key vault at Electron `app.getPath('userData')/secrets.vault.json`.
- New API key saves write to the local encrypted vault, not macOS Keychain.
- Launch reads the vault first.
- Legacy Keychain remains as a read-through fallback only: if a secret is missing from the vault but exists in Keychain, AgentDock migrates it into the vault after the first successful read.
- Renderer/IPC still never returns full secrets or full environment snapshots.
- API config UI copy now says `API Key（本机加密保存）`.

## Verification

| Command | Result |
| --- | --- |
| `npx vitest run tests/app/secretVaultAdapter.test.ts` | PASS: 4 tests |
| `npx vitest run tests/app/mainSecretStorage.test.ts tests/app/secretVaultAdapter.test.ts` | PASS: 5 tests |
| `npx vitest run tests/app/sessionFailure.test.ts tests/app/sessionServiceTerminal.test.ts tests/app/sessionSecurity.test.ts` | PASS: 8 tests |
| `npx vitest run tests/app/App.test.tsx` | PASS: 18 tests |
| `npm run test` | PASS: 22 files / 68 tests |
| `npm run build` | PASS |
| `npm run package:mac` | PASS: generated `release/AgentDock-darwin-arm64/AgentDock.app` |
| `codesign --verify --deep --strict --verbose=2 release/AgentDock-darwin-arm64/AgentDock.app` | PASS |
| `npm run workflow:doctor` | PASS |
| `npm run test:workflow` | PASS: 8 tests |
| `git diff --check` | PASS |

## Security Check

- Checked changed files for common API key/token/private-key patterns.
- `release/`, `dist/`, `node_modules/`, `.git/`, and mockup assets were excluded from the scan.
- No real API keys, private keys, or tokens were found.
- Remaining matches are documentation placeholders: `ANTHROPIC_AUTH_TOKEN=***` and `ANTHROPIC_AUTH_TOKEN=...`.
- Test fake `sk-` string was changed to a non-real `test-...` format to avoid false positives.

## Manual Testing Notes

- Use the rebuilt app at:
  - `/Users/peyoba/Desktop/web/AgentDock/release/AgentDock-darwin-arm64/AgentDock.app`
- To avoid Keychain prompts immediately, open `接口配置`, paste the API Key again, and click `保存配置`; future launches for that profile should use the local encrypted vault.
- If a profile has only an old Keychain secret and no vault entry, the first launch may still prompt once for legacy migration; after migration it should read from the vault.
