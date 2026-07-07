# AgentDock 长期会话库与终端优先布局 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 AgentDock 从“标签即会话”改为长期 Session Record 会话库，并落地终端优先三栏布局、只读项目文件树和可验证的恢复语义。

**Architecture:** 继续使用现有 Electron main / preload / React renderer 边界。Main process 演进 `sessionHistoryStore`、`sessionTranscriptStore`、`restoreContextStore` 和 `SessionService`；Renderer 拆出左侧会话库、终端工作区和右侧项目面板；恢复路径先做 CLI native resume 探针，verified 后才启用原生恢复，否则使用 AgentDock restore context fallback。

**Tech Stack:** Electron + React + TypeScript + xterm.js + node-pty + npm。不得引入新依赖、UI 组件库、状态管理库或 SQLite。

---

## 前置约束

- 本计划基于 [长期会话库与终端优先布局设计](../specs/2026-07-07-agentdock-session-library-terminal-first-ui-design.zh-CN.md)。
- 当前工作区已有大量恢复相关未提交改动。执行本计划前必须先完成 Batch 0，形成清晰基线。
- 所有新文档、任务卡、验证记录和交付报告使用中文。
- 每个实现批次按 TDD 执行：先写失败测试，确认失败，再写最小实现。
- 不删除 workspace 项目文件。删除 Session Record 只删除 AgentDock 管理的 metadata、transcript、restore context 和 file index。

## 文件结构总览

### 现有文件会被演进

- `src/shared/agentdockTypes.ts`：扩展 Session Record、Open View、native resume、file tree、file index 类型。
- `src/shared/preloadTypes.ts`：增加会话库、视图、删除/归档、文件树 IPC 类型。
- `src/preload/preload.cts`：暴露新增 IPC 白名单，保持 payload 校验。
- `src/main/sessionService.ts`：拆分关闭视图、停止 PTY、删除记录、继续会话和 native resume/fallback 恢复。
- `src/main/stores/sessionHistoryStore.ts`：演进为 Session Record metadata 权威存储。
- `src/main/stores/sessionTranscriptStore.ts`：继续作为 transcript 存储，不新建第二套 transcript。
- `src/main/restoreContextStore.ts`：继续负责 fallback restore context。
- `src/main/windowSessionRegistry.ts`：增加 running owner window 查询或跨窗口占用判定。
- `src/main/main.ts`：新增 IPC handler，接入文件树、file index、会话 view 操作。
- `src/renderer/App.tsx`：从单区标签布局改为左侧会话库 + 中间终端 + 右侧项目面板。
- `src/renderer/styles.css`：实现终端优先三栏布局、右 rail、可拖动信息区。
- `src/renderer/components/TerminalPane.tsx`：支持只读观察态和终端尺寸约束验证。

### 新增文件

- `src/main/nativeResumeProbe.ts`：CLI capability 探针和 resume 策略判断。
- `src/main/stores/sessionFileIndexStore.ts`：保存 git baseline 和本会话期间变化文件索引。
- `src/main/workspaceFileTreeService.ts`：只读文件树读取、workspace 边界校验、git status 读取。
- `src/renderer/components/SessionLibrary.tsx`：左侧会话库。
- `src/renderer/components/ProjectPanel.tsx`：右侧项目面板容器。
- `src/renderer/components/WorkspaceFileTree.tsx`：只读文件树。
- `src/renderer/components/ProjectPanelInfoSections.tsx`：选中文件、当前会话、恢复摘要折叠段。
- `tests/app/nativeResumeProbe.test.ts`：native resume capability 单元测试。
- `tests/app/sessionRecordStore.test.ts`：长期记录、归档、删除、迁移测试。
- `tests/app/workspaceFileTreeService.test.ts`：文件树安全和状态测试。
- `tests/app/sessionFileIndexStore.test.ts`：文件变化索引测试。

---

## Batch 0: 基线整理

**目标:** 在任何 UI/session 重构前处理当前 dirty worktree，避免把恢复修复和 UI 重构混在一个 diff 里。

**Files:**
- Inspect: `git status --short`
- Inspect: `.agent-workflow/state.md`
- Inspect: existing modified files listed by `git status`

- [ ] **Step 1: 查看当前工作区**

Run:

```bash
git status --short
```

Expected: 列出当前恢复相关 modified/untracked 文件。

- [ ] **Step 2: 跑当前基线验证**

Run:

```bash
npm run workflow:doctor
npm run test:workflow
npm run typecheck
npm run build
```

Expected: 全部 PASS；`build` 允许已有 Vite chunk size warning。

- [ ] **Step 3: 决定基线处理方式**

提交前必须先审阅当前 diff：

```bash
git diff -- .agent-workflow README.md docs src tests
```

Expected: diff 中没有调试代码、临时日志、真实 secret 或不希望进入主线的实验改动。

如果用户允许提交，使用语义化提交保存当前恢复相关改动。不要用宽泛 `git add docs` 直接提交；必须选择性 stage，明确排除临时副本目录和根目录构建产物：

```bash
git add .agent-workflow README.md CLAUDE.md \
  docs/requirements \
  docs/superpowers/specs/2026-07-07-agentdock-session-library-terminal-first-ui-design.zh-CN.md \
  docs/superpowers/plans/2026-07-07-agentdock-session-library-terminal-first-ui.md \
  docs/assets/ui-references/agentdock-session-library-file-tree-mockup.html \
  docs/assets/ui-references/agentdock-session-library-file-tree-mockup.png \
  docs/assets/ui-references/agentdock-terminal-first-alt-mockup.html \
  docs/assets/ui-references/agentdock-terminal-first-alt-mockup.png \
  docs/assets/ui-references/agentdock-terminal-first-expanded-mockup.png \
  docs/assets/ui-references/agentdock-terminal-first-rail-mockup.png \
  docs/assets/ui-references/agentdock-terminal-first-v2-default.html \
  docs/assets/ui-references/agentdock-terminal-first-v2-default.png \
  docs/assets/ui-references/agentdock-terminal-first-v2-expanded.html \
  docs/assets/ui-references/agentdock-terminal-first-v2-expanded.png \
  src tests
git commit -m "chore: stabilize session restore baseline"
```

Do not stage:

```text
index-D3wM5j2Q.js
docs/superpowers/specs_副本/
```

如果用户不允许提交，创建人工记录，明确哪些文件属于既有恢复改动，并在后续实现中避免回滚。

- [ ] **Step 4: 记录基线**

Create or update:

```text
.agent-workflow/verification/2026-07-07-session-library-baseline.md
```

Content must include:

```markdown
# 长期会话库改版基线验证

## 结论
PASS

## 当前基线
- 已确认当前恢复相关改动状态。
- 后续批次不得回滚用户或既有恢复改动。

## 验证命令
- npm run workflow:doctor
- npm run test:workflow
- npm run typecheck
- npm run build
```

---

## Batch 1: 原生 Resume 探针

**目标:** 在产品实现前确认 Claude/Codex native resume 能力，避免把不稳定路径写成默认承诺。

**Files:**
- Create: `src/main/nativeResumeProbe.ts`
- Test: `tests/app/nativeResumeProbe.test.ts`
- Modify: `src/shared/agentdockTypes.ts`
- Documentation: `.agent-workflow/verification/2026-07-07-native-resume-probe.md`

- [ ] **Step 1: 写 RED 测试，覆盖 Claude capability**

Create `tests/app/nativeResumeProbe.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import {
  detectClaudeResumeCapabilityFromHelp,
  detectCodexResumeCapabilityFromHelp,
  buildClaudeNativeSessionCommand,
} from '../../src/main/nativeResumeProbe';

describe('nativeResumeProbe', () => {
  it('detects Claude session-id and resume support from help output', () => {
    const result = detectClaudeResumeCapabilityFromHelp(`
      --session-id <uuid> Use a specific session ID
      -r, --resume [value] Resume a conversation by session ID
    `);

    expect(result).toEqual({
      tool: 'claude',
      status: 'verified-capability',
      supportsProvidedSessionId: true,
      supportsResumeById: true,
    });
  });

  it('appends a generated Claude session id without changing the base command', () => {
    expect(buildClaudeNativeSessionCommand('claude --dangerously-skip-permissions', '123e4567-e89b-12d3-a456-426614174000'))
      .toBe('claude --dangerously-skip-permissions --session-id 123e4567-e89b-12d3-a456-426614174000');
  });
});
```

Run:

```bash
npx vitest run tests/app/nativeResumeProbe.test.ts
```

Expected before implementation: FAIL because `src/main/nativeResumeProbe` does not exist.

- [ ] **Step 2: 实现最小 capability parser**

Create `src/main/nativeResumeProbe.ts`:

```ts
export type NativeResumeCapability =
  | {
      tool: 'claude';
      status: 'verified-capability';
      supportsProvidedSessionId: boolean;
      supportsResumeById: boolean;
    }
  | {
      tool: 'codex';
      status: 'needs-runtime-probe';
      supportsProvidedSessionId: false;
      supportsResumeById: boolean;
    };

export function detectClaudeResumeCapabilityFromHelp(help: string): NativeResumeCapability {
  return {
    tool: 'claude',
    status: 'verified-capability',
    supportsProvidedSessionId: /--session-id(?:\s+<[^>]+>)?/.test(help),
    supportsResumeById: /--resume\s+\[value\]|--resume\s+<value>/.test(help),
  };
}

export function detectCodexResumeCapabilityFromHelp(help: string): NativeResumeCapability {
  return {
    tool: 'codex',
    status: 'needs-runtime-probe',
    supportsProvidedSessionId: false,
    supportsResumeById: /\bcodex resume\b|Resume a previous interactive session|Usage:\s+codex resume/.test(help),
  };
}

export function buildClaudeNativeSessionCommand(command: string, sessionUuid: string): string {
  return `${command} --session-id ${sessionUuid}`;
}
```

Run:

```bash
npx vitest run tests/app/nativeResumeProbe.test.ts
```

Expected: PASS.

Implementation note: Step 4 must calibrate this parser against the actual `claude --help` output on the machine. Do not make native resume unavailable merely because the help argument label says `<id>` instead of `<uuid>`.

- [ ] **Step 3: 补 Codex capability 测试**

Append to `tests/app/nativeResumeProbe.test.ts`:

```ts
it('marks Codex as needing runtime probe because startup session-id is not exposed', () => {
  const result = detectCodexResumeCapabilityFromHelp(`
    Usage: codex [OPTIONS] [PROMPT]
    Commands:
      resume Resume a previous interactive session
  `);

  expect(result).toEqual({
    tool: 'codex',
    status: 'needs-runtime-probe',
    supportsProvidedSessionId: false,
    supportsResumeById: true,
  });
});
```

Run:

```bash
npx vitest run tests/app/nativeResumeProbe.test.ts
```

Expected: PASS.

- [ ] **Step 4: 做真机 CLI help 探针**

Run:

```bash
claude --version
claude --help | rg -- '--session-id|--resume'
codex --version
codex resume --help | sed -n '1,80p'
codex exec resume --help | sed -n '1,80p'
```

Expected:
- Claude 当前版本显示 `--session-id` 和 `--resume`。
- Codex 当前版本显示 resume by id，但不显示 startup `--session-id`。

- [ ] **Step 5: 做最小真机 resume smoke**

Claude smoke:

```bash
uuidgen
# 用生成的 UUID 启动最小 Claude 会话，退出后用 claude --resume <uuid> 验证可恢复。
```

Codex smoke:

```bash
# 在独立 CODEX_HOME 下启动最小 Codex 会话，退出后检查是否能稳定定位 session id。
# 验证 codex resume <id> 或 codex exec resume <id> 是否能恢复目标会话。
```

Expected:
- Claude 记录 `nativeResume=verified` 或明确失败原因。
- Codex 记录 `nativeResume=verified`、`partial` 或 `unavailable`，不得用猜测代替结论。

- [ ] **Step 6: 写验证记录**

Create `.agent-workflow/verification/2026-07-07-native-resume-probe.md`:

```markdown
# Native Resume 探针验证

## Claude
- CLI version:
- Capability:
- Smoke result:
- Decision: nativeResume=verified | nativeResume=unavailable

## Codex
- CLI version:
- Capability:
- Smoke result:
- Decision: nativeResume=verified | nativeResume=partial | nativeResume=unavailable

## 结论
- Claude:
- Codex:
```

---

## Batch 2: Session Record / Open View / PTY Process 模型

**目标:** 拆开长期记录、窗口视图和运行进程。关闭视图不删除历史；停止 PTY 不删除历史；删除记录必须显式危险操作。

**Files:**
- Modify: `src/shared/agentdockTypes.ts`
- Modify: `src/main/stores/sessionHistoryStore.ts`
- Modify: `src/main/sessionService.ts`
- Modify: `src/main/main.ts`
- Modify: `src/preload/preload.cts`
- Modify: `src/shared/preloadTypes.ts`
- Test: `tests/app/sessionRecordStore.test.ts`
- Test: `tests/app/sessionService.test.ts`
- Test: `tests/app/preloadTypes.test.ts`

- [ ] **Step 1: 写 RED 测试，关闭视图不删除历史**

Create `tests/app/sessionRecordStore.test.ts`:

```ts
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSessionHistoryStore } from '../../src/main/stores/sessionHistoryStore';

describe('session records', () => {
  it('keeps the session record when a view is closed', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-session-record-'));
    const store = createSessionHistoryStore(rootDir);

    await store.saveSession({
      id: 'session-1',
      title: 'Claude · AgentDock',
      profileId: 'claude-custom',
      workspaceId: 'agentdock',
      command: 'claude',
      status: 'exited',
      startedAt: '2026-07-07T00:00:00.000Z',
    });

    await store.closeView('session-1', 'window-1');

    const sessions = await store.listSessions();
    expect(sessions.map((session) => session.id)).toContain('session-1');
    const raw = await readFile(path.join(rootDir, 'sessions.json'), 'utf-8');
    expect(raw).toContain('"session-1"');
  });
});
```

Run:

```bash
npx vitest run tests/app/sessionRecordStore.test.ts
```

Expected before implementation: FAIL because `closeView` does not exist.

- [ ] **Step 2: 扩展类型**

Modify `src/shared/agentdockTypes.ts`:

```ts
export type NativeResumeState = {
  tool: 'claude' | 'codex';
  status: 'verified' | 'partial' | 'unavailable';
  sessionId?: string;
  resumeCommand?: string;
  checkedAt?: string;
  reason?: string;
};

export type RuntimeOwner = {
  windowId: string;
  webContentsId: number;
  startedAt: string;
};
```

Extend `AgentSession`:

```ts
archived?: boolean;
closedViewIds?: string[];
nativeResume?: NativeResumeState;
runtimeOwner?: RuntimeOwner;
```

Run:

```bash
npm run typecheck
```

Expected: Type errors in store/service until methods are implemented.

- [ ] **Step 3: 实现 store view/record 操作**

Modify `src/main/stores/sessionHistoryStore.ts` type:

```ts
closeView(sessionId: string, viewId: string): Promise<void>;
archiveSession(sessionId: string): Promise<void>;
deleteRecord(sessionId: string): Promise<void>;
```

Implement:

```ts
async closeView(sessionId: string, viewId: string): Promise<void> {
  await updateSession(sessionId, (entry) => ({
    ...entry,
    session: {
      ...entry.session,
      closedViewIds: Array.from(new Set([...(entry.session.closedViewIds ?? []), viewId])),
    },
  }));
}
```

Use existing `deleteSession` internals for `deleteRecord`, then keep `deleteSession` as a compatibility alias only until renderer is migrated.

Run:

```bash
npx vitest run tests/app/sessionRecordStore.test.ts
```

Expected: PASS.

- [ ] **Step 4: 改 SessionService 语义**

Modify `src/main/sessionService.ts`:

- `killTerminal` becomes stop-only: stop PTY and set status `stopped`, but do not call `historyStore.deleteSession`.
- Add `closeSessionView({ sessionId, viewId })`.
- Add `deleteSessionRecord({ sessionId })`.
- Add `archiveSessionRecord({ sessionId })`.

Add tests in `tests/app/sessionService.test.ts`:

```ts
it('stops a running PTY without deleting the session record', async () => {
  const session = await service.launch({ profile, workspace, command: 'zsh' });
  await service.killTerminal({ sessionId: session.id });

  await expect(service.list()).resolves.toEqual(
    expect.arrayContaining([expect.objectContaining({ id: session.id, status: 'stopped' })]),
  );
});
```

Run:

```bash
npx vitest run tests/app/sessionService.test.ts -t "without deleting the session record"
```

Expected: PASS.

- [ ] **Step 5: 增加 IPC/preload 白名单**

Modify `src/shared/preloadTypes.ts`:

```ts
closeSessionView(request: { sessionId: string; viewId: string }): Promise<void>;
deleteSessionRecord(request: { sessionId: string }): Promise<void>;
archiveSessionRecord(request: { sessionId: string }): Promise<void>;
```

Modify `src/preload/preload.cts` and `src/main/main.ts` to expose:

```text
sessions:closeView
sessions:deleteRecord
sessions:archiveRecord
```

Run:

```bash
npx vitest run tests/app/preloadTypes.test.ts tests/app/sessionSecurity.test.ts
```

Expected: PASS and no full secret/env payload.

---

## Batch 3: 左侧会话库

**目标:** 用左侧长期会话库替代横向标签，按 workspace 分组，支持轻量搜索、归档过滤和 `...` 菜单。

**Files:**
- Create: `src/renderer/components/SessionLibrary.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`
- Modify: `src/renderer/components/SessionTabs.tsx` or retire usage
- Test: `tests/app/App.test.tsx`

- [ ] **Step 1: 写 RED UI 测试**

Add to `tests/app/App.test.tsx`:

```ts
it('renders a workspace-grouped session library with a single new session action', async () => {
  render(<App />);

  expect(await screen.findByRole('navigation', { name: '会话库' })).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: '新会话' })).toHaveLength(1);
  expect(screen.queryByRole('tablist', { name: '会话标签' })).not.toBeInTheDocument();
});
```

Run:

```bash
npx vitest run tests/app/App.test.tsx -t "workspace-grouped session library"
```

Expected before implementation: FAIL.

- [ ] **Step 2: 创建 SessionLibrary 组件**

Create `src/renderer/components/SessionLibrary.tsx`:

```tsx
import type { AgentSession, ApiProfile, Workspace } from '../../shared/agentdockTypes';

type SessionLibraryProps = {
  sessions: AgentSession[];
  profiles: ApiProfile[];
  workspaces: Workspace[];
  activeSessionId?: string;
  onNewSession(): void;
  onOpenSession(sessionId: string): void;
  onContinueSession(sessionId: string): void;
  onArchiveSession(sessionId: string): void;
  onDeleteSession(sessionId: string): void;
};

export function SessionLibrary({
  sessions,
  profiles,
  workspaces,
  activeSessionId,
  onNewSession,
  onOpenSession,
  onContinueSession,
  onArchiveSession,
  onDeleteSession,
}: SessionLibraryProps): JSX.Element {
  const visibleSessions = sessions.filter((session) => !session.archived);

  return (
    <nav className="session-library" aria-label="会话库">
      <div className="session-library-header">
        <strong>AgentDock</strong>
        <button type="button" onClick={onNewSession}>新会话</button>
      </div>
      <input className="session-library-search" aria-label="搜索会话" />
      {workspaces.map((workspace) => {
        const workspaceSessions = visibleSessions.filter((session) => session.workspaceId === workspace.id);
        if (workspaceSessions.length === 0) {
          return null;
        }
        return (
          <section key={workspace.id} className="session-library-group">
            <h2>{workspace.name}</h2>
            {workspaceSessions.map((session) => {
              const profile = profiles.find((item) => item.id === session.profileId);
              return (
                <article key={session.id} className={session.id === activeSessionId ? 'session-library-item active' : 'session-library-item'}>
                  <button type="button" onClick={() => onOpenSession(session.id)}>
                    <span className={`session-status-dot ${session.status}`} />
                    <span>{session.title}</span>
                    <small>{profile?.name ?? session.profileId}</small>
                  </button>
                  <button type="button" aria-label={`${session.title} 更多操作`}>...</button>
                </article>
              );
            })}
          </section>
        );
      })}
    </nav>
  );
}
```

Run:

```bash
npx vitest run tests/app/App.test.tsx -t "workspace-grouped session library"
```

Expected: The component exists; App still fails until wired.

- [ ] **Step 3: 接入 App**

Modify `src/renderer/App.tsx`:

- Render `<SessionLibrary />` as the first column inside workbench.
- Remove `SessionTabs` from main terminal area.
- `closeSession` now calls `closeSessionView`, not `killTerminal`.
- Add explicit stop/delete/archive handlers.

Add status dot styles in `src/renderer/styles.css`:

```css
.session-status-dot.running { background: #1f9d55; }
.session-status-dot.stopped { background: #64748b; }
.session-status-dot.exited { background: #9ca3af; }
.session-status-dot.interrupted { background: #d97706; }
.session-status-dot.failed { background: #dc2626; }
.session-library-item.archived .session-status-dot {
  background: transparent;
  border: 1px solid #94a3b8;
}
```

Run:

```bash
npx vitest run tests/app/App.test.tsx
```

Expected: Existing App tests updated and passing.

- [ ] **Step 4: 搜索与归档过滤**

Add tests:

```ts
it('filters session library by title workspace and profile only', async () => {
  render(<App />);
  await userEvent.type(screen.getByLabelText('搜索会话'), 'AgentDock');
  expect(screen.queryByText('unrelated transcript marker')).not.toBeInTheDocument();
});
```

Implement local filtering inside `SessionLibrary` using session title, workspace name and profile name.

Run:

```bash
npx vitest run tests/app/App.test.tsx -t "filters session library"
```

Expected: PASS.

---

## Batch 4: 终端优先布局

**目标:** 右侧默认收起，终端获得主宽度；右侧展开后终端不低于 100 列。

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`
- Modify: `src/renderer/components/TerminalPane.tsx`
- Test: `tests/app/layoutPolish.test.ts`
- Test: `tests/app/App.test.tsx`

- [ ] **Step 1: 写 RED 布局测试**

Add to `tests/app/layoutPolish.test.ts`:

```ts
it('keeps the project panel collapsed by default and protects terminal width', () => {
  const css = readFileSync(path.join(process.cwd(), 'src/renderer/styles.css'), 'utf-8');

  expect(css).toMatch(/\.workbench-layout/);
  expect(css).toMatch(/--terminal-min-columns:\s*100/);
  expect(css).toMatch(/\.project-panel-rail/);
  expect(css).toMatch(/\.project-panel\.collapsed/);
});
```

Run:

```bash
npx vitest run tests/app/layoutPolish.test.ts -t "project panel collapsed"
```

Expected before implementation: FAIL.

- [ ] **Step 2: 实现三栏 CSS**

Modify `src/renderer/styles.css`:

```css
.workbench-layout {
  --session-library-width: clamp(220px, 20vw, 300px);
  --project-panel-width: clamp(320px, 26vw, 380px);
  --terminal-min-columns: 100;
  display: grid;
  grid-template-columns: var(--session-library-width) minmax(820px, 1fr) 36px;
  min-height: 0;
}

.workbench-layout.project-open {
  grid-template-columns: var(--session-library-width) minmax(820px, 1fr) minmax(320px, var(--project-panel-width));
}

@media (max-width: 1180px) {
  .workbench-layout.project-open {
    grid-template-columns: var(--session-library-width) minmax(760px, 1fr) 36px;
  }

  .project-panel {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    width: min(380px, 92vw);
  }
}
```

Run:

```bash
npx vitest run tests/app/layoutPolish.test.ts
```

Expected: PASS.

- [ ] **Step 3: UI 状态接入**

Modify `src/renderer/App.tsx`:

- Add `projectPanelOpen` state, default `false`.
- Render a narrow rail when closed.
- Use `aria-label="展开项目面板"` and `aria-label="收起项目面板"`.

Run:

```bash
npx vitest run tests/app/App.test.tsx -t "项目面板"
```

Expected: PASS after updating tests.

---

## Batch 5: 只读项目文件树

**目标:** 右侧项目面板显示只读文件树、git 状态、本会话期间变化标记和可拖动下方信息区。

**Files:**
- Create: `src/main/workspaceFileTreeService.ts`
- Create: `src/main/stores/sessionFileIndexStore.ts`
- Create: `src/renderer/components/ProjectPanel.tsx`
- Create: `src/renderer/components/WorkspaceFileTree.tsx`
- Create: `src/renderer/components/ProjectPanelInfoSections.tsx`
- Modify: `src/main/main.ts`
- Modify: `src/shared/agentdockTypes.ts`
- Modify: `src/shared/preloadTypes.ts`
- Modify: `src/preload/preload.cts`
- Test: `tests/app/workspaceFileTreeService.test.ts`
- Test: `tests/app/sessionFileIndexStore.test.ts`
- Test: `tests/app/App.test.tsx`

- [ ] **Step 1: 写文件树安全 RED 测试**

Create `tests/app/workspaceFileTreeService.test.ts`:

```ts
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createWorkspaceFileTreeService } from '../../src/main/workspaceFileTreeService';

describe('workspaceFileTreeService', () => {
  it('rejects paths outside the workspace root', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'agentdock-tree-'));
    const workspacePath = path.join(root, 'workspace');
    await mkdir(workspacePath);
    const service = createWorkspaceFileTreeService();

    await expect(service.listDirectory({ workspacePath, relativePath: '../' }))
      .rejects.toThrow('文件路径超出工作区');
  });

  it('lists files without returning file contents', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'agentdock-tree-'));
    const workspacePath = path.join(root, 'workspace');
    await mkdir(workspacePath);
    await writeFile(path.join(workspacePath, 'App.tsx'), 'secret source text', 'utf-8');
    const service = createWorkspaceFileTreeService();

    const result = await service.listDirectory({ workspacePath, relativePath: '.' });
    expect(result.entries).toEqual([
      expect.objectContaining({ name: 'App.tsx', type: 'file' }),
    ]);
    expect(JSON.stringify(result)).not.toContain('secret source text');
  });
});
```

Run:

```bash
npx vitest run tests/app/workspaceFileTreeService.test.ts
```

Expected before implementation: FAIL.

- [ ] **Step 2: 实现 workspaceFileTreeService**

Create `src/main/workspaceFileTreeService.ts`:

```ts
import { readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

export type FileTreeEntry = {
  name: string;
  relativePath: string;
  type: 'file' | 'directory';
  gitStatus?: 'M' | 'A' | 'D' | 'R' | '?';
  touchedInSession?: boolean;
};

export type FileTreeResult = {
  relativePath: string;
  entries: FileTreeEntry[];
};

function assertInsideWorkspace(workspaceRealPath: string, targetRealPath: string): void {
  if (targetRealPath !== workspaceRealPath && !targetRealPath.startsWith(`${workspaceRealPath}${path.sep}`)) {
    throw new Error('文件路径超出工作区');
  }
}

export function createWorkspaceFileTreeService() {
  return {
    async listDirectory({
      workspacePath,
      relativePath,
    }: {
      workspacePath: string;
      relativePath: string;
    }): Promise<FileTreeResult> {
      const workspaceRealPath = await realpath(workspacePath);
      const targetPath = path.resolve(workspacePath, relativePath);
      const targetRealPath = await realpath(targetPath);
      assertInsideWorkspace(workspaceRealPath, targetRealPath);

      const entries = await readdir(targetRealPath, { withFileTypes: true });
      return {
        relativePath,
        entries: entries
          .filter((entry) => !['.git', 'node_modules', 'dist', 'build', 'release', 'coverage', '.next', '.turbo'].includes(entry.name))
          .map((entry) => ({
            name: entry.name,
            relativePath: path.relative(workspaceRealPath, path.join(targetRealPath, entry.name)),
            type: entry.isDirectory() ? 'directory' : 'file',
          })),
      };
    },
  };
}
```

Run:

```bash
npx vitest run tests/app/workspaceFileTreeService.test.ts
```

Expected: PASS.

- [ ] **Step 3: 增加 session file index store**

Create `tests/app/sessionFileIndexStore.test.ts`:

```ts
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSessionFileIndexStore } from '../../src/main/stores/sessionFileIndexStore';

describe('sessionFileIndexStore', () => {
  it('stores touched files without source contents', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'agentdock-file-index-'));
    const store = createSessionFileIndexStore(root);

    await store.saveIndex('session-1', {
      baselineAt: '2026-07-07T00:00:00.000Z',
      files: [{ relativePath: 'src/App.tsx', gitStatus: 'M', touchedInSession: true }],
    });

    await expect(store.readIndex('session-1')).resolves.toEqual({
      baselineAt: '2026-07-07T00:00:00.000Z',
      files: [{ relativePath: 'src/App.tsx', gitStatus: 'M', touchedInSession: true }],
    });
  });
});
```

Implement `src/main/stores/sessionFileIndexStore.ts` using JSON files under `<userData>/session-file-index/<session-id>.json`.

Run:

```bash
npx vitest run tests/app/sessionFileIndexStore.test.ts
```

Expected: PASS.

- [ ] **Step 4: 接入 ProjectPanel UI**

Create `ProjectPanel`, `WorkspaceFileTree`, `ProjectPanelInfoSections`.

Renderer requirements:

- `只读` badge tooltip says `项目面板只用于查看文件和状态，AgentDock 不在这里编辑代码。`
- No editor textarea or code body.
- `选中文件` default expanded.
- `当前会话` and `恢复摘要` default collapsed.
- Draggable horizontal splitter changes lower info area height within min/max.

Run:

```bash
npx vitest run tests/app/App.test.tsx -t "文件树|只读|选中文件|恢复摘要"
```

Expected: PASS.

---

## Batch 6: 恢复语义整合

**目标:** 根据 Batch 1 探针结果启用 verified native resume；不可用时明确使用 AgentDock restore context fallback。

**Files:**
- Modify: `src/main/nativeResumeProbe.ts`
- Modify: `src/main/sessionService.ts`
- Modify: `src/main/restoreContextStore.ts`
- Modify: `src/shared/agentdockTypes.ts`
- Modify: `src/renderer/components/ProjectPanelInfoSections.tsx`
- Test: `tests/app/nativeResumeProbe.test.ts`
- Test: `tests/app/sessionService.test.ts`
- Test: `tests/app/App.test.tsx`
- Verification: `.agent-workflow/verification/2026-07-07-session-library-native-restore.md`

- [ ] **Step 1: 写 native resume 优先 RED 测试**

Add to `tests/app/sessionService.test.ts`:

```ts
it('uses verified Claude native resume before AgentDock restore context', async () => {
  const session = await service.launch({ profile: claudeProfile, workspace, command: 'claude' });
  await service.markNativeResumeVerified({
    sessionId: session.id,
    nativeSessionId: '123e4567-e89b-12d3-a456-426614174000',
    tool: 'claude',
  });

  const restarted = await service.restart({
    sessionId: session.id,
    profile: claudeProfile,
    workspace,
    command: 'claude',
  });

  expect(restarted.command).toContain('claude --resume 123e4567-e89b-12d3-a456-426614174000');
  expect(restarted.memoryRestore?.summary).not.toContain('AgentDock restore context');
});
```

Run:

```bash
npx vitest run tests/app/sessionService.test.ts -t "verified Claude native resume"
```

Expected before implementation: FAIL because service method/native command is absent.

- [ ] **Step 2: 实现 native resume selection**

Modify `src/main/sessionService.ts`:

- On Claude first launch, when capability verified, generate UUID with `crypto.randomUUID()` and append `--session-id <uuid>`.
- Store `session.nativeResume = { tool: 'claude', status: 'verified', sessionId: uuid, checkedAt }`.
- On restart, if `nativeResume.status === 'verified' && nativeResume.sessionId`, build `claude --resume <uuid>` and do not generate restore context.
- For Codex, only use native resume if Batch 1 verification record and metadata provide stable id.
- If native unavailable, run existing `restoreContextForRestart`.

Run:

```bash
npx vitest run tests/app/sessionService.test.ts -t "native resume|restore context"
```

Expected: PASS.

- [ ] **Step 3: UI 恢复摘要标识**

Add to `tests/app/App.test.tsx`:

```ts
it('labels fallback restore separately from native resume', async () => {
  render(<App />);
  expect(await screen.findByText(/AgentDock 恢复材料/)).toBeInTheDocument();
  expect(screen.queryByText(/原生恢复已验证/)).not.toBeInTheDocument();
});
```

Implement labels in `ProjectPanelInfoSections`.

Run:

```bash
npx vitest run tests/app/App.test.tsx -t "fallback restore"
```

Expected: PASS.

- [ ] **Step 4: 真机恢复验证**

Run:

```bash
npm run build
```

Then run packaged/dev smoke using real Claude/Codex profiles authorized by the user:

- Claude verified path: launch with generated `--session-id`, exit, continue with `--resume <uuid>`.
- Codex verified or fallback path: run according to Batch 1 result.
- Confirm terminal input area never receives full restore context body.

Write `.agent-workflow/verification/2026-07-07-session-library-native-restore.md` with exact command outputs and PASS/PARTIAL status.

---

## Final Integration

**Goal:** Prove all batches work together and the feature is ready for user testing.

- [ ] **Step 1: Full test suite**

Run:

```bash
npm run workflow:doctor
npm run test:workflow
npm test
npm run typecheck
npm run build
git diff --check
```

Expected:
- workflow doctor PASS
- workflow tests 8 passed
- app tests PASS
- typecheck PASS
- build PASS with only existing Vite chunk size warning
- diff check no output

- [ ] **Step 2: Security scan**

Run focused secret-like scan over changed source, tests and docs:

```bash
rg -n "sk-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|API_KEY=|AUTH_TOKEN=|BEGIN (RSA|OPENSSH|PRIVATE) KEY" src tests docs .agent-workflow
```

Expected: no real key; any test fixture uses non-secret test strings and is documented.

- [ ] **Step 3: Package smoke**

Run:

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run package:mac
codesign --verify --deep --strict --verbose=2 release/packages/<timestamp>/AgentDock-darwin-arm64/AgentDock.app
```

Expected: package succeeds and codesign verifies.

- [ ] **Step 4: Delivery report**

Create `.agent-workflow/delivery/2026-07-07-session-library-terminal-first-ui-delivery-report.md` with:

```markdown
# 长期会话库与终端优先布局交付报告

## 任务等级
L3

## 修改范围
- Session Record / Open View / PTY Process
- 左侧会话库
- 终端优先布局
- 只读项目文件树
- 恢复语义

## 验证结果
- npm run workflow:doctor:
- npm run test:workflow:
- npm test:
- npm run typecheck:
- npm run build:
- 真实 Claude resume:
- 真实 Codex resume/fallback:

## 风险结论
- 可交付 / 有条件交付 / 不可交付
```
