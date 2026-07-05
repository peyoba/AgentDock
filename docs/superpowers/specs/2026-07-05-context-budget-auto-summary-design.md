# Context Budget Guard And Auto Summary Design

## Status

Approved for design by the user on 2026-07-05. Implementation has not started.

## Risk Level

L3.

This feature touches LLM invocation, API key injection boundaries, workspace files, session history, terminal sessions, and user-visible continuation workflows. It must use the standard L3 flow before implementation.

## Problem

AgentDock can preserve terminal output locally, but preserved output is not the same as model context. Long agent sessions still become expensive and fragile because project instructions, skill docs, command output, test logs, and repeated terminal replay can consume the active Claude/Codex conversation context quickly.

The current 5MB session history limit is a local persistence guard. It does not prevent the active agent conversation from carrying too much low-value context, and it does not give the user a clean way to summarize and continue in a fresh session.

## Goals

- Warn the user when a session is likely accumulating too much context.
- Let the user summarize a long session into a short local handoff.
- Let the user continue work in a new session using that handoff instead of the full transcript.
- Support an opt-in automatic summarization mode after the manual workflow is reliable.
- Keep the workflow terminal-first and lightweight.
- Keep full API keys out of renderer state, IPC responses, logs, summaries, and workspace context files.

## Non-Goals

- No API gateway, provider router, fallback service, cost dashboard, or request log.
- No vector database, semantic search service, cloud sync, or team memory.
- No attempt to modify Claude/Codex internal context-window behavior.
- No automatic injection of full transcripts into new sessions.
- No silent model calls by default.

## Product Behavior

### Context Budget Guard

AgentDock will show a small context pressure indicator for each agent session:

- `低`: output and workspace context are comfortably below warning thresholds.
- `中`: output is growing and the user should consider summarizing soon.
- `高`: summarizing and continuing in a new session is recommended.
- `已满`: local history hit the save limit or summary input would exceed the configured cap.

The indicator is an estimate based on local byte counts and growth rate. It must not claim to be an exact model token count.

Primary inputs:

- session history buffer bytes
- workspace transcript bytes
- `shared-context.md` bytes
- recent output growth rate
- whether the 5MB history limit has been reached

Initial thresholds:

- `低`: pressure score below 50.
- `中`: pressure score from 50 to 79.
- `高`: pressure score from 80 to 99.
- `已满`: pressure score 100 or local history limit reached.

The first pressure score should be a simple maximum of normalized local-size signals, not a complex weighted model. Implementation may tune the constants after real session data is inspected, but the UI state machine remains the same.

### Manual Summary Workflow

The first implementation should expose explicit user actions:

- `总结当前会话`
- `总结并续开`

When the user starts summarization, AgentDock shows the selected summary provider profile, the estimated input size, and the target output files. The original terminal keeps running unless the user explicitly stops it.

The default summary provider is the current session profile. A later settings option may let the user choose a dedicated summarizer profile per workspace, but Phase 1 does not require that settings UI.

Summary generation reads:

- the previous summary for this session, if present
- a capped tail of the redacted session transcript
- minimal session metadata: profile id, workspace id, command, timestamps, exit status

Summary generation writes:

- `.agentdock/context/summaries/<session-id>.md`
- `.agentdock/context/handoffs/<session-id>.md`

The handoff is the short file intended for the next session. The full transcript remains local history and is not injected by default.

### Continue Workflow

`总结并续开` starts a new session with the same profile, workspace, and command after a successful summary. The new session should surface the handoff path clearly and provide a copyable startup prompt:

```text
Read the AgentDock handoff first, then continue the task:
<handoff-file-path>
```

Automatic stdin injection into the new CLI is not required for the first implementation. If added later, it must be a visible opt-in behavior because agent CLIs differ in startup timing and prompt handling.

### Optional Auto Summary

Automatic summarization is a setting, default off.

When enabled, AgentDock may run one summary job after the session reaches the high-pressure threshold. It must rate-limit repeated summaries and show a visible status when a summary job is running or failed.

Silent background calls are not allowed in the default configuration.

## Summary Content

The summary and handoff should use stable Markdown headings:

```markdown
# AgentDock Session Summary

## Current Goal

## Decisions

## Files And Areas Touched

## Commands And Verification

## Problems And Risks

## Next Steps

## Source
```

`Source` must include the original transcript path, the byte range or tail size used, generation time, and summary provider profile id. It must not include full environment variables or secrets.

The generated Markdown must be validated before writing:

- required headings are present
- file size is below the configured summary limit
- obvious secret patterns are redacted
- output is plain Markdown, not JSON hidden inside Markdown

If validation fails, the summary job fails visibly and the terminal session continues unaffected.

## Architecture

### Main Process

Add small, focused modules rather than extending unrelated stores:

- `contextBudgetEstimator`: computes pressure from local sizes and status.
- `sessionSummaryStore`: reads/writes summary and handoff files under `.agentdock/context/`.
- `summaryJobService`: orchestrates redaction, capped input assembly, one-shot summarizer execution, validation, and result persistence.

The summarizer should use the existing profile/secret/PTY environment boundaries. Implementation must verify the actual one-shot command support for each supported CLI before enabling that provider. Unsupported providers should be reported as unavailable instead of guessed.

### Renderer

Keep the UI terminal-first:

- compact pressure badge in session details or tab metadata
- warning row only when pressure is `高` or `已满`
- actions: `总结当前会话`, `总结并续开`, `打开摘要`, `复制续接提示`
- no new dashboard

### IPC And Preload

Expose minimal whitelisted methods:

- get context pressure for sessions
- start summary job
- read summary metadata or content
- continue from handoff

IPC responses must not include full secrets, full environment objects, or raw unredacted transcript content.

## Data Flow

1. PTY output continues to append to session history and workspace transcript.
2. The estimator updates pressure from local file and buffer sizes.
3. The user clicks `总结当前会话` or `总结并续开`.
4. Main process gathers previous summary and a capped redacted transcript tail.
5. A one-shot summarizer runs with a selected profile and isolated environment.
6. Output is validated and scanned for secret-like patterns.
7. Summary and handoff Markdown files are written locally.
8. `shared-context.md` is rebuilt to prefer summaries plus a small recent output tail.
9. If requested, a new session starts and displays the handoff path and startup prompt.

## Security Requirements

- Full API keys must never be written to summary input files, summary output files, handoffs, renderer state, IPC payloads, logs, or test fixtures.
- Redaction happens before summary input is sent to a summarizer.
- Summary failures must not print secrets in error messages.
- Summary jobs must use the same secret adapter boundary as session launch.
- Renderer can display provider id/name and masked key state only.
- Workspace files under `.agentdock/context/` remain git-excluded.

## Error Handling

- Summarizer unavailable: show a clear unavailable state and keep the session running.
- Summarizer exits non-zero: record a failed job status without changing existing summaries.
- Output validation fails: do not write the invalid summary; show the validation reason.
- File write fails: keep the generated output in memory only long enough to report failure, then discard it.
- New session launch fails after summary succeeds: keep the summary and handoff, and show the handoff path for manual continuation.

## Testing Requirements

Unit tests:

- pressure estimator thresholds
- secret redaction before summarizer input
- summary Markdown validation
- summary store path generation and git-exclude behavior
- failed summary jobs do not affect active sessions

IPC/preload tests:

- whitelisted summary methods exist
- responses do not include full secrets, full env objects, or raw transcript content

Renderer tests:

- pressure warning appears at high pressure
- manual summary action calls the IPC method
- `总结并续开` starts a new session only after summary success
- failure states are visible and non-blocking

Integration tests:

- fake summarizer produces summary and handoff files
- `shared-context.md` prefers summary content over large transcript tails
- continuation session uses the same profile/workspace/command without copying full transcript

L3 real verification:

- real node-pty/CLI smoke for each enabled summarizer provider
- real workspace `.agentdock/context/` file creation
- secret-pattern scan of summaries, handoffs, shared context, and logs
- `npm run workflow:doctor`
- `npm run typecheck`
- `npm run build`
- relevant test suite

## Rollout

Phase 1:

- manual context pressure indicator
- manual summary job
- summary and handoff files
- summary-based continuation action

Phase 2:

- opt-in automatic summarization at high pressure
- rate limiting and visible job status

Phase 3:

- provider-specific refinements after real Claude/Codex CLI smoke results are known

## Implementation Defaults

- Summary provider: current session profile.
- Phase 1 continuation: copyable startup prompt only, no automatic stdin injection.
- Phase 1 thresholds: `低` below 50, `中` 50-79, `高` 80-99, `已满` 100 or history limit reached.
