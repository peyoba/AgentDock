# Titlebar Alignment Verification

## Goal
Align the macOS traffic-light window controls with the AgentDock brand/logo row.

## Root Cause
The custom `.titlebar-spacer` was 42px tall and included two-line brand text (`h1` + subtitle `p`). macOS traffic-light buttons sit on a compact titlebar centerline, so the AgentDock logo/title appeared visually lower than the left window controls.

## Change
- `.titlebar-spacer` now uses `height: 34px` and `min-height: 34px`.
- The titlebar subtitle paragraph is hidden inside `.titlebar-spacer` to keep the top row single-line.
- The API config ghost button inside the titlebar uses smaller padding so it does not stretch the row.
- Added a regression test to ensure the compact titlebar remains in place.

## Verification
- `npx vitest run tests/app/windowChrome.test.ts` — PASS: 4 tests.
- `npm run test` — PASS: 23 files / 81 tests.
- `npm run build` — PASS.
- `npm run package:mac` — PASS, regenerated `release/AgentDock-darwin-arm64/AgentDock.app`.
- `codesign --verify --deep --strict --verbose=2 release/AgentDock-darwin-arm64/AgentDock.app` — PASS.
- `git diff --check` — PASS.
- Dist CSS scan confirms `height:34px`, `min-height:34px`, and `.titlebar-spacer p{display:none}` are present.

## User Impact
The top-left macOS traffic-light controls should now visually align with the AgentDock logo/title centerline in the packaged app.
