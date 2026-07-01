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

## End-to-End Safe SessionService Verification

Command used built `dist/main/sessionService.js`, real `createKeytarAdapter()`, and real `createNodePtyAdapter()`.

Flow:

1. Write test-only secret to macOS Keychain under service `AgentDock E2E Test`.
2. Launch `SessionService` with real Keychain and real PTY adapters.
3. Use a Claude-shaped test profile with fake endpoint and test Keychain account.
4. Run local safe command `printf agentdock-e2e-pty-ok`.
5. Observe terminal output through `SessionService.onTerminalOutput`.
6. Confirm returned payload does not contain the test secret.
7. Delete the test Keychain secret.

Observed output:

```json
{
  "session": {
    "id": "session-1",
    "status": "running",
    "title": "E2E Test Profile · AgentDock"
  },
  "marker": "agentdock-e2e-pty-ok",
  "timedOut": false,
  "output": "agentdock-e2e-pty-ok",
  "sawMarker": true,
  "payloadContainsSecret": false
}
```

Result: PASS.
