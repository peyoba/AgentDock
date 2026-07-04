# AgentDock Batch B Workspace Shared Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save AgentDock terminal session context into the selected workspace so Claude CLI, Codex CLI, zsh, and future agent CLIs running in that workspace can inspect the same local context files.

**Architecture:** Keep context capture in Electron main because main already owns PTY output, session metadata, and workspace paths. Store shared files under `<workspace>/.agentdock/context/`, inject non-secret context file paths into every PTY environment, and expose a small renderer viewer/open-folder action through preload IPC.

**Tech Stack:** Electron + React + TypeScript + Vite + xterm.js + node-pty + Vitest + npm + filesystem-backed Markdown/JSON files.

---

## Current Prerequisite

Before starting Batch B implementation, finish or commit the current Claude lite settings isolation change if it is still present in `git status`:

```text
src/main/sessionService.ts
tests/app/sessionService.test.ts
.agent-workflow/state.md
```

Reason: Batch B will also modify `src/main/sessionService.ts` and `.agent-workflow/state.md`. Starting Batch B before that change is committed increases merge/conflict risk.

## Product Scope

Included:

- Save per-session terminal transcript output into the selected workspace.
- Maintain a workspace-level `shared-context.md` file containing a session index and recent output excerpts.
- Inject these non-secret env vars into every launched PTY:
  - `AGENTDOCK_CONTEXT_DIR`
  - `AGENTDOCK_SHARED_CONTEXT_FILE`
  - `AGENTDOCK_SESSION_TRANSCRIPT_FILE`
- Exclude workspace context files from Git by adding `.agentdock/` to `.git/info/exclude` when the workspace is a Git repo.
- Add a small current-session UI action to view shared context and open the context folder.
- Add tests proving API keys, tokens, and full env objects are not written to context files or returned through renderer IPC.

Not included:

- Automatic LLM summarization.
- Cross-device or cloud sync.
- Request logs, cost tracking, or API gateway behavior.
- Editing user project `AGENTS.md`, `CLAUDE.md`, global Claude settings, or global Codex config.

## Data Layout

For a workspace at `/Users/example/project`, AgentDock writes:

```text
/Users/example/project/.agentdock/context/
├── shared-context.md
├── index.json
└── sessions/
    └── session-1.md
```

`index.json` must store only non-secret metadata:

```json
{
  "version": 1,
  "workspaceId": "workspace-a",
  "workspaceName": "AgentDock",
  "updatedAt": "2026-07-04T00:00:00.000Z",
  "sessions": [
    {
      "sessionId": "session-1",
      "title": "Claude A · AgentDock",
      "profileId": "profile-a",
      "workspaceId": "workspace-a",
      "command": "claude --dangerously-skip-permissions",
      "startedAt": "2026-07-04T00:00:00.000Z",
      "transcriptFile": ".agentdock/context/sessions/session-1.md"
    }
  ]
}
```

`shared-context.md` starts as a deterministic file:

```markdown
# AgentDock Shared Context

Workspace: AgentDock
Updated: 2026-07-04T00:00:00.000Z

## How To Use
Read this file before continuing work in AgentDock sessions for this workspace.

## Sessions
- session-1: Claude A · AgentDock (`.agentdock/context/sessions/session-1.md`)

## Recent Output

### session-1
```text
agentdock-context-smoke
```
```

## File Structure

- Create `src/main/workspaceContextStore.ts`: path resolution, `.git/info/exclude`, transcript append, shared context rebuild, safe reads.
- Modify `src/main/sessionService.ts`: create context files on launch, inject context env vars, append PTY output.
- Modify `src/main/main.ts`: create one `workspaceContextStore`, pass it into per-window `SessionService`, add context IPC handlers.
- Modify `src/shared/agentdockTypes.ts`: add `WorkspaceContextReadRequest`, `WorkspaceContextReadResult`, and `WorkspaceContextOpenRequest`.
- Modify `src/shared/preloadTypes.ts`: add `readWorkspaceContext` and `openWorkspaceContextFolder` to API contract and whitelist.
- Modify `src/preload/preload.cts`: expose context APIs.
- Modify `src/renderer/components/SessionDetailsDrawer.tsx`: add shared context actions and preview.
- Modify `src/renderer/App.tsx`: pass context handlers into the drawer.
- Modify `src/renderer/styles.css`: style the shared context block.
- Create `tests/app/workspaceContextStore.test.ts`: filesystem store tests with temp directories.
- Modify `tests/app/sessionServiceTerminal.test.ts`: env injection and PTY output recording tests.
- Modify `tests/app/preloadTypes.test.ts`: preload whitelist coverage.
- Modify `tests/app/App.test.tsx`: renderer context UI test.
- Update `.agent-workflow/state.md`: record Batch B progress and verification.
- Create verification/delivery reports during final task.

## Task 1: Workspace Context Store

**Files:**
- Create: `src/main/workspaceContextStore.ts`
- Create: `tests/app/workspaceContextStore.test.ts`

- [ ] **Step 1: Write failing store tests**

Create `tests/app/workspaceContextStore.test.ts` with tests for:

- `startSession()` creates `.agentdock/context/shared-context.md`, `index.json`, and `sessions/<sessionId>.md`.
- `appendOutput()` writes redacted PTY output into transcript and shared context.
- `ensureGitExcluded()` appends `.agentdock/` to `.git/info/exclude` exactly once.
- Secret-like strings such as `local-development-secret`, `sk-test-secret-value-that-is-long`, `sk-ant-test-secret-value-that-is-long`, and `ANTHROPIC_AUTH_TOKEN=` are redacted.

Use temp directories through `fs.mkdtempSync(path.join(os.tmpdir(), 'agentdock-context-'))` and remove them in `afterEach`.

- [ ] **Step 2: Run RED**

```bash
npm run test -- tests/app/workspaceContextStore.test.ts
```

Expected: FAIL because `src/main/workspaceContextStore.ts` does not exist yet.

- [ ] **Step 3: Implement store**

Create `src/main/workspaceContextStore.ts` exporting:

```ts
export type WorkspaceContextFiles = {
  contextDir: string;
  sharedContextFile: string;
  sessionTranscriptFile: string;
};

export type WorkspaceContextStore = {
  startSession(input: { workspace: Workspace; session: AgentSession }): Promise<WorkspaceContextFiles>;
  appendOutput(input: { workspace: Workspace; sessionId: string; data: string }): Promise<void>;
  readSharedContext(workspace: Workspace): Promise<{ filePath: string; content: string }>;
  ensureGitExcluded(workspace: Workspace): Promise<void>;
};
```

Implementation rules:

- Use `fs/promises`.
- Use `<workspace.path>/.agentdock/context`.
- Use `.agentdock/context/sessions/<sessionId>.md` as relative transcript path in `index.json`.
- Redact known key-like patterns and `local-development-secret`.
- Limit `Recent Output` in `shared-context.md` to the last `40_000` characters per transcript.
- Do not throw if `.git/info/exclude` is absent; only update it when present.

- [ ] **Step 4: Run GREEN**

```bash
npm run test -- tests/app/workspaceContextStore.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/main/workspaceContextStore.ts tests/app/workspaceContextStore.test.ts
git commit -m "feat: add workspace context store"
```

## Task 2: SessionService Context Recording

**Files:**
- Modify: `src/main/sessionService.ts`
- Modify: `tests/app/sessionServiceTerminal.test.ts`
- Modify: `tests/app/sessionService.test.ts`

- [ ] **Step 1: Write failing SessionService tests**

Add a test proving local shell launches get context env vars:

```ts
expect(runtime.spawnRequests[0].env).toMatchObject({
  AGENTDOCK_CONTEXT_DIR: '/tmp/workspace/.agentdock/context',
  AGENTDOCK_SHARED_CONTEXT_FILE: '/tmp/workspace/.agentdock/context/shared-context.md',
  AGENTDOCK_SESSION_TRANSCRIPT_FILE: '/tmp/workspace/.agentdock/context/sessions/session-1.md',
});
```

Add a test proving PTY output is forwarded to `workspaceContext.appendOutput({ workspace, sessionId, data })`.

Add a test proving env JSON does not contain `local-development-secret`.

- [ ] **Step 2: Run RED**

```bash
npm run test -- tests/app/sessionServiceTerminal.test.ts tests/app/sessionService.test.ts
```

Expected: FAIL because `workspaceContext` option and env injection do not exist.

- [ ] **Step 3: Add `workspaceContext` option**

Extend `CreateSessionServiceOptions` in `src/main/sessionService.ts`:

```ts
workspaceContext?: WorkspaceContextStore;
```

Create helper:

```ts
function contextEnvironment(files: WorkspaceContextFiles | undefined): Record<string, string> {
  if (!files) {
    return {};
  }
  return {
    AGENTDOCK_CONTEXT_DIR: files.contextDir,
    AGENTDOCK_SHARED_CONTEXT_FILE: files.sharedContextFile,
    AGENTDOCK_SESSION_TRANSCRIPT_FILE: files.sessionTranscriptFile,
  };
}
```

During `launch`, call `workspaceContext.startSession({ workspace, session })` after `session` is created and before spawning PTY.

Merge context env vars into both local shell and agent CLI env:

```ts
const env = {
  ...baseEnv,
  ...contextEnvironment(contextFiles),
};
```

Inside `ptySession.onData`, after `publishTerminalOutput`, call:

```ts
void workspaceContext?.appendOutput({ workspace, sessionId: session.id, data }).catch(() => undefined);
```

- [ ] **Step 4: Run GREEN**

```bash
npm run test -- tests/app/sessionServiceTerminal.test.ts tests/app/sessionService.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/main/sessionService.ts tests/app/sessionServiceTerminal.test.ts tests/app/sessionService.test.ts
git commit -m "feat: record session context by workspace"
```

## Task 3: Main IPC and Preload API

**Files:**
- Modify: `src/shared/agentdockTypes.ts`
- Modify: `src/shared/preloadTypes.ts`
- Modify: `src/preload/preload.cts`
- Modify: `src/main/main.ts`
- Modify: `tests/app/preloadTypes.test.ts`

- [ ] **Step 1: Write failing preload test**

Add these method names to the expected preload whitelist in `tests/app/preloadTypes.test.ts`:

```ts
'readWorkspaceContext',
'openWorkspaceContextFolder',
```

- [ ] **Step 2: Run RED**

```bash
npm run test -- tests/app/preloadTypes.test.ts
```

Expected: FAIL because the methods are missing.

- [ ] **Step 3: Add shared types**

Add to `src/shared/agentdockTypes.ts`:

```ts
export type WorkspaceContextReadRequest = {
  workspaceId: string;
};

export type WorkspaceContextReadResult = {
  filePath: string;
  content: string;
};

export type WorkspaceContextOpenRequest = {
  workspaceId: string;
};
```

- [ ] **Step 4: Add preload contract**

Add to `AgentDockApi` in `src/shared/preloadTypes.ts`:

```ts
readWorkspaceContext(request: WorkspaceContextReadRequest): Promise<WorkspaceContextReadResult>;
openWorkspaceContextFolder(request: WorkspaceContextOpenRequest): Promise<void>;
```

Add both names to `AGENT_DOCK_API_METHODS`.

Add to `src/preload/preload.cts`:

```ts
readWorkspaceContext: (request) => ipcRenderer.invoke('workspaceContext:read', request),
openWorkspaceContextFolder: (request) => ipcRenderer.invoke('workspaceContext:openFolder', request),
```

- [ ] **Step 5: Add main handlers**

In `src/main/main.ts`:

- Import `createWorkspaceContextStore`.
- Create `const workspaceContextStore = createWorkspaceContextStore();`.
- Pass `workspaceContext: workspaceContextStore` to every `createSessionService`.
- Add `workspaceContext:read` handler that finds the workspace and returns `workspaceContextStore.readSharedContext(workspace)`.
- Add `workspaceContext:openFolder` handler that finds the workspace and calls `shell.openPath(path.join(workspace.path, '.agentdock/context'))`.

Error messages must not include env or secrets:

```ts
throw new Error('所选工作区不存在，无法读取共享上下文');
throw new Error('所选工作区不存在，无法打开共享上下文目录');
```

- [ ] **Step 6: Run GREEN**

```bash
npm run test -- tests/app/preloadTypes.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add src/shared/agentdockTypes.ts src/shared/preloadTypes.ts src/preload/preload.cts src/main/main.ts tests/app/preloadTypes.test.ts
git commit -m "feat: expose workspace context IPC"
```

## Task 4: Renderer Shared Context Viewer

**Files:**
- Modify: `src/renderer/components/SessionDetailsDrawer.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`
- Modify: `tests/app/App.test.tsx`

- [ ] **Step 1: Write failing renderer test**

Add a test to `tests/app/App.test.tsx`:

- Mock one running session.
- Mock `readWorkspaceContext()` returning `# AgentDock Shared Context`.
- Open session details.
- Click `查看共享上下文`.
- Assert the context file path and content render.
- Click `打开上下文文件夹`.
- Assert `openWorkspaceContextFolder({ workspaceId: 'workspace-a' })` was called.

- [ ] **Step 2: Run RED**

```bash
npm run test -- tests/app/App.test.tsx
```

Expected: FAIL because UI actions do not exist.

- [ ] **Step 3: Add drawer state and controls**

Extend `SessionDetailsDrawer` props:

```ts
onReadWorkspaceContext?(workspaceId: string): Promise<{ filePath: string; content: string }>;
onOpenWorkspaceContextFolder?(workspaceId: string): Promise<void>;
```

Add local state:

```ts
const [contextFilePath, setContextFilePath] = React.useState('');
const [contextContent, setContextContent] = React.useState('');
```

Add controls with exact labels:

```text
查看共享上下文
打开上下文文件夹
```

- [ ] **Step 4: Wire App handlers**

In `src/renderer/App.tsx`, add:

```ts
const readWorkspaceContext = async (workspaceId: string) =>
  api?.readWorkspaceContext({ workspaceId }) ?? { filePath: '', content: '' };

const openWorkspaceContextFolder = async (workspaceId: string): Promise<void> => {
  await api?.openWorkspaceContextFolder({ workspaceId });
};
```

Pass them into `SessionDetailsDrawer`.

- [ ] **Step 5: Style context block**

In `src/renderer/styles.css`, add `.workspace-context-panel` styles:

- grid layout with `gap: 8px`
- `pre` max height 180px
- 8px border radius
- `white-space: pre-wrap`
- `overflow-wrap: anywhere` for file paths

- [ ] **Step 6: Run GREEN**

```bash
npm run test -- tests/app/App.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/renderer/components/SessionDetailsDrawer.tsx src/renderer/App.tsx src/renderer/styles.css tests/app/App.test.tsx
git commit -m "feat: show workspace shared context"
```

## Task 5: Verification, Packaging, and Delivery

**Files:**
- Create: `.agent-workflow/verification/2026-07-04-agentdock-batch-b-workspace-shared-context.md`
- Create: `.agent-workflow/delivery/2026-07-04-agentdock-batch-b-workspace-shared-context-delivery-report.md`
- Modify: `.agent-workflow/state.md`

- [ ] **Step 1: Run full automated verification**

```bash
npm run test
npm run workflow:doctor
npm run test:workflow
npm run typecheck
npm run build
git diff --check
```

Expected:

- App tests pass.
- Workflow doctor passes.
- Workflow tests pass.
- Typecheck passes.
- Build passes with only the existing Vite chunk size warning.
- `git diff --check` prints no output.

- [ ] **Step 2: Run real PTY context smoke**

Create or run a one-off local smoke that:

1. Creates a temp workspace.
2. Launches local `zsh` through real `SessionService` + real `node-pty`.
3. Writes `echo agentdock-context-smoke`.
4. Reads `<temp>/.agentdock/context/shared-context.md`.
5. Confirms it contains `agentdock-context-smoke`.
6. Confirms it does not contain API key patterns or `ANTHROPIC_AUTH_TOKEN`.

Do not make real Claude/Codex API calls.

- [ ] **Step 3: Package and codesign**

```bash
npm run package:mac
codesign --verify --deep --strict --verbose=2 release/packages/<latest>/AgentDock-darwin-arm64/AgentDock.app
```

Expected: package outputs a new timestamped App and codesign reports `valid on disk` and `satisfies its Designated Requirement`.

- [ ] **Step 4: Run key/token scan**

```bash
{ git diff --name-only -z; git ls-files --others --exclude-standard -z; } | xargs -0 rg -n --pcre2 "(sk-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{20,}|AKIA[0-9A-Z]{16})"
```

Expected: exit code 1 with no output, meaning no matches.

- [ ] **Step 5: Write verification report**

Create `.agent-workflow/verification/2026-07-04-agentdock-batch-b-workspace-shared-context.md` with:

- verification object
- environment
- real dependencies
- command evidence table
- package path
- real PTY context smoke result
- unverified item: no real Claude/Codex API request
- conclusion

- [ ] **Step 6: Write delivery report and update state**

Create `.agent-workflow/delivery/2026-07-04-agentdock-batch-b-workspace-shared-context-delivery-report.md`.

Update `.agent-workflow/state.md`:

- 当前任务：`Batch B Workspace Shared Context 交付验证。`
- 当前 Hook：`delivery_hook`
- 当前阶段：`delivery`
- 下一步：latest package path and user smoke instructions.
- 批次进展：mark Batch B as `PASS`.

- [ ] **Step 7: Commit delivery**

```bash
git add .agent-workflow/state.md .agent-workflow/verification/2026-07-04-agentdock-batch-b-workspace-shared-context.md .agent-workflow/delivery/2026-07-04-agentdock-batch-b-workspace-shared-context-delivery-report.md
git commit -m "docs: record workspace shared context verification"
```

## Required Final Verification Before Reporting Complete

After all tasks and commits:

```bash
npm run test
npm run workflow:doctor
npm run test:workflow
npm run typecheck
npm run build
npm run package:mac
git diff --check
```

Then run:

```bash
{ git diff --name-only -z; git ls-files --others --exclude-standard -z; } | xargs -0 rg -n --pcre2 "(sk-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{20,}|AKIA[0-9A-Z]{16})"
```

Expected final state:

- Tests and workflow checks pass.
- Build passes with only the existing Vite chunk size warning.
- Package outputs a new timestamped App under `release/packages/<timestamp>/AgentDock-darwin-arm64/AgentDock.app`.
- Key/token scan has no output.
- No real Claude/Codex API requests are made.
- Git worktree is clean after commits, unless user explicitly asks to keep verification artifacts uncommitted.

## Resume Instructions For A New Agent

If this window is closed, the next agent should:

1. Read `AGENTS.md`, `PROJECT_PROFILE.md`, `DECISIONS.md`, `.agent-workflow/state.md`, and this plan file.
2. Run `git status --short --branch`.
3. If the current Claude lite settings isolation diff is still present, finish/commit that task before starting Batch B.
4. Start Batch B at Task 1 using TDD.
5. Do not add automatic LLM summarization or external API calls in Batch B.
6. Preserve the security boundary: no API key, token, or full env object in context files, renderer IPC payloads, tests, logs, or docs.

## Self-Review

- Spec coverage: covers workspace-local storage, transcripts, shared context file visibility, PTY env injection, renderer visibility, Git exclusion, verification, and delivery.
- Placeholder scan: no intentional placeholder markers are left in this plan.
- Type consistency: API names are `readWorkspaceContext` and `openWorkspaceContextFolder`; IPC channels are `workspaceContext:read` and `workspaceContext:openFolder`; store type is `WorkspaceContextStore`.
