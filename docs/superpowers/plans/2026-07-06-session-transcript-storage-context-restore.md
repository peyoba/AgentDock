# 会话 Transcript 存储与上下文恢复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按中文 SPEC 实现 per-session transcript 文件存储、移除底部 5MB 提示、保留有边界终端回放，并用 summary + 最近脱敏 transcript tail 恢复 AI 续接上下文。

**Architecture:** `sessions.json` 只存轻量 metadata；新增 `sessionTranscriptStore` 管理 transcript 文件 append/tail/cleanup；`sessionHistoryStore` 负责旧 JSON buffer 迁移和 metadata 编排；`SessionService` 继续编排 PTY 输出、回放读取、summary/续接；Renderer 移除存储上限 warning，只保留 context pressure 和恢复操作。

**Tech Stack:** Electron main process + React Renderer + TypeScript + Vitest + xterm.js + node-pty adapter。

---

## 文件结构

- 创建 `src/main/stores/sessionTranscriptStore.ts`：append PTY 输出、按 UTF-8 边界读取 tail、统计大小、删除 transcript 文件。
- 修改 `src/main/stores/sessionHistoryStore.ts`：迁移旧 `terminalBuffer`、metadata-only 保存、调用 transcript store、cleanup。
- 修改 `src/main/sessionService.ts`：PTY 输出写 transcript；`readTerminalBuffer` 返回有边界 tail；移除 5MB `historyLimitReached` 工作流依赖。
- 修改 `src/main/contextBudgetEstimator.ts`：不再把旧本地 replay limit 作为 `full` 依据。
- 修改 `src/shared/agentdockTypes.ts`：新增 transcript metadata，移除或保留兼容旧字段但不再驱动 UI。
- 修改 `src/renderer/App.tsx`：移除 `SessionHistoryLimitBar` 和 `新开会话` / `存档历史` 存储动作。
- 修改 `src/preload/preload.cts` / `src/shared/preloadTypes.ts`：如 archive IPC 不再被 UI 使用，保留兼容但不新增暴露面。
- 新增或修改测试：
  - `tests/app/sessionTranscriptStore.test.ts`
  - `tests/app/metadataStores.test.ts`
  - `tests/app/sessionService.test.ts`
  - `tests/app/contextBudgetEstimator.test.ts`
  - `tests/app/App.test.tsx`
  - `tests/app/preloadTypes.test.ts`

## Task 1: Transcript Store

**Files:**
- Create: `src/main/stores/sessionTranscriptStore.ts`
- Test: `tests/app/sessionTranscriptStore.test.ts`

- [ ] **Step 1: 写 RED 测试**

```ts
it('appends output and reads a bounded UTF-8 tail', async () => {
  const store = createSessionTranscriptStore(tempDir, { tailBytes: 10 });
  await store.appendOutput('session-1', 'hello-');
  await store.appendOutput('session-1', '中文-output');

  const tail = await store.readTail('session-1');

  expect(tail.content).toContain('output');
  expect(tail.content).not.toContain('\uFFFD');
  expect(tail.truncated).toBe(true);
  expect(tail.byteSize).toBeGreaterThan(10);
});
```

- [ ] **Step 2: 运行 RED**

Run: `npx vitest run tests/app/sessionTranscriptStore.test.ts`

Expected: FAIL，因为 `sessionTranscriptStore` 模块尚不存在。

- [ ] **Step 3: 最小实现**

实现接口：

```ts
export type SessionTranscriptStore = {
  appendOutput(sessionId: string, data: string): Promise<void>;
  readTail(sessionId: string): Promise<{ content: string; byteSize: number; truncated: boolean; filePath: string }>;
  deleteTranscript(sessionId: string): Promise<void>;
  transcriptPath(sessionId: string): string;
};
```

实现要点：

- transcript 路径为 `<rootDir>/session-transcripts/<safe-session-id>.log`
- append 前 `mkdir` 父目录
- tail 默认 20 MB，测试可注入更小值
- tail 从文件末尾读取，向后调整到 UTF-8 字符边界，避免 replacement char
- 每个 session append 串行化

- [ ] **Step 4: 运行 GREEN**

Run: `npx vitest run tests/app/sessionTranscriptStore.test.ts`

Expected: PASS。

## Task 2: Metadata-only History Store And Migration

**Files:**
- Modify: `src/main/stores/sessionHistoryStore.ts`
- Modify: `src/shared/agentdockTypes.ts`
- Test: `tests/app/metadataStores.test.ts`

- [ ] **Step 1: 写 RED 测试**

```ts
it('migrates legacy terminalBuffer entries into transcript files', async () => {
  await writeFile(
    path.join(tempDir, 'sessions.json'),
    JSON.stringify([
      {
        id: 'session-1',
        session: legacySession,
        terminalBuffer: 'old terminal output',
      },
    ]),
  );

  const transcriptStore = createSessionTranscriptStore(tempDir);
  const historyStore = createSessionHistoryStore(tempDir, { transcriptStore });
  const sessions = await historyStore.listSessions();
  const persistedJson = await readFile(path.join(tempDir, 'sessions.json'), 'utf-8');
  const tail = await transcriptStore.readTail('session-1');

  expect(sessions[0].transcript?.byteSize).toBeGreaterThan(0);
  expect(tail.content).toContain('old terminal output');
  expect(persistedJson).not.toContain('terminalBuffer');
  expect(persistedJson).not.toContain('old terminal output');
});
```

- [ ] **Step 2: 运行 RED**

Run: `npx vitest run tests/app/metadataStores.test.ts`

Expected: FAIL，因为 history store 仍保存 `terminalBuffer`。

- [ ] **Step 3: 最小实现**

修改 `AgentSession` 增加：

```ts
transcript?: {
  filePath: string;
  byteSize: number;
  tailBytes: number;
  tailTruncated: boolean;
};
```

修改 `SessionHistoryEntry`：

```ts
type SessionHistoryEntry = {
  id: string;
  session: AgentSession;
};
```

迁移逻辑：

- 读取旧 entry 时如果存在 `terminalBuffer`
- transcript 文件不存在或为空时写入旧 buffer
- 更新 session.transcript metadata
- rewrite `sessions.json`，去掉 `terminalBuffer`
- 保持 JSON repair 备份逻辑

- [ ] **Step 4: 运行 GREEN**

Run: `npx vitest run tests/app/metadataStores.test.ts`

Expected: PASS。

## Task 3: Cleanup Limits

**Files:**
- Modify: `src/main/stores/sessionHistoryStore.ts`
- Modify: `src/main/stores/sessionTranscriptStore.ts`
- Test: `tests/app/metadataStores.test.ts`

- [ ] **Step 1: 写 RED 测试**

```ts
it('cleans oldest non-running sessions while preserving running sessions', async () => {
  const historyStore = createSessionHistoryStore(tempDir, {
    transcriptStore,
    maxSessions: 2,
    maxTranscriptBytes: 12,
  });

  await historyStore.saveSession(oldStoppedSession);
  await historyStore.appendOutput(oldStoppedSession.id, 'old output data');
  await historyStore.saveSession(runningSession);
  await historyStore.appendOutput(runningSession.id, 'running output data');
  await historyStore.saveSession(newStoppedSession);
  await historyStore.appendOutput(newStoppedSession.id, 'new output data');

  const sessions = await historyStore.listSessions();

  expect(sessions.map((session) => session.id)).toContain(runningSession.id);
  expect(sessions.map((session) => session.id)).toContain(newStoppedSession.id);
  expect(sessions.map((session) => session.id)).not.toContain(oldStoppedSession.id);
});
```

- [ ] **Step 2: 运行 RED**

Run: `npx vitest run tests/app/metadataStores.test.ts`

Expected: FAIL，因为 cleanup 尚未基于 transcript 文件总量执行。

- [ ] **Step 3: 最小实现**

`createSessionHistoryStore` 支持：

```ts
type CreateSessionHistoryStoreOptions = {
  maxSessions?: number;
  maxTranscriptBytes?: number;
  transcriptStore?: SessionTranscriptStore;
};
```

cleanup 规则：

- 按 `exitedAt ?? startedAt` 从旧到新排序
- 删除最旧的非 `running` / `starting` session
- 同步删除 transcript 文件
- running/starting session 永不删除
- cleanup 失败不影响当前 save/append 成功路径

- [ ] **Step 4: 运行 GREEN**

Run: `npx vitest run tests/app/metadataStores.test.ts`

Expected: PASS。

## Task 4: SessionService Uses Transcript Tail

**Files:**
- Modify: `src/main/sessionService.ts`
- Test: `tests/app/sessionService.test.ts`
- Test: `tests/app/sessionServiceTerminal.test.ts`

- [ ] **Step 1: 写 RED 测试**

```ts
it('persists terminal output to transcript storage and reads the replay tail', async () => {
  const historyStore = createSessionHistoryStore(tempDir, { transcriptStore });
  const service = createSessionService({ ...fakeAdapters, historyStore });
  const session = await service.launch({ profile, workspace, command: 'claude' });

  fakePty.emitData(session.id, 'large terminal output');

  await flushPromises();
  const replay = await service.readTerminalBuffer({ sessionId: session.id });

  expect(replay).toContain('large terminal output');
  expect(JSON.stringify(await readJson(path.join(tempDir, 'sessions.json')))).not.toContain('large terminal output');
});
```

- [ ] **Step 2: 运行 RED**

Run: `npx vitest run tests/app/sessionService.test.ts tests/app/sessionServiceTerminal.test.ts`

Expected: FAIL，因为当前输出仍写入 JSON buffer。

- [ ] **Step 3: 最小实现**

修改 `SessionService`：

- `appendOutput` 委托 history store 写 transcript
- `readTerminalBuffer` 对 persisted session 读取 transcript tail
- 不再设置 `historyLimitReached` 触发 UI bar
- active session 仍保留 in-memory `terminalBuffers`，用于即时回放

- [ ] **Step 4: 运行 GREEN**

Run: `npx vitest run tests/app/sessionService.test.ts tests/app/sessionServiceTerminal.test.ts`

Expected: PASS。

## Task 5: Renderer Removes 5MB Storage Bar

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`
- Test: `tests/app/App.test.tsx`

- [ ] **Step 1: 写 RED 测试**

```ts
it('does not show the local 5MB replay storage warning or archive actions', async () => {
  installAgentDockApi({
    listSessions: vi.fn().mockResolvedValue([
      {
        ...agentSession,
        historyLimitReached: true,
      },
    ]),
  });

  render(<App />);

  await screen.findByLabelText('终端输出');
  expect(screen.queryByText('终端回放保存已达 5MB')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '存档历史' })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: 运行 RED**

Run: `npx vitest run tests/app/App.test.tsx`

Expected: FAIL，因为当前 Renderer 会显示 `SessionHistoryLimitBar`。

- [ ] **Step 3: 最小实现**

删除或停用：

- `SessionHistoryLimitBar`
- `historyArchiveMessage` UI
- `archiveSessionHistory` 按钮入口
- bottom 5MB warning CSS

保留：

- exited/interrupted recovery actions
- summary/context pressure actions
- `readTerminalBuffer` 复制输出能力

- [ ] **Step 4: 运行 GREEN**

Run: `npx vitest run tests/app/App.test.tsx`

Expected: PASS。

## Task 6: Context Pressure And Restore Material

**Files:**
- Modify: `src/main/contextBudgetEstimator.ts`
- Create: `src/main/contextRestore.ts`
- Modify: `src/main/sessionService.ts`
- Test: `tests/app/contextBudgetEstimator.test.ts`
- Test: `tests/app/contextRestore.test.ts`

- [ ] **Step 1: 写 RED 测试**

```ts
it('does not mark context full only because local replay history reached the old storage limit', () => {
  expect(estimateContextPressure({
    historyBufferBytes: 5_000_001,
    transcriptBytes: 0,
    sharedContextBytes: 0,
    recentOutputBytesPerMinute: 0,
    historyLimitReached: true,
  })).toEqual({ level: 'low', score: 0 });
});
```

```ts
it('builds a redacted restore prompt from summary and transcript tail', () => {
  const prompt = buildContextRestorePrompt({
    session,
    summaryMarkdown: '# AgentDock Session Summary\n\n## Current Goal\nContinue work',
    transcriptTail: 'OPENAI_API_KEY=sk-secret-value\nrecent command output',
  });

  expect(prompt).toContain('Continue work');
  expect(prompt).toContain('recent command output');
  expect(prompt).not.toContain('sk-secret-value');
});
```

- [ ] **Step 2: 运行 RED**

Run: `npx vitest run tests/app/contextBudgetEstimator.test.ts tests/app/contextRestore.test.ts`

Expected: FAIL，因为 `contextRestore` 尚不存在，estimator 仍可能被旧 replay limit 影响。

- [ ] **Step 3: 最小实现**

实现：

- `estimateContextPressure` 只根据 continuation material 相关字节估算
- `buildContextRestorePrompt` 组合 summary、metadata、redacted transcript tail
- 使用已有 sanitizer 或新增小型 redaction helper，确保 secret-like pattern 不进入 prompt

- [ ] **Step 4: 运行 GREEN**

Run: `npx vitest run tests/app/contextBudgetEstimator.test.ts tests/app/contextRestore.test.ts`

Expected: PASS。

## Task 7: 集成与安全验证

**Files:**
- Modify: `.agent-workflow/verification/<date>-session-transcript-storage-context-restore.md`
- Modify: `.agent-workflow/state.md`

- [ ] **Step 1: 聚焦测试**

Run:

```bash
npx vitest run tests/app/sessionTranscriptStore.test.ts tests/app/metadataStores.test.ts tests/app/sessionService.test.ts tests/app/sessionServiceTerminal.test.ts tests/app/contextBudgetEstimator.test.ts tests/app/contextRestore.test.ts tests/app/App.test.tsx
```

Expected: PASS。

- [ ] **Step 2: 全量验证**

Run:

```bash
npm run workflow:doctor
npm run test:workflow
npm test
npm run typecheck
npm run build
```

Expected: PASS；`npm run build` 允许现有 Vite chunk size warning。

- [ ] **Step 3: 安全扫描**

Run:

```bash
rg -n "sk-[A-Za-z0-9]|OPENAI_API_KEY=.*[A-Za-z0-9]{12}|ANTHROPIC_(AUTH_TOKEN|API_KEY)=.*[A-Za-z0-9]{12}" src tests docs/superpowers/plans docs/superpowers/specs
```

Expected: 无真实 key-like 命中；若命中文档中的示例，必须确认是脱敏示例。

- [ ] **Step 4: 真实验证记录**

记录以下真实验证结果：

- 超过旧 5 MB 输出后不再出现底部 warning。
- 重启后可恢复最近 terminal tail。
- `总结并续开` 或 resume/restart continuation 能向新 PTY 注入 restore prompt。
- transcript metadata、summary/handoff、renderer state、日志不包含完整 API Key。

## 自审结果

- SPEC 覆盖：计划覆盖存储迁移、tail 回放、UI 移除、cleanup、context pressure、restore prompt、安全和验证。
- 占位符扫描：未发现禁用占位词。
- 类型一致性：`AgentSession.transcript`、`SessionTranscriptStore`、`SessionHistoryStore` 在任务间保持同一命名。
