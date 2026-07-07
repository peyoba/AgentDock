# Context Budget Auto Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Phase 1 of context budget guard and opt-in manual summary/continue for AgentDock sessions.

**Architecture:** Add focused main-process modules for context pressure, summary/handoff storage, and summary job orchestration. Expose minimal IPC/preload methods and a compact renderer action surface in the existing terminal-first workbench. Summary execution is injectable for tests and uses existing profile/secret/PTY launch boundaries for real CLI work.

**Tech Stack:** Electron main process, React renderer, TypeScript, Vitest, xterm/node-pty adapters, existing local vault/keychain adapter.

---

## Existing Baseline

The working tree already contains current session history and workspace context work that is not fully committed. Implementation must work with those changes rather than reverting them.

Relevant current files:

- `src/main/sessionService.ts`: launches sessions, appends terminal output, persists history, exposes archive/restart/list.
- `src/main/workspaceContextStore.ts`: writes `.agentdock/context/sessions/*.md` and `shared-context.md`.
- `src/main/stores/sessionHistoryStore.ts`: persists session buffers and 5MB history limit.
- `src/main/main.ts`: creates stores/services and registers IPC handlers.
- `src/preload/preload.cts`: exposes renderer-safe IPC whitelist.
- `src/shared/agentdockTypes.ts`: cross-process request/result types.
- `src/shared/preloadTypes.ts`: renderer API contract and whitelist list.
- `src/renderer/App.tsx`: launch/session actions, terminal area, history limit bar, session details.
- `tests/app/*.test.ts(x)`: existing Vitest suite for main, preload, renderer.

## Files To Create Or Modify

- Create `src/main/contextBudgetEstimator.ts`
  - Pure pressure calculation from local byte counts, growth rate, and history-limit state.
- Create `src/main/sessionSummaryStore.ts`
  - Read/write `.agentdock/context/summaries/<session-id>.md` and `.agentdock/context/handoffs/<session-id>.md`.
  - Validate generated Markdown headings and output size.
  - Redact secret-like patterns.
- Create `src/main/summaryJobService.ts`
  - Assemble capped redacted input, call an injectable summary runner, validate output, write files, and optionally launch continuation session through `SessionService`.
- Modify `src/main/workspaceContextStore.ts`
  - Add summary lookup support and rebuild `shared-context.md` to prefer summaries before transcript tails.
- Modify `src/main/sessionService.ts`
  - Add pressure query and summary job/continue entry points.
  - Keep summary failures non-blocking for running PTY sessions.
- Modify `src/main/main.ts`
  - Instantiate summary store/job service and add IPC handlers.
- Modify `src/preload/preload.cts`
  - Add safe renderer API methods for context pressure and summary operations.
- Modify `src/shared/agentdockTypes.ts`
  - Add summary/pressure request and result types.
- Modify `src/shared/preloadTypes.ts`
  - Add API contract and whitelist entries.
- Modify `src/renderer/App.tsx`
  - Add pressure warning/actions near the existing history limit bar.
- Modify `src/renderer/styles.css`
  - Add compact pressure/action styling.
- Modify tests:
  - `tests/app/contextBudgetEstimator.test.ts`
  - `tests/app/sessionSummaryStore.test.ts`
  - `tests/app/summaryJobService.test.ts`
  - existing `tests/app/sessionService.test.ts`
  - existing `tests/app/preloadTypes.test.ts`
  - existing `tests/app/App.test.tsx`
  - existing `tests/app/metadataStores.test.ts` only if workspace context tests need summary support there

## Task 1: Context Pressure Estimator

**Files:**
- Create: `src/main/contextBudgetEstimator.ts`
- Test: `tests/app/contextBudgetEstimator.test.ts`

- [ ] **Step 1: Write failing estimator tests**

Add tests that assert:

```ts
import { describe, expect, it } from 'vitest';
import { estimateContextPressure } from '../../src/main/contextBudgetEstimator';

describe('estimateContextPressure', () => {
  it('returns low pressure for small local context', () => {
    expect(estimateContextPressure({
      historyBufferBytes: 20_000,
      transcriptBytes: 30_000,
      sharedContextBytes: 10_000,
      recentOutputBytesPerMinute: 1_000,
      historyLimitReached: false,
    })).toMatchObject({ level: 'low', score: 1 });
  });

  it('returns medium and high pressure from normalized local size signals', () => {
    expect(estimateContextPressure({
      historyBufferBytes: 2_750_000,
      transcriptBytes: 500_000,
      sharedContextBytes: 120_000,
      recentOutputBytesPerMinute: 5_000,
      historyLimitReached: false,
    }).level).toBe('medium');

    expect(estimateContextPressure({
      historyBufferBytes: 4_500_000,
      transcriptBytes: 2_000_000,
      sharedContextBytes: 800_000,
      recentOutputBytesPerMinute: 50_000,
      historyLimitReached: false,
    }).level).toBe('high');
  });

  it('returns full pressure when history limit is reached', () => {
    expect(estimateContextPressure({
      historyBufferBytes: 100,
      transcriptBytes: 100,
      sharedContextBytes: 100,
      recentOutputBytesPerMinute: 0,
      historyLimitReached: true,
    })).toMatchObject({ level: 'full', score: 100 });
  });
});
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/app/contextBudgetEstimator.test.ts`

Expected: FAIL because `contextBudgetEstimator` does not exist.

- [ ] **Step 3: Implement estimator**

Create:

```ts
export type ContextPressureLevel = 'low' | 'medium' | 'high' | 'full';

export type ContextPressureInput = {
  historyBufferBytes: number;
  transcriptBytes: number;
  sharedContextBytes: number;
  recentOutputBytesPerMinute: number;
  historyLimitReached: boolean;
};

export type ContextPressure = {
  level: ContextPressureLevel;
  score: number;
};

const HISTORY_LIMIT_BYTES = 5_000_000;
const TRANSCRIPT_WARNING_BYTES = 2_500_000;
const SHARED_CONTEXT_WARNING_BYTES = 1_000_000;
const OUTPUT_RATE_WARNING_BYTES_PER_MINUTE = 60_000;

function normalizedScore(value: number, limit: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.min(100, Math.ceil((value / limit) * 100));
}

function pressureLevel(score: number): ContextPressureLevel {
  if (score >= 100) return 'full';
  if (score >= 80) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}

export function estimateContextPressure(input: ContextPressureInput): ContextPressure {
  if (input.historyLimitReached) {
    return { level: 'full', score: 100 };
  }

  const score = Math.max(
    normalizedScore(input.historyBufferBytes, HISTORY_LIMIT_BYTES),
    normalizedScore(input.transcriptBytes, TRANSCRIPT_WARNING_BYTES),
    normalizedScore(input.sharedContextBytes, SHARED_CONTEXT_WARNING_BYTES),
    normalizedScore(input.recentOutputBytesPerMinute, OUTPUT_RATE_WARNING_BYTES_PER_MINUTE),
  );

  return { level: pressureLevel(score), score };
}
```

- [ ] **Step 4: Run GREEN**

Run: `npx vitest run tests/app/contextBudgetEstimator.test.ts`

Expected: PASS.

## Task 2: Summary Store, Redaction, And Validation

**Files:**
- Create: `src/main/sessionSummaryStore.ts`
- Test: `tests/app/sessionSummaryStore.test.ts`

- [ ] **Step 1: Write failing summary store tests**

Add tests that assert:

```ts
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createSessionSummaryStore,
  redactSummarySecrets,
  validateSummaryMarkdown,
} from '../../src/main/sessionSummaryStore';

const validSummary = [
  '# AgentDock Session Summary',
  '',
  '## Current Goal',
  'Ship context summary.',
  '',
  '## Decisions',
  '- Keep manual first.',
  '',
  '## Files And Areas Touched',
  '- src/main/sessionService.ts',
  '',
  '## Commands And Verification',
  '- npm run typecheck',
  '',
  '## Problems And Risks',
  '- Verify real CLI.',
  '',
  '## Next Steps',
  '- Continue implementation.',
  '',
  '## Source',
  'Transcript: .agentdock/context/sessions/session-1.md',
  '',
].join('\n');

describe('sessionSummaryStore', () => {
  it('redacts API keys and env assignments before summary input is sent', () => {
    expect(redactSummarySecrets('OPENAI_API_KEY=[TEST_REDACTED_KEY] token [TEST_REDACTED_TOKEN]'))
      .toBe('OPENAI_API_KEY=[REDACTED] token [REDACTED]');
  });

  it('validates required summary markdown headings', () => {
    expect(validateSummaryMarkdown(validSummary)).toEqual({ ok: true });
    expect(validateSummaryMarkdown('# AgentDock Session Summary\n\n## Current Goal\n')).toEqual({
      ok: false,
      reason: '摘要缺少必要标题: Decisions',
    });
  });

  it('writes summary and handoff files under workspace context paths', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'agentdock-summary-'));
    const store = createSessionSummaryStore();

    const result = await store.writeSummary({
      workspacePath,
      sessionId: 'session-1',
      summaryMarkdown: validSummary,
      handoffMarkdown: validSummary,
    });

    expect(result.summaryFile).toBe(path.join(workspacePath, '.agentdock/context/summaries/session-1.md'));
    expect(result.handoffFile).toBe(path.join(workspacePath, '.agentdock/context/handoffs/session-1.md'));
    await expect(readFile(result.summaryFile, 'utf-8')).resolves.toContain('## Current Goal');
  });
});
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/app/sessionSummaryStore.test.ts`

Expected: FAIL because `sessionSummaryStore` does not exist.

- [ ] **Step 3: Implement summary store**

Implement exported functions and `createSessionSummaryStore()` with:

- `redactSummarySecrets(value: string): string`
- `validateSummaryMarkdown(value: string, maxBytes = 80_000): { ok: true } | { ok: false; reason: string }`
- `writeSummary({ workspacePath, sessionId, summaryMarkdown, handoffMarkdown })`
- `readLatestSummary({ workspacePath, sessionId })`
- safe session file names using `/[^A-Za-z0-9._-]/g`

- [ ] **Step 4: Run GREEN**

Run: `npx vitest run tests/app/sessionSummaryStore.test.ts`

Expected: PASS.

## Task 3: Summary Job Service

**Files:**
- Create: `src/main/summaryJobService.ts`
- Test: `tests/app/summaryJobService.test.ts`

- [ ] **Step 1: Write failing summary job tests**

Add tests that use a fake runner and fake transcript reader. Required behaviors:

- Summary input is redacted.
- Valid runner output writes summary/handoff files.
- Invalid runner output fails without writing.
- `continueAfterSummary: true` launches continuation only after summary success.

Use this public shape:

```ts
const service = createSummaryJobService({
  summaryStore,
  runSummary: async (input) => validSummaryMarkdown,
  launchContinuation: async () => continuationSession,
  readTranscript: async () => 'OPENAI_API_KEY=[TEST_REDACTED_KEY]\nimportant output',
  clock: { now: () => new Date('2026-07-06T00:00:00.000Z') },
});
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/app/summaryJobService.test.ts`

Expected: FAIL because `summaryJobService` does not exist.

- [ ] **Step 3: Implement job service**

Implement:

- `SummaryRunnerInput` with session metadata, previous summary, redacted transcript tail.
- `SummaryRunner` as injectable async function.
- `createSummaryJobService(options)`
- `summarizeSession(request)` returning `{ status: 'success', summaryFile, handoffFile, handoffPrompt, continuationSession? }` or throwing sanitized errors.

Default runner throws `总结器尚不可用，请稍后配置真实 CLI runner`. Tests use fake runner. Provider-specific real CLI runners are outside Phase 1 and must not be partially enabled.

- [ ] **Step 4: Run GREEN**

Run: `npx vitest run tests/app/summaryJobService.test.ts`

Expected: PASS.

## Task 4: Main Service And IPC Contracts

**Files:**
- Modify: `src/shared/agentdockTypes.ts`
- Modify: `src/shared/preloadTypes.ts`
- Modify: `src/preload/preload.cts`
- Modify: `src/main/sessionService.ts`
- Modify: `src/main/main.ts`
- Tests: `tests/app/sessionService.test.ts`, `tests/app/preloadTypes.test.ts`

- [ ] **Step 1: Write failing IPC/type tests**

Add shared types for:

- `SessionContextPressureRequest`
- `SessionContextPressureResult`
- `SessionSummaryRequest`
- `SessionSummaryResult`

Update tests to expect `getSessionContextPressure` and `summarizeSession` in `AGENT_DOCK_API_METHODS`, and preload to expose them.

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/app/preloadTypes.test.ts tests/app/sessionService.test.ts`

Expected: FAIL because methods are missing.

- [ ] **Step 3: Implement contracts and service methods**

Add:

- `SessionService.getContextPressure(request)`
- `SessionService.summarizeSession(request)`

For pressure, use in-memory terminal buffer length and `session.historyLimitReached`. Phase 1 sets transcript and shared-context byte inputs to zero inside `SessionService`; `workspaceContextStore` summary preference remains responsible for keeping shared context short.

For summary, delegate to `summaryJobService`. `continueAfterSummary` launches a new session with the same profile/workspace/command through existing launch path.

Add IPC handlers:

- `sessions:contextPressure`
- `sessions:summarize`

Preload methods:

- `getSessionContextPressure`
- `summarizeSession`

- [ ] **Step 4: Run GREEN**

Run: `npx vitest run tests/app/preloadTypes.test.ts tests/app/sessionService.test.ts`

Expected: PASS.

## Task 5: Workspace Shared Context Prefers Summaries

**Files:**
- Modify: `src/main/workspaceContextStore.ts`
- Test: `tests/app/sessionServiceTerminal.test.ts`

- [ ] **Step 1: Write failing shared-context test**

Test that when `.agentdock/context/summaries/session-1.md` exists, rebuilt `shared-context.md` contains a `## Session Summaries` section and does not include a huge transcript tail for that session.

- [ ] **Step 2: Run RED**

Run the focused workspace context test.

Expected: FAIL because summaries are ignored.

- [ ] **Step 3: Implement summary preference**

In `sharedContextMarkdown`, read per-session summary files from `.agentdock/context/summaries/<session-id>.md`. Render summaries first. For sessions with summaries, render only a small recent output tail or skip transcript tail for that session.

- [ ] **Step 4: Run GREEN**

Run the focused workspace context test.

Expected: PASS.

## Task 6: Renderer Actions

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`
- Test: `tests/app/App.test.tsx`

- [ ] **Step 1: Write failing renderer tests**

Add tests:

- High pressure session shows `上下文压力高` and `总结当前会话`.
- Clicking `总结当前会话` calls `api.summarizeSession({ sessionId, continueAfterSummary: false })` and shows `摘要已生成`.
- Clicking `总结并续开` calls summary with `continueAfterSummary: true` and activates returned continuation session.
- Summary failure shows safe error text.

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/app/App.test.tsx`

Expected: FAIL because UI and API calls are missing.

- [ ] **Step 3: Implement renderer UI**

Add a compact `SessionContextBar` near `SessionHistoryLimitBar`. Fetch pressure for the active session when active session changes and after session changed events. Show warning only for `high` or `full`.

Actions:

- `总结当前会话`
- `总结并续开`
- `复制续接提示` if a handoff prompt exists

- [ ] **Step 4: Run GREEN**

Run: `npx vitest run tests/app/App.test.tsx`

Expected: PASS.

## Task 7: Full Verification

**Files:**
- No new production files unless fixing verification failures.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npx vitest run \
  tests/app/contextBudgetEstimator.test.ts \
  tests/app/sessionSummaryStore.test.ts \
  tests/app/summaryJobService.test.ts \
  tests/app/sessionService.test.ts \
  tests/app/sessionServiceTerminal.test.ts \
  tests/app/preloadTypes.test.ts \
  tests/app/App.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run required project checks**

Run:

```bash
npm run workflow:doctor
npm run typecheck
npm run build
```

Expected: PASS. `npm run build` may keep the existing Vite chunk-size warning.

- [ ] **Step 3: Record verification**

Create `.agent-workflow/verification/2026-07-06-context-budget-auto-summary.md` with commands, outputs, and any skipped real CLI items.

Real CLI summary execution remains unavailable in Phase 1: the default runner fails visibly and tests verify fake runner behavior. The verification record must state that real Claude/Codex one-shot summary smoke is not enabled in this phase.
