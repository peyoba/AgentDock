# Phase 2 Real Terminal & Keychain Verification

Date: 2026-07-02
Scope: Phase 2 MVP real Keychain / real PTY / renderer terminal integration.

## Constraints

- No real API key was used.
- Real Keychain verification used only a test service/account.
- Real PTY verification used only a local safe shell command.
- Renderer/IPC must not return full secrets or full environment snapshots.

## Verification Commands

```bash
npm run workflow:doctor
```

Result: PASS.

```bash
npm run test:workflow
```

Result: PASS — 8 passed.

```bash
npm run test
```

Result: PASS — 14 files / 25 tests.

```bash
npm run build
```

Result: PASS.

```bash
rg -n "(sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{20,}|anthropic-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})" . --glob '!node_modules/**' --glob '!dist/**' --glob '!package-lock.json'
```

Result: PASS — no matches.

## Real Adapter Verification

See `.agent-workflow/verification/2026-07-02-phase-2-real-keychain-pty.md`.

Summary:

- Real macOS Keychain via `keytar`: PASS — test service/account write/read/delete, no real API key.
- Real `node-pty`: PASS — local `printf agentdock-pty-ok`, no real API key.

## Notes

- `keytar` is loaded with `createRequire(import.meta.url)` for NodeNext/CJS native-module compatibility.
- `node-pty` adapter ensures Unix `spawn-helper` executable permissions before spawn to avoid local `posix_spawnp failed` errors.
- CLI launch with real Claude/Codex credentials was intentionally not verified because no real API keys/accounts were authorized.
