# Phase 2 Real Keychain / PTY Verification

Date: 2026-07-02
Scope: Phase 2 Task 2 / Task 3 real adapter integration.

## Constraints

- No real API key was used.
- Keychain verification used a test-only service/account and the value `agentdock-test-secret-not-api-key`.
- PTY verification used only a local safe shell command: `printf agentdock-pty-ok`.
- Renderer/IPC still must not expose full secrets or full environment snapshots.

## Unit / Build Verification

```bash
npm run test -- keychainAdapter ptyAdapter
```

Result: PASS — 2 files / 4 tests.

```bash
npm run build
```

Result: PASS.

## Real macOS Keychain Verification

Command used built `dist/main/adapters/keychainAdapter.js` and `createKeytarAdapter()`.

Observed output:

```json
{
  "service": "AgentDock Integration Test",
  "account": "agentdock-test-57070",
  "wrote": true,
  "readMatches": true,
  "deleted": true,
  "missingIsSafe": true
}
```

Result: PASS.

## Real node-pty Verification

Command used built `dist/main/adapters/ptyAdapter.js` and `createNodePtyAdapter()` with `/bin/sh`, base PATH `/usr/bin:/bin`, and local command `printf agentdock-pty-ok`.

Observed output:

```json
{
  "marker": "agentdock-pty-ok",
  "timedOut": false,
  "output": "agentdock-pty-ok",
  "sawMarker": true
}
```

Result: PASS.

## Findings

- `keytar` is a CJS native module; the adapter uses `createRequire(import.meta.url)` for NodeNext runtime compatibility.
- `node-pty` prebuild `spawn-helper` lacked executable bits in this local install; the adapter now ensures Unix helper executable permission before spawning.
