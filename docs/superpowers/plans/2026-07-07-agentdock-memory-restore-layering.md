# AgentDock Memory Restore Layering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 AgentDock 分层记忆恢复：短期 transcript 继续恢复终端显示，后台生成 restore context 文件并只注入短读取指令，UI 展示一句话恢复摘要。

**Architecture:** 在 main process 新增 restore context 文件生成模块，复用现有 summary store、transcript tail、terminal text sanitizer 和 secret redaction。`SessionService.restart` 在启动新 PTY 前准备恢复材料，启动后只写入短指令，并把恢复状态写入 `AgentSession.memoryRestore` 供 renderer 展示一句话摘要。Renderer 只显示轻量恢复状态和一句话摘要，不展示完整 prompt。

**Tech Stack:** Electron main process, React renderer, TypeScript, xterm.js, node-pty, Vitest, npm.

---

## File Structure

- Create: `src/main/restoreContextStore.ts`
  - 负责生成 restore context Markdown 文件、短读取指令和一句话摘要。
  - 不启动 PTY、不读 secret、不访问 IPC。
- Modify: `src/shared/agentdockTypes.ts`
  - 给 `AgentSession` 增加 `memoryRestore` 元数据。
- Modify: `src/main/sessionService.ts`
  - `restart` 路径准备 restore context，启动后只注入短读取指令。
  - 保留本地 shell 不恢复记忆的行为。
- Modify: `src/renderer/App.tsx`
  - 增加 `SessionMemoryRestoreBar`，展示 `正在恢复记忆`、`记忆已恢复：一句话摘要`、失败/空状态。
- Modify: `src/renderer/styles.css`
  - 给恢复摘要条增加轻量样式，复用现有 `session-context-bar` 和 `session-exit-actions` 的视觉体系。
- Modify: `src/preload/preload.cts`, `src/shared/preloadTypes.ts`, `src/renderer/types/global.d.ts`
  - 如果仅通过 `AgentSession.memoryRestore` 传递结果，则不新增 IPC 方法；只需保证类型更新能通过。
- Test: `tests/app/restoreContextStore.test.ts`
  - 覆盖 restore context 文件、短指令、一句话摘要和脱敏。
- Test: `tests/app/sessionService.test.ts`
  - 覆盖 restart 只写短指令，不写完整 restore context。
- Test: `tests/app/App.test.tsx`
  - 覆盖 UI 一句话恢复摘要。
- Test: `tests/app/preloadTypes.test.ts`
  - 如果没有新增 IPC 方法，确认白名单不变；如果实现中新增方法，必须更新此测试并证明没有 raw secret/env API。

## Implementation Notes

- 不引入新依赖。
- 不修改包管理器、锁文件、`.env`、`.gitignore`。
- 不把完整 API key、token、完整环境变量写入测试 fixture、文档示例或 UI。
- 当前仓库已有大量未提交改动；执行阶段必须只暂存本任务文件，不能回滚其它改动。
- L3 真实验证必须包含 node-pty smoke，确认 PTY 收到短读取指令且不包含完整 restore context 正文。

---

### Task 1: Restore Context Store

**Files:**
- Create: `src/main/restoreContextStore.ts`
- Test: `tests/app/restoreContextStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/app/restoreContextStore.test.ts`:

```ts
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildRestoreInstruction,
  createRestoreContextStore,
  summarizeRestoreMemory,
} from '../../src/main/restoreContextStore';
import type { AgentSession } from '../../src/shared/agentdockTypes';

const session: AgentSession = {
  id: 'session-w1-12',
  title: 'Claude A · AgentDock',
  profileId: 'claude-anyrouter',
  workspaceId: 'workspace-agentdock',
  command: 'claude --dangerously-skip-permissions',
  status: 'interrupted',
  startedAt: '2026-07-06T14:28:10.006Z',
};

describe('restoreContextStore', () => {
  it('writes a redacted restore context file and returns a short instruction', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-restore-context-store-'));
    const workspacePath = path.join(tempDir, 'workspace');
    try {
      const store = createRestoreContextStore();
      const result = await store.writeRestoreContext({
        workspacePath,
        session,
        summaryMarkdown: '# AgentDock Session Summary\n\n## Current Goal\n修复 AgentDock 会话恢复。',
        transcriptTail: 'OPENAI_API_KEY=[TEST_REDACTED_KEY]\n用户确认采用分层记忆恢复。',
      });

      expect(result.status).toBe('loaded');
      expect(result.summary).toBe('记忆已恢复：修复 AgentDock 会话恢复；用户确认采用分层记忆恢复。');
      expect(result.contextFile).toBe(path.join(workspacePath, '.agentdock/context/restores/session-w1-12.md'));
      expect(result.instruction).toBe(
        `Read the AgentDock restore context file, then continue the current task: ${result.contextFile}\r`,
      );

      const content = await readFile(result.contextFile as string, 'utf-8');
      expect(content).toContain('修复 AgentDock 会话恢复');
      expect(content).toContain('用户确认采用分层记忆恢复');
      expect(content).not.toContain(`sk-${'1'.repeat(24)}`);
      expect(content).toContain('[REDACTED]');
      expect(result.instruction).not.toContain('用户确认采用分层记忆恢复');
      expect(result.instruction).not.toContain('OPENAI_API_KEY');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('returns empty when no summary or transcript exists', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-restore-empty-'));
    try {
      const store = createRestoreContextStore();
      const result = await store.writeRestoreContext({
        workspacePath: tempDir,
        session,
        transcriptTail: '',
      });

      expect(result).toEqual({
        status: 'empty',
        summary: '未找到可恢复记忆',
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('builds one-sentence summaries deterministically', () => {
    expect(summarizeRestoreMemory({
      summaryMarkdown: '# AgentDock Session Summary\n\n## Current Goal\n整理分层记忆恢复设计。\n\n## Next Steps\n实现短指令注入。',
      transcriptTail: '用户要求摘要只用一句话。',
    })).toBe('记忆已恢复：整理分层记忆恢复设计；实现短指令注入；用户要求摘要只用一句话。');
  });

  it('keeps restore instruction short and path-only', () => {
    expect(buildRestoreInstruction('/tmp/agentdock restore/context.md')).toBe(
      'Read the AgentDock restore context file, then continue the current task: /tmp/agentdock restore/context.md\r',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run tests/app/restoreContextStore.test.ts
```

Expected: FAIL because `src/main/restoreContextStore` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `src/main/restoreContextStore.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentSession, MemoryRestoreState } from '../shared/agentdockTypes.js';
import { terminalOutputToPlainText } from '../shared/terminalText.js';
import { redactSummarySecrets } from './sessionSummaryStore.js';

export type RestoreContextInput = {
  workspacePath: string;
  session: AgentSession;
  summaryMarkdown?: string;
  transcriptTail: string;
};

export type RestoreContextResult = MemoryRestoreState & {
  instruction?: string;
};

export type RestoreContextStore = {
  writeRestoreContext(input: RestoreContextInput): Promise<RestoreContextResult>;
  restoreContextPath(workspacePath: string, sessionId: string): string;
};

const RESTORE_DIR_PARTS = ['.agentdock', 'context', 'restores'];
const MAX_SUMMARY_SENTENCE_CHARS = 160;

function safeRestoreFileName(sessionId: string): string {
  return `${sessionId.replace(/[^A-Za-z0-9._-]/g, '_')}.md`;
}

function normalizeReadableText(value: string | undefined): string {
  return redactSummarySecrets(terminalOutputToPlainText(value ?? '').trim());
}

function isIgnoredMemoryLine(line: string): boolean {
  return (
    /^agentdock session summary$/i.test(line) ||
    /^(current goal|instructions|discoveries|accomplished|next steps|relevant files)$/i.test(line) ||
    /\b[A-Z_]*(?:API_KEY|AUTH_TOKEN|TOKEN|SECRET)\b\s*=/.test(line) ||
    line === '[REDACTED]'
  );
}

function firstReadableLines(value: string, limit: number): string[] {
  return value
    .split('\n')
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .filter(Boolean)
    .filter((line) => !isIgnoredMemoryLine(line))
    .slice(0, limit);
}

function compactSentencePart(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/[。；;,.，]+$/g, '')
    .slice(0, MAX_SUMMARY_SENTENCE_CHARS)
    .trim();
}

export function summarizeRestoreMemory({
  summaryMarkdown,
  transcriptTail,
}: {
  summaryMarkdown?: string;
  transcriptTail: string;
}): string {
  const summaryText = normalizeReadableText(summaryMarkdown);
  const transcriptText = normalizeReadableText(transcriptTail);
  const parts = [
    ...firstReadableLines(summaryText, 2),
    ...firstReadableLines(transcriptText, 1),
  ]
    .map(compactSentencePart)
    .filter(Boolean);

  if (parts.length === 0) {
    return '未找到可恢复记忆';
  }

  return `记忆已恢复：${parts.join('；')}。`;
}

export function buildRestoreInstruction(contextFile: string): string {
  return `Read the AgentDock restore context file, then continue the current task: ${contextFile}\r`;
}

export function createRestoreContextStore(): RestoreContextStore {
  function restoreContextPath(workspacePath: string, sessionId: string): string {
    return path.join(workspacePath, ...RESTORE_DIR_PARTS, safeRestoreFileName(sessionId));
  }

  return {
    restoreContextPath,

    async writeRestoreContext({
      workspacePath,
      session,
      summaryMarkdown,
      transcriptTail,
    }: RestoreContextInput): Promise<RestoreContextResult> {
      const safeSummary = normalizeReadableText(summaryMarkdown);
      const safeTranscriptTail = normalizeReadableText(transcriptTail);
      const summary = summarizeRestoreMemory({
        summaryMarkdown: safeSummary,
        transcriptTail: safeTranscriptTail,
      });

      if (!safeSummary && !safeTranscriptTail) {
        return { status: 'empty', summary };
      }

      const contextFile = restoreContextPath(workspacePath, session.id);
      const content = [
        '# AgentDock Restore Context',
        '',
        '## Session',
        `- Session ID: ${session.id}`,
        `- Profile ID: ${session.profileId}`,
        `- Workspace ID: ${session.workspaceId}`,
        `- Command: ${session.command}`,
        `- Previous Status: ${session.status}`,
        '',
        '## One Sentence Summary',
        summary,
        '',
        '## Long-Term Summary',
        safeSummary || '(empty)',
        '',
        '## Recent Transcript Tail',
        safeTranscriptTail || '(empty)',
        '',
      ].join('\n');

      await mkdir(path.dirname(contextFile), { recursive: true });
      await writeFile(contextFile, content, 'utf-8');

      return {
        status: 'loaded',
        summary,
        contextFile,
        instruction: buildRestoreInstruction(contextFile),
      };
    },
  };
}
```

- [ ] **Step 4: Add shared type**

Modify `src/shared/agentdockTypes.ts`:

```ts
export type MemoryRestoreStatus = 'loaded' | 'empty' | 'failed';

export type MemoryRestoreState = {
  status: MemoryRestoreStatus;
  summary: string;
  contextFile?: string;
  error?: string;
};
```

Then add to `AgentSession`:

```ts
  memoryRestore?: MemoryRestoreState;
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
npx vitest run tests/app/restoreContextStore.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/agentdockTypes.ts src/main/restoreContextStore.ts tests/app/restoreContextStore.test.ts
git commit -m "feat: add restore context store"
```

---

### Task 2: Restart Uses Restore Context File and Short Instruction

**Files:**
- Modify: `src/main/sessionService.ts`
- Test: `tests/app/sessionService.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/app/sessionService.test.ts` near the existing restore restart tests:

First update the import:

```ts
import { mkdtemp, readFile, rm } from 'node:fs/promises';
```

```ts
  it('writes a restore context file and injects only the short read instruction when restarting an agent session', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-restore-file-restart-'));
    const runtime = createFakeRuntime();
    const historyStore = createSessionHistoryStore(tempDir);
    try {
      const service = createSessionService({
        clock: { now: () => new Date('2026-07-01T00:00:00.000Z') },
        keychain: runtime.keychain,
        pty: runtime.pty,
        appDataPath: '/tmp/agentdock-test-data',
        historyStore,
      });
      const profile = {
        id: 'profile-a',
        name: 'Claude A',
        toolType: 'claude' as const,
        baseUrl: 'https://example.invalid/v1',
        keychainService: 'AgentDock',
        keychainAccount: 'profile-a',
      };
      const workspace = {
        id: 'workspace-a',
        name: 'AgentDock',
        path: tempDir,
      };

      const session = await service.launch({ profile, workspace, command: 'claude' });
      runtime.dataHandlers.get(session.id)?.('用户确认：恢复摘要只显示一句话。');
      runtime.exitHandlers.get(session.id)?.({ exitCode: 0 });

      const restarted = await service.restart({
        sessionId: session.id,
        profile,
        workspace,
        command: 'claude --resume c4bf-b857',
      });

      const restoreWrite = runtime.writes.find((write) =>
        write.input.includes('Read the AgentDock restore context file'),
      );
      expect(restoreWrite?.input).toBe(
        `Read the AgentDock restore context file, then continue the current task: ${path.join(tempDir, '.agentdock/context/restores/session-1.md')}\r`,
      );
      expect(restoreWrite?.input).not.toContain('用户确认：恢复摘要只显示一句话');
      expect(restarted.memoryRestore).toMatchObject({
        status: 'loaded',
        summary: '记忆已恢复：用户确认：恢复摘要只显示一句话。',
        contextFile: path.join(tempDir, '.agentdock/context/restores/session-1.md'),
      });
      await expect(readFile(path.join(tempDir, '.agentdock/context/restores/session-1.md'), 'utf-8'))
        .resolves.toContain('用户确认：恢复摘要只显示一句话');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('does not inject restore memory into local shell restarts', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-shell-no-restore-'));
    const runtime = createFakeRuntime();
    const historyStore = createSessionHistoryStore(tempDir);
    try {
      const service = createSessionService({
        clock: { now: () => new Date('2026-07-01T00:00:00.000Z') },
        keychain: runtime.keychain,
        pty: runtime.pty,
        appDataPath: '/tmp/agentdock-test-data',
        historyStore,
      });
      const profile = {
        id: 'profile-a',
        name: 'Claude A',
        toolType: 'claude' as const,
        baseUrl: 'https://example.invalid/v1',
        keychainService: 'AgentDock',
        keychainAccount: 'profile-a',
      };
      const workspace = {
        id: 'workspace-a',
        name: 'AgentDock',
        path: tempDir,
      };

      const session = await service.launch({ profile, workspace, command: 'zsh' });
      runtime.dataHandlers.get(session.id)?.('shell output');
      runtime.exitHandlers.get(session.id)?.({ exitCode: 0 });

      const restarted = await service.restart({
        sessionId: session.id,
        profile,
        workspace,
        command: 'zsh',
      });

      expect(runtime.writes.some((write) => write.input.includes('Read the AgentDock restore context file'))).toBe(false);
      expect(restarted.memoryRestore).toBeUndefined();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest run tests/app/sessionService.test.ts -t "restore context file"
```

Expected: FAIL because restart still injects the full restore prompt and `memoryRestore` is missing.

- [ ] **Step 3: Modify SessionService**

In `src/main/sessionService.ts`, import the new store:

```ts
import { createRestoreContextStore, type RestoreContextResult } from './restoreContextStore.js';
```

Inside `createSessionService`, after `sessionSummaryStore`:

```ts
  const restoreContextStore = createRestoreContextStore();
```

Replace the current `restorePromptInput` and `restorePromptForRestart` block with:

```ts
  async function restoreContextForRestart({
    session,
    profile,
    workspace,
    command,
  }: {
    session: AgentSession;
    profile: ApiProfile;
    workspace: Workspace;
    command: string;
  }): Promise<RestoreContextResult | undefined> {
    if (isLocalShellCommand(command) || !['claude', 'codex'].includes(profile.toolType)) {
      return undefined;
    }

    const transcriptTail = terminalBuffers.get(session.id) ?? await historyStore?.readBuffer(session.id) ?? '';
    const latestSummary = await sessionSummaryStore.readLatestSummary({
      workspacePath: workspace.path,
      sessionId: session.id,
    });
    const summaryMarkdown = latestSummary?.handoffMarkdown ?? latestSummary?.summaryMarkdown;

    return restoreContextStore.writeRestoreContext({
      workspacePath: workspace.path,
      session,
      summaryMarkdown,
      transcriptTail,
    }).catch((error: unknown) => ({
      status: 'failed',
      summary: '记忆恢复失败',
      error: error instanceof Error ? error.message : '未知错误',
    }));
  }
```

In `restart`, replace restore prompt handling:

```ts
      const memoryRestore = await restoreContextForRestart({
        session: cloneSession(session),
        profile,
        workspace,
        command: nextCommand,
      });
```

Then after `startSessionPty`:

```ts
      if (memoryRestore?.status === 'loaded' && memoryRestore.instruction) {
        requirePtySession(restartedSession.id).write(memoryRestore.instruction);
      }
      if (memoryRestore) {
        session.memoryRestore = {
          status: memoryRestore.status,
          summary: memoryRestore.summary,
          contextFile: memoryRestore.contextFile,
          error: memoryRestore.error,
        };
        persistSession(session);
        publishSessionChanged(session);
      }
```

Return `cloneSession(session)` instead of the pre-clone `restartedSession` if needed so the caller receives `memoryRestore`:

```ts
      return cloneSession(session);
```

Remove the old `buildContextRestorePrompt` import if unused.

- [ ] **Step 4: Run focused tests**

Run:

```bash
npx vitest run tests/app/sessionService.test.ts tests/app/restoreContextStore.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/sessionService.ts tests/app/sessionService.test.ts
git commit -m "feat: restore sessions from context files"
```

---

### Task 3: Renderer Shows One-Sentence Restore Summary

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`
- Test: `tests/app/App.test.tsx`

- [ ] **Step 1: Write the failing UI tests**

Add to `tests/app/App.test.tsx` near restart/recovery tests:

```ts
  it('shows one-sentence memory restore summary after restarting a session', async () => {
    let resolveRestart: ((session: AgentSession) => void) | undefined;
    const api = installAgentDockApi({
      listSessions: vi.fn().mockResolvedValue([
        {
          id: 'session-1',
          title: 'Claude A · AgentDock',
          profileId: 'profile-a',
          workspaceId: 'workspace-a',
          command: 'claude --dangerously-skip-permissions',
          claudeLaunchMode: 'lite',
          status: 'interrupted',
          startedAt: '2026-07-02T00:00:00.000Z',
        },
      ]),
      restartSession: vi.fn().mockImplementation(
        () =>
          new Promise<AgentSession>((resolve) => {
            resolveRestart = resolve;
          }),
      ),
    });

    render(<App />);

    expect(await screen.findByText('会话已中断 · 可重新启动')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新启动' }));

    expect(await screen.findByText('正在恢复记忆')).toBeInTheDocument();

    act(() => {
      resolveRestart?.({
        id: 'session-1',
        title: 'Claude A · AgentDock',
        profileId: 'profile-a',
        workspaceId: 'workspace-a',
        command: 'claude --dangerously-skip-permissions',
        claudeLaunchMode: 'lite',
        status: 'running',
        startedAt: '2026-07-02T00:02:00.000Z',
        memoryRestore: {
          status: 'loaded',
          summary: '记忆已恢复：上次会话确认采用分层记忆恢复。',
          contextFile: '/tmp/workspace/.agentdock/context/restores/session-1.md',
        },
      });
    });

    expect(await screen.findByText('记忆已恢复：上次会话确认采用分层记忆恢复。')).toBeInTheDocument();
    expect(screen.queryByText('/tmp/workspace/.agentdock/context/restores/session-1.md')).not.toBeInTheDocument();
    expect(api.restartSession).toHaveBeenCalled();
  });

  it('shows empty memory restore state without exposing restore prompt text', async () => {
    installAgentDockApi({
      listSessions: vi.fn().mockResolvedValue([
        {
          id: 'session-1',
          title: 'Claude A · AgentDock',
          profileId: 'profile-a',
          workspaceId: 'workspace-a',
          command: 'claude',
          status: 'interrupted',
          startedAt: '2026-07-02T00:00:00.000Z',
        },
      ]),
      restartSession: vi.fn().mockResolvedValue({
        id: 'session-1',
        title: 'Claude A · AgentDock',
        profileId: 'profile-a',
        workspaceId: 'workspace-a',
        command: 'claude',
        status: 'running',
        startedAt: '2026-07-02T00:02:00.000Z',
        memoryRestore: {
          status: 'empty',
          summary: '未找到可恢复记忆',
        },
      }),
    });

    render(<App />);

    expect(await screen.findByText('会话已中断 · 可重新启动')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新启动' }));

    expect(await screen.findByText('未找到可恢复记忆')).toBeInTheDocument();
    expect(screen.queryByText(/Read the AgentDock restore context file/)).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest run tests/app/App.test.tsx -t "memory restore"
```

Expected: FAIL because App does not render `memoryRestore` state.

- [ ] **Step 3: Implement renderer state and component**

In `src/renderer/App.tsx`, add component after `SessionContextBar`:

```tsx
function SessionMemoryRestoreBar({
  restore,
}: {
  restore?: AgentSession['memoryRestore'];
}): React.JSX.Element | null {
  if (!restore) {
    return null;
  }

  const className = restore.status === 'failed'
    ? 'session-memory-restore session-memory-restore-error'
    : 'session-memory-restore';

  return (
    <div className={className} role="status" aria-label="记忆恢复状态">
      <span>{restore.summary}</span>
    </div>
  );
}
```

In `App`, add state:

```ts
  const [pendingMemoryRestoreSessionId, setPendingMemoryRestoreSessionId] = React.useState<string | undefined>();
```

In `restartSessionInPlace`, before calling `api.restartSession`:

```ts
      setPendingMemoryRestoreSessionId(sourceSession.id);
```

After successful restart:

```ts
      setPendingMemoryRestoreSessionId(undefined);
      setActionStatus(session.memoryRestore?.status === 'loaded' ? session.memoryRestore.summary : '会话已重新启动');
```

In `finally`, ensure pending state clears on errors:

```ts
      setPendingMemoryRestoreSessionId(undefined);
```

Render the pending/loaded bar above `TerminalPane`:

```tsx
              {pendingMemoryRestoreSessionId === activeSessionId ? (
                <div className="session-memory-restore" role="status" aria-label="记忆恢复状态">
                  <span>正在恢复记忆</span>
                </div>
              ) : (
                <SessionMemoryRestoreBar restore={activeSession?.memoryRestore} />
              )}
```

- [ ] **Step 4: Add styles**

Append to `src/renderer/styles.css` near session context styles:

```css
.session-memory-restore {
  align-items: center;
  background: #eef7f2;
  border-bottom: 1px solid #cfe8dc;
  color: #185c3d;
  display: flex;
  font-size: 12px;
  min-height: 28px;
  padding: 6px 14px;
}

.session-memory-restore-error {
  background: #fff1f2;
  border-bottom-color: #fecdd3;
  color: #9f1239;
}
```

- [ ] **Step 5: Run focused UI tests**

Run:

```bash
npx vitest run tests/app/App.test.tsx -t "memory restore|restarting an exited session"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/App.tsx src/renderer/styles.css tests/app/App.test.tsx
git commit -m "feat: show memory restore summary"
```

---

### Task 4: Safety and IPC Contract Verification

**Files:**
- Modify only if needed: `src/shared/preloadTypes.ts`
- Modify only if needed: `src/preload/preload.cts`
- Modify only if needed: `src/renderer/types/global.d.ts`
- Test: `tests/app/preloadTypes.test.ts`
- Test: `tests/app/sessionSecurity.test.ts`

- [ ] **Step 1: Verify no new IPC is needed**

Inspect:

```bash
rg -n "memoryRestore|restoreContext|AGENT_DOCK_API_METHODS|contextBridge|ipcRenderer.invoke" src/shared src/preload src/renderer
```

Expected: `memoryRestore` travels inside `AgentSession`; no new method appears in `AGENT_DOCK_API_METHODS`.

- [ ] **Step 2: Add security assertion**

In `tests/app/sessionSecurity.test.ts`, add:

```ts
  it('does not expose full restore context or secrets through session metadata', () => {
    const secret = `sk-${'1'.repeat(24)}`;
    const sessionPayload = JSON.stringify({
      id: 'session-1',
      memoryRestore: {
        status: 'loaded',
        summary: '记忆已恢复：继续修复恢复体验。',
        contextFile: '/tmp/workspace/.agentdock/context/restores/session-1.md',
      },
    });

    expect(sessionPayload).not.toContain(secret);
    expect(sessionPayload).not.toContain('OPENAI_API_KEY');
    expect(sessionPayload).not.toContain('Recent Transcript Tail');
    expect(sessionPayload).not.toContain('Read the AgentDock restore context file');
  });
```

- [ ] **Step 3: Run safety tests**

Run:

```bash
npx vitest run tests/app/preloadTypes.test.ts tests/app/sessionSecurity.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

If only tests changed:

```bash
git add tests/app/sessionSecurity.test.ts
git commit -m "test: cover restore metadata safety"
```

If preload type files changed, include only those specific files:

```bash
git add src/shared/preloadTypes.ts src/preload/preload.cts src/renderer/types/global.d.ts tests/app/preloadTypes.test.ts tests/app/sessionSecurity.test.ts
git commit -m "test: cover restore metadata safety"
```

---

### Task 5: Integration Verification and Delivery Notes

**Files:**
- Create: `.agent-workflow/verification/2026-07-07-agentdock-memory-restore-layering.md`
- Create: `.agent-workflow/delivery/2026-07-07-agentdock-memory-restore-layering-delivery-report.md`
- Modify: `.agent-workflow/state.md`

- [ ] **Step 1: Run focused tests**

Run:

```bash
npx vitest run tests/app/restoreContextStore.test.ts tests/app/sessionService.test.ts tests/app/App.test.tsx tests/app/preloadTypes.test.ts tests/app/sessionSecurity.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run required project checks**

Run:

```bash
npm run workflow:doctor
npm run typecheck
npm run build
```

Expected:

- `workflow:doctor`: PASS.
- `typecheck`: PASS.
- `build`: PASS, Vite chunk size warning is acceptable if unchanged.

- [ ] **Step 3: Run workflow tests**

Because this touches `.agent-workflow` delivery records:

```bash
npm run test:workflow
```

Expected: PASS.

- [ ] **Step 4: Run real node-pty restore smoke**

Create and run a temporary one-off script outside the repo or use `node -e` after build. The smoke must:

1. Start a fake agent session using `node-pty` with `cat`.
2. Simulate previous transcript text.
3. Restart through `SessionService.restart`.
4. Confirm captured PTY input contains `Read the AgentDock restore context file`.
5. Confirm captured PTY input does not contain the full transcript sentence.

Run command shape:

```bash
npm run build
node --input-type=module <<'NODE'
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { createSessionService } from './dist/main/sessionService.js';
import { createSessionHistoryStore } from './dist/main/stores/sessionHistoryStore.js';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-memory-restore-smoke-'));
const writes = [];
const dataHandlers = new Map();
const exitHandlers = new Map();
const pty = {
  async spawn(request) {
    return {
      write(input) { writes.push(input); },
      resize() {},
      kill() {},
      onData(handler) { dataHandlers.set(request.sessionId, handler); return () => {}; },
      onExit(handler) { exitHandlers.set(request.sessionId, handler); return () => {}; },
    };
  },
};
const keychain = { async readSecret() { return 'fake-secret'; }, async writeSecret() {}, async deleteSecret() {} };
const service = createSessionService({
  keychain,
  pty,
  appDataPath: tempDir,
  historyStore: createSessionHistoryStore(tempDir),
  clock: { now: () => new Date('2026-07-07T00:00:00.000Z') },
});
const profile = {
  id: 'claude-a',
  name: 'Claude A',
  toolType: 'claude',
  baseUrl: 'https://example.invalid/v1',
  keychainService: 'AgentDock',
  keychainAccount: 'claude-a',
};
const workspace = { id: 'workspace-a', name: 'Workspace A', path: tempDir };
const session = await service.launch({ profile, workspace, command: 'claude' });
dataHandlers.get(session.id)?.('用户确认：输入框不要显示完整恢复提示词。');
exitHandlers.get(session.id)?.({ exitCode: 0 });
const restarted = await service.restart({ sessionId: session.id, profile, workspace, command: 'claude' });
const restoreWrite = writes.find((item) => item.includes('Read the AgentDock restore context file'));
if (!restoreWrite) throw new Error('missing restore instruction');
if (restoreWrite.includes('用户确认：输入框不要显示完整恢复提示词')) throw new Error('full context leaked into PTY input');
if (restarted.memoryRestore?.status !== 'loaded') throw new Error('missing memory restore metadata');
console.log(JSON.stringify({ ok: true, restoreWrite, summary: restarted.memoryRestore.summary }));
await rm(tempDir, { recursive: true, force: true });
NODE
```

Expected: JSON contains `"ok":true`; `restoreWrite` contains only the restore context file path.

- [ ] **Step 5: Scan for secret-like leakage in touched files**

Run:

```bash
rg -n "sk-[A-Za-z0-9]{20,}|OPENAI_API_KEY=.*[A-Za-z0-9]{12,}|ANTHROPIC_(AUTH_TOKEN|API_KEY)=.*[A-Za-z0-9]{12,}" src/main/restoreContextStore.ts tests/app/restoreContextStore.test.ts tests/app/sessionService.test.ts tests/app/App.test.tsx
```

Expected: no real secrets. Test-only synthetic values using repeated characters are acceptable only if already redacted in assertions and not usable credentials.

- [ ] **Step 6: Write verification record**

Create `.agent-workflow/verification/2026-07-07-agentdock-memory-restore-layering.md`:

```md
# AgentDock 分层记忆恢复验证记录

## 范围

实现 restore context 文件、短读取指令注入、UI 一句话恢复摘要和安全脱敏验证。

## 命令结果

| 命令 | 结果 |
|------|------|
| `npx vitest run tests/app/restoreContextStore.test.ts tests/app/sessionService.test.ts tests/app/App.test.tsx tests/app/preloadTypes.test.ts tests/app/sessionSecurity.test.ts` | PASS |
| `npm run workflow:doctor` | PASS |
| `npm run test:workflow` | PASS |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| real node-pty restore smoke | PASS |
| touched files secret-like scan | PASS |

## 真实验证结论

node-pty smoke 证明 PTY 只收到 `Read the AgentDock restore context file` 短指令，未收到完整 transcript 内容；Renderer 通过测试展示一句话恢复摘要。
```

- [ ] **Step 7: Write delivery report**

Create `.agent-workflow/delivery/2026-07-07-agentdock-memory-restore-layering-delivery-report.md`:

```md
# AgentDock 分层记忆恢复交付报告

## 任务等级

L3。

触发原因：PTY 输入、会话恢复、本地 transcript/summary 文件、密钥安全边界。

## 交付内容

- 新增 restore context 文件生成。
- 重启 Agent 会话时只注入短读取指令。
- UI 展示一句话恢复摘要。
- 保持 transcript tail 恢复终端显示。
- 补充安全和真实 PTY 验证。

## 验证记录

见 `.agent-workflow/verification/2026-07-07-agentdock-memory-restore-layering.md`。

## 风险结论

可交付。恢复内容后台处理，输入框不显示完整恢复提示词；restore context 和 UI 摘要经过脱敏。
```

- [ ] **Step 8: Update workflow state**

Update `.agent-workflow/state.md` to record:

- 当前任务：AgentDock 分层记忆恢复。
- 风险等级：L3。
- 当前 Hook：delivery_hook after completion.
- 验证记录 path.
- 交付报告 path.

- [ ] **Step 9: Final commit**

```bash
git add .agent-workflow/verification/2026-07-07-agentdock-memory-restore-layering.md .agent-workflow/delivery/2026-07-07-agentdock-memory-restore-layering-delivery-report.md .agent-workflow/state.md
git commit -m "docs: record memory restore delivery"
```

---

## Plan Self-Review

**Spec coverage:**

- 短期 transcript tail：Task 2 reuses existing `historyStore.readBuffer`; Task 5 verifies terminal/history behavior remains in focused tests.
- Restore context 文件：Task 1 and Task 2.
- 短指令注入：Task 1 and Task 2.
- 输入框不显示大段提示词：Task 2 tests PTY write; Task 5 node-pty smoke.
- 一句话 UI 摘要：Task 1 deterministic summary; Task 3 renderer display.
- 无 summary fallback：Task 1 empty/fallback summary; Task 2 transcript-only restart.
- 安全脱敏：Task 1 redaction; Task 4 metadata safety; Task 5 secret scan.
- L3 真实验证：Task 5 node-pty smoke.

**Scope check:**

This plan stays inside the existing file-backed MVP. It does not add SQLite, FTS, cloud sync, or a memory dashboard.

**Type consistency:**

`MemoryRestoreState` is defined in `src/shared/agentdockTypes.ts`, used by `AgentSession.memoryRestore`, returned internally by `restoreContextStore`, and rendered by `SessionMemoryRestoreBar`.
