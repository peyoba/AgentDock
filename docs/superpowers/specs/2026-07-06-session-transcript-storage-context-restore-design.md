# AgentDock Session Transcript Storage And Context Restore Design

## Status

Draft for user review. No implementation has started for this spec.

## Risk Level

L3.

Reasons: this changes session history persistence, PTY output storage, context-summary input assembly, renderer recovery UI, local cleanup behavior, and secret-redaction boundaries.

## Problem

AgentDock currently stores terminal replay text inside `sessions.json` with a 5 MB per-session save limit. That limit protects the local JSON file, but it is not an AI context limit. Showing `终端回放保存已达 5MB` at the bottom of the workbench makes the user think they should open a new AI session, even though the real issue is only local replay storage.

This causes three product problems:

- 5 MB is too small for Claude/Codex terminal output. Test logs, builds, and agent tool output can hit it quickly.
- Large terminal output in `sessions.json` makes the metadata store slower and more fragile.
- Terminal replay history is not the same thing as model context. Restarting the AgentDock window restores the UI transcript, but the AI CLI only sees prior work if AgentDock explicitly injects a summary or recent redacted context into the new terminal session.

## Goals

- Remove the bottom `5MB` warning and its `新开会话` / `存档历史` actions.
- Keep terminal replay useful for humans without treating it as AI context.
- Move large terminal output out of `sessions.json` into per-session transcript files.
- Load only a bounded transcript tail into the terminal UI when replaying history.
- Use `summary + recent redacted transcript tail` as the continuation material for AI sessions.
- Add local cleanup so transcript storage stays bounded without interrupting the user.
- Preserve existing secret boundaries: full API keys must not enter renderer state, IPC responses, summary files, handoff files, logs, or generated prompts.

## Non-Goals

- Do not build a vector database, search index, cloud sync, or dashboard.
- Do not automatically route, fallback, or change provider behavior.
- Do not claim exact model-token accounting from local byte counts.
- Do not silently call Claude/Codex just because the app restarted.
- Do not write full terminal transcripts into the workspace project directory by default.

## Product Behavior

### Terminal Replay

Terminal replay becomes a local human-facing history feature. It should not ask the user to start a new session when local storage reaches an internal threshold.

When a restored session is opened, AgentDock reads a bounded tail of the transcript file and replays that tail into xterm. The first version should use a 20 MB tail cap per session. If the transcript is larger than the tail cap, the UI may show a subtle state in session details such as `已加载最近 20 MB 终端记录`, but it must not display a bottom warning bar.

### Session Metadata

`sessions.json` stores only lightweight metadata:

- session id
- profile id
- workspace id
- command
- title
- status
- timestamps
- resume command
- Claude launch mode
- transcript metadata such as path, byte size, and whether the UI replay tail was truncated

It does not store the terminal output body.

### Transcript Files

Each session writes PTY output to a dedicated transcript file under Electron `userData`, not under the workspace:

```text
<userData>/session-transcripts/<session-id>.log
```

Reasons:

- Terminal output can contain private project data or command output.
- Writing raw transcripts into the workspace risks accidental git inclusion.
- Existing summary and handoff files already write curated, redacted continuation material into `.agentdock/context/`.

The transcript file is append-only during a session. The store must serialize writes per session to avoid corruption.

### Cleanup

Local history stays bounded by two limits:

- Keep the most recent 50 sessions by metadata recency.
- Keep total transcript storage below 1 GB.

When either limit is exceeded, AgentDock removes the oldest non-running session metadata and its transcript file. Running sessions are not deleted. Cleanup is best-effort and must not interrupt active PTY output.

### Context Restore

AgentDock restores AI context through explicit continuation material, not through terminal UI replay.

For Claude/Codex agent sessions, continuation material is assembled from:

- the latest valid AgentDock summary or handoff for the source session, if present
- a recent redacted transcript tail
- minimal session metadata: profile id, workspace id, command, timestamps, exit/interrupted status

When the user resumes, restarts, or continues an interrupted agent session, AgentDock injects a short startup prompt into the new PTY after launch. The prompt should tell the CLI to continue from the AgentDock restore material and include only bounded, redacted content.

If no summary exists, the first version should use a redacted transcript tail fallback. It should not silently run a summary model call. The UI can still offer `总结并续开`, which explicitly uses the configured Claude/Codex profile and consumes local API quota.

### Context Pressure

The context pressure bar should be based on continuation material size, summary status, and transcript tail size. It must not use the old 5 MB replay limit as a direct reason to show `已满`.

The visible prompt should stay focused on AI context:

- `续接材料偏大`
- `建议总结当前会话`
- `总结当前会话`
- `总结并续开`

It should not say that local terminal replay storage is full.

## Architecture

### Main Process

Add or evolve focused modules:

- `sessionHistoryStore`: stores metadata and orchestrates migration from the old JSON shape.
- `sessionTranscriptStore`: appends PTY output, reads bounded tails, reports byte sizes, deletes old transcript files.
- `contextRestore`: builds redacted restore prompts from summary/handoff plus transcript tail.
- `contextBudgetEstimator`: estimates continuation pressure from summary and transcript-tail input, not from local replay capacity.

`SessionService` remains the orchestrator:

- On PTY output: append to in-memory live buffer and transcript file.
- On `readTerminalBuffer`: return transcript tail for persisted sessions and live buffer for active sessions.
- On launch/restart/resume: preserve profile, workspace, command, and Claude launch mode.
- On continuation: inject the restore prompt only after a successful PTY launch.

### Renderer

Remove the bottom `SessionHistoryLimitBar`.

The workbench should still show:

- terminal tabs
- terminal replay tail
- recovery actions for exited/interrupted sessions
- context pressure bar when continuation material is high/full
- summary and continue actions

Session details may include low-priority transcript metadata, but the main workbench must not show storage-limit warnings as a workflow blocker.

### IPC And Preload

Existing IPC methods should remain minimal. Remove or de-emphasize archive-related UI paths.

IPC responses must not include raw full transcript bodies unless the method is specifically `readTerminalBuffer`, and that method must return only the configured bounded tail for persisted transcript files.

### Migration

On startup, if existing `sessions.json` entries include `terminalBuffer`, AgentDock migrates them:

1. Create a transcript file for each entry.
2. Write the old buffer into that transcript file.
3. Replace the JSON entry with metadata and transcript info.
4. Keep a recoverable backup if JSON repair or migration encounters malformed content.

Migration must be idempotent. Running it twice must not duplicate transcript content.

## Security

- Raw transcript files stay in Electron `userData`.
- Summary input and restore prompts must run through secret-like pattern redaction before being sent to Claude/Codex.
- Full API keys must never be written to summary output, handoff files, renderer state, logs, IPC metadata, or restore prompts.
- Errors from transcript migration, cleanup, or summary generation must not include secret values.
- Cleanup must never delete workspace files; it only deletes AgentDock-owned userData transcript files and matching session metadata.

## Error Handling

- Transcript append fails: keep the live in-memory terminal buffer and show a non-secret error only if persistence remains unavailable.
- Transcript tail read fails: keep the session tab, show a recoverable replay error, and allow restart/close actions.
- Migration fails for one session: skip that session, preserve a backup, continue loading other sessions.
- Cleanup fails: log a sanitized warning and retry on the next startup or next session save.
- Restore prompt injection fails after PTY launch: keep the new terminal running and show that context injection failed.

## Testing

Unit tests:

- old `sessions.json` with `terminalBuffer` migrates to transcript files
- `sessions.json` no longer stores large terminal output
- transcript append and tail read preserve UTF-8 boundaries
- tail replay is capped at 20 MB
- cleanup keeps 50 recent sessions and total transcript storage under 1 GB
- cleanup never deletes running sessions
- context restore prompt includes summary/handoff plus redacted transcript tail
- context restore prompt does not include secret-like values

Renderer tests:

- bottom `终端回放保存已达 5MB` bar is gone
- `新开会话` / `存档历史` are not shown as storage-limit actions
- context pressure actions remain visible for high/full continuation material
- restored sessions still render terminal replay

Integration checks:

- `npm run workflow:doctor`
- `npm run test:workflow`
- `npm test`
- `npm run typecheck`
- `npm run build`

Real verification:

- Start a Claude session, produce output larger than the old 5 MB threshold, restart AgentDock, confirm no bottom 5 MB warning appears.
- Confirm the restored terminal shows recent output tail.
- Use `总结并续开` or resume/restart continuation and confirm the new PTY receives a restore prompt.
- Confirm no full API key appears in transcript metadata, summary/handoff files, renderer state, or logs.

## Acceptance Criteria

- The bottom 5 MB warning and archive/new-session storage actions are removed.
- Large terminal output is stored in per-session transcript files, not in `sessions.json`.
- Existing session history migrates without losing recoverable metadata.
- UI replay loads a bounded recent transcript tail.
- Summary and continuation use redacted summary plus recent transcript tail.
- Local transcript cleanup enforces 50 sessions and 1 GB total storage without interrupting running sessions.
- Required tests and builds pass.
- Real Claude/Codex continuation verification is recorded, or any unavailable external provider is explicitly documented.
