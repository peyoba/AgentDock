# Terminal History Preserve Mode Verification

## Goal
Fix AgentDock terminal sessions where previous output disappears and no right-side scrollback is available after Codex/Claude redraws the terminal UI.

## Root Cause
Codex/Claude-style agent CLIs can emit destructive terminal control sequences such as alternate-screen switches (`CSI ?1049 h/l`), clear-screen / clear-scrollback (`CSI 2J`, `CSI 3J`), and cursor repositioning (`CSI H`). xterm interprets these as screen redraws rather than append-only output, so previous context can be overwritten instead of entering scrollback. When there is no retained scrollback, no scrollbar thumb appears.

## Change
- Added renderer terminal history preservation for agent sessions:
  - strips alternate-screen switches, destructive CSI clear/cursor controls, and OSC title sequences before writing output into xterm;
  - normalizes bare carriage returns to newlines so new content appends instead of overwriting earlier text.
- Local shell sessions (`zsh`/`bash`) keep raw terminal control sequences for normal shell/TUI behavior.
- Kept previous scrollback improvements: xterm `scrollback: 50_000` and 5MB main-process replay buffer.
- Made the xterm viewport reserve a stable right-side scrollbar gutter with `overflow-y: scroll !important` and `scrollbar-gutter: stable`.

## Verification
- `npx vitest run tests/app/TerminalPane.test.tsx tests/app/layoutPolish.test.ts` — PASS: 11 tests.
- `npm run typecheck` — PASS.
- `npm run test` — PASS: 23 files / 85 tests.
- `npm run build` — PASS.
- `npm run package:mac` — PASS, regenerated `release/AgentDock-darwin-arm64/AgentDock.app`.
- `codesign --verify --deep --strict --verbose=2 release/AgentDock-darwin-arm64/AgentDock.app` — PASS.
- `git diff --check` — PASS.
- Dist asset scan confirms `scrollback:5e4`, ANSI alternate-screen marker `1049`, `overflow-y:scroll!important`, and `scrollbar-gutter:stable` are present.
- Strict secret scan — PASS.

## User Impact
Agent sessions should now keep previous conversational context in the same terminal output area, and the right-side scroll gutter should remain reserved. Local zsh sessions still behave like a normal terminal.
