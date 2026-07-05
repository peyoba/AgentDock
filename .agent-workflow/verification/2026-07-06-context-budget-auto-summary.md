# Context Budget Auto Summary Verification

## Scope

Phase 1 implementation of context pressure guard, manual summary job plumbing, summary/handoff local storage, summary-based continuation API, and shared-context summary preference.

Phase 2 implementation of provider-specific one-shot summary runner for Claude `--print` and Codex `exec`, wired into the main-process summary job path.

## Risk Level

L3.

Reasons: summary feature touches LLM runner boundaries, API key environment boundaries, workspace `.agentdock/context/` files, Electron IPC, renderer UI, session history, and PTY-backed session metadata.

## Commands

| Command | Result |
|---------|--------|
| `npx vitest run tests/app/contextBudgetEstimator.test.ts tests/app/sessionSummaryStore.test.ts tests/app/summaryJobService.test.ts tests/app/sessionService.test.ts tests/app/workspaceContextStore.test.ts tests/app/sessionServiceTerminal.test.ts tests/app/preloadTypes.test.ts tests/app/App.test.tsx` | PASS: 8 files / 106 tests |
| `npm run workflow:doctor` | PASS |
| `npm run test:workflow` | PASS: 8 passed |
| `npm test` | PASS: 36 files / 231 tests |
| `npm run typecheck` | PASS |
| `npm run build` | PASS: build completed; Vite chunk-size warning remains |
| `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run package:mac` | PASS: `release/packages/20260706-003943/AgentDock-darwin-arm64/AgentDock.app` |
| `codesign --verify --deep --strict --verbose=2 release/packages/20260706-003943/AgentDock-darwin-arm64/AgentDock.app` | PASS |
| `git diff --check` | PASS |
| `claude --help` | PASS: local Claude CLI exists and documents `--print`, `--output-format text`, `--no-session-persistence`, and `--permission-mode plan` |
| `codex exec --help` | PASS: local Codex CLI exists and documents `exec`, `--cd`, `--sandbox read-only`, `--ask-for-approval never`, `--skip-git-repo-check`, and `--ephemeral` |
| `npx vitest run tests/app/summaryRunner.test.ts` RED | PASS: failed before implementation because `src/main/summaryRunner` did not exist |
| `npx vitest run tests/app/summaryRunner.test.ts` | PASS: 1 file / 3 tests |
| `npx vitest run tests/app/summaryRunner.test.ts tests/app/summaryJobService.test.ts tests/app/sessionService.test.ts tests/app/sessionServiceTerminal.test.ts tests/app/App.test.tsx` | PASS: 5 files / 92 tests |
| `npm run workflow:doctor` | PASS |
| `npm run test:workflow` | PASS: 8 passed |
| `npm test` | PASS: 37 files / 234 tests |
| `npm run typecheck` | PASS |
| `npm run build` | PASS: build completed; Vite chunk-size warning remains |
| `git diff --check` | PASS |
| key-like scan on `src/main/summaryRunner.ts`, `tests/app/summaryRunner.test.ts`, and `src/main/main.ts` | PASS: no matches |
| `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run package:mac` | PASS: `release/packages/20260706-010227/AgentDock-darwin-arm64/AgentDock.app` |
| `codesign --verify --deep --strict --verbose=2 release/packages/20260706-010227/AgentDock-darwin-arm64/AgentDock.app` | PASS |
| packaged `app.asar` marker scan | PASS: contains `/dist/main/summaryRunner.js`, `createProfileSummaryRunner`, Claude runner marker, and Codex runner marker |

## Real Verification Notes

- Claude/Codex one-shot summary runner is now enabled through main-process `sessions:summarize`.
- Summary tests use a fake PTY runner to verify command construction, environment injection, output collection, ANSI cleanup, error sanitization, input redaction, Markdown validation, file writes, and continuation sequencing.
- Real CLI capability was checked with `claude --help` and `codex exec --help`.
- A real LLM summary call was not executed because it would consume the user's saved API credentials/quota. This remains the only unverified external-service step.
- Secret boundary checks are covered by tests that verify redaction before runner input and no full secret in summary delegation metadata.
- Codex `CODEX_HOME/config.toml` runner test verifies API key is injected only through environment and is not written to config.
- Workspace context writes were verified with real temp filesystem paths under `.agentdock/context/`.

## Result

Implementation is verified for Phase 1 plumbing, UI behavior, and Phase 2 provider-specific CLI runner wiring. External Claude/Codex API execution is not claimed as smoke-tested because no real summary request was sent.
