# Terminal Scrollback Context Verification

## Goal
Prevent terminal context from disappearing when new output arrives or when switching/remounting terminal tabs.

## Root Cause
- Renderer xterm was created without an explicit large `scrollback`, so terminal history depended on xterm defaults.
- Main process PTY replay buffer kept only 200KB per session; after enough output, earlier context was sliced away and could not be replayed when the terminal remounted.

## Change
- `TerminalPane` now creates xterm with `scrollback: 50_000` lines.
- `SessionService` now keeps a 5MB PTY replay buffer per session instead of 200KB.
- Added regression tests for both renderer scrollback options and main-process multi-megabyte replay buffer retention.

## Verification
- `npx vitest run tests/app/TerminalPane.test.tsx tests/app/sessionServiceTerminal.test.ts` — PASS: 9 tests.
- `npm run test` — PASS: 23 files / 83 tests.
- `npm run build` — PASS.
- `npm run package:mac` — PASS, regenerated `release/AgentDock-darwin-arm64/AgentDock.app`.
- `codesign --verify --deep --strict --verbose=2 release/AgentDock-darwin-arm64/AgentDock.app` — PASS.
- `git diff --check` — PASS.
- Strict secret scan — PASS.

## Notes
This fixes ordinary scrollback truncation and tab/remount replay truncation. If a CLI intentionally uses full-screen alternate-screen control sequences or screen-clear ANSI codes, a future append-only transcript panel may still be needed to preserve a separate plain-text history.
