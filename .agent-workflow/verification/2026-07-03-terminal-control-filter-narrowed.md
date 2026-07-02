# Terminal Control Filter Narrowed Verification

## Goal
Fix the regression where Codex/Claude terminal startup screens became garbled after the history-preservation change.

## Root Cause
The first history-preservation filter removed too many ANSI control sequences, including normal cursor movement, screen-clear, and SGR color/style sequences that agent CLIs rely on for interactive rendering. That caused repeated redraw fragments and squeezed text in the terminal.

## Change
- Narrowed `preserveTerminalHistoryOutput` so it only strips:
  - alternate-screen enter/exit: `CSI ?1047/1048/1049 h/l`;
  - clear-scrollback: `CSI 3J`;
  - OSC title sequences.
- It no longer strips normal cursor movement, `CSI 2J`, `CSI H`, colors, or carriage returns.
- Local shell sessions still receive raw output.

## Verification
- `npx vitest run tests/app/TerminalPane.test.tsx tests/app/layoutPolish.test.ts` — PASS: 11 tests.
- `npm run typecheck` — PASS.
- `npm run test` — PASS: 23 files / 85 tests.
- `npm run build` — PASS.
- `npm run package:mac` — PASS, regenerated `release/AgentDock-darwin-arm64/AgentDock.app`.
- `codesign --verify --deep --strict --verbose=2 release/AgentDock-darwin-arm64/AgentDock.app` — PASS.
- `git diff --check` — PASS.
- Strict secret scan — PASS.

## User Impact
Codex/Claude startup and thinking screens should render normally again, while the app still blocks the specific control sequences most likely to erase scrollback history.
