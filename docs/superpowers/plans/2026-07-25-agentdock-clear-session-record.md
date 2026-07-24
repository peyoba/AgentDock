# AgentDock 清晰会话记录与原始 PTY 分流实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 AgentDock 增加按 Session 独立持久化的可信结构化清晰记录，并把原始 PTY 限定为按需、脱敏、只读的高级诊断视图。

**Architecture:** 主进程通过 Claude/Codex/Grok 原生记录适配器读取结构化事件，`SessionRecordSyncService` 负责游标、去重、状态、重试与最终同步，`SessionRecordEventStore` 使用私有 JSONL + index 持久化。Renderer 只通过独立 IPC 接收脱敏 DTO；运行中 Session 默认显示 xterm 交互终端，非运行 Session 默认显示只读清晰记录，恢复正文只参与后台恢复材料。

**Tech Stack:** Electron + React + TypeScript + xterm.js + node-pty + Vitest + npm；不新增第三方依赖。

**Spec:** `docs/superpowers/specs/2026-07-24-agentdock-clear-session-record-design.zh-CN.md`

---

## 风险、门禁与执行角色

本任务为 **L3**：读取并持久化用户私有会话内容，影响 PTY 生命周期、恢复、并发 Session、Profile/Home 路径和 Secret 脱敏。

执行前后必须遵守以下门禁：

- 用户确认本计划和任务清单后才进入 `dispatch_hook`。
- 每个实现任务先使用 `superpowers:test-driven-development` 完成合理 RED，再写最小实现。
- 当前工作区已有用户改动，特别是 `src/main/main.ts`、`src/main/sessionService.ts`、`src/renderer/App.tsx`；禁止 reset、checkout、覆盖或整文件重写。
- 已有 dirty 文件不得直接整文件 stage。只能审阅并暂存本任务新增 hunk；无法可靠分离时保留未提交并在 handoff 说明。
- 不改 `package.json`、`package-lock.json`、`.env`、运行时版本、打包配置，不引入依赖。
- 完成前使用 `superpowers:verification-before-completion`，并执行 L3 真实验证。

执行角色：

- ①测试工程师：按 SPEC 与本计划写合理 RED，覆盖正常、边界、异常、空值、权限、安全、并发和外部格式损坏。
- ②开发工程师：只写让当前 RED 通过的最小实现，不弱化测试。
- ③验收工程师：逐条核对 SPEC 第 18 节的验收标准。
- ④质量工程师：检查文件职责、类型一致性、重复解析、竞态和单文件体积。
- ⑤安全工程师：检查路径逃逸、符号链接、Secret、恢复正文、IPC、导出和诊断。
- ⑩风险审查官：检查原生格式变化、旧 Session、并发绑定、最终同步、Windows `PARTIAL`。
- ⑥性能工程师：检查大 JSONL、去重索引、全量重写、主线程阻塞和同步风暴。
- ⑦文档工程师：更新中文需求/决策/验证与交付报告。
- ⑧集成工程师：全量自动化、真实 node-pty/CLI/权限/Secret 验证。
- ⑨部署工程师：只有用户要求生成安装包或发布候选时启用；否则 `SKIPPED` 并说明。

## 文件结构

### 新增

- `src/shared/sessionRecordFormatting.ts`：清晰事件固定标签、纯文本和 Markdown 格式化；只接收已脱敏 DTO。
- `src/main/recordSources/types.ts`：主进程内部的适配器、能力、游标和批次合同。
- `src/main/recordSources/pathValidation.ts`：Profile/Home 根目录解析、包含关系、realpath 和符号链接校验。
- `src/main/recordSources/jsonlReader.ts`：UTF-8 安全的分片 JSONL 读取与字节游标。
- `src/main/recordSources/claudeRecordSource.ts`：Claude 原生记录能力探测与严格事件映射。
- `src/main/recordSources/codexRecordSource.ts`：Codex 原生 rollout/session JSONL 能力探测与严格事件映射。
- `src/main/recordSources/grokRecordSource.ts`：Grok 独立 `GROK_HOME` 原生记录能力探测与严格事件映射。
- `src/main/stores/sessionRecordEventStore.ts`：私有 JSONL、index、去重、上限、损坏恢复和删除。
- `src/main/sessionRecordSyncService.ts`：绑定、增量同步、状态、退避、最终 flush、恢复材料和格式化入口。
- `src/renderer/components/SessionRecordView.tsx`：清晰记录只读时间线和操作。
- `src/renderer/components/SessionDiagnosticsView.tsx`：按需加载的脱敏 PTY 诊断视图。
- `tests/app/sessionRecordFormatting.test.ts`
- `tests/app/sessionRecordEventStore.test.ts`
- `tests/app/recordSourceInfrastructure.test.ts`
- `tests/app/claudeRecordSource.test.ts`
- `tests/app/codexRecordSource.test.ts`
- `tests/app/grokRecordSource.test.ts`
- `tests/app/sessionRecordSyncService.test.ts`
- `tests/app/sessionServiceRecordSync.test.ts`
- `tests/app/sessionRecordIpc.test.ts`
- `tests/app/SessionRecordView.test.tsx`
- `tests/app/SessionDiagnosticsView.test.tsx`
- `tests/fixtures/session-records/claude/session-basic.jsonl`、`claude/session-malformed.jsonl`、`codex/session-basic.jsonl`、`codex/session-ambiguous.jsonl`、`grok/session-basic.jsonl`、`grok/session-unsupported.jsonl`：只含合成数据和假 Secret。
- `.agent-workflow/verification/2026-07-25-agentdock-clear-session-record.md`：L3 真实验证记录。
- `.agent-workflow/delivery/2026-07-25-agentdock-clear-session-record-delivery-report.md`：最终交付报告。

### 修改

- `src/shared/agentdockTypes.ts`：事件 DTO、同步状态、请求/结果合同。
- `src/shared/preloadTypes.ts`：五个最小记录/诊断 API。
- `src/main/sessionService.ts`：只接生命周期触发和恢复材料，不解析 CLI 日志。
- `src/main/restoreContextStore.ts`：可信清晰记录优先于 transcript fallback。
- `src/main/main.ts`：全局 store/sync service、Session 校验、IPC、clipboard 和导出对话框。
- `src/preload/preload.cts`：白名单和最小 payload。
- `src/renderer/App.tsx`：每 Session 视图模式、默认切换、操作状态和固定恢复文案。
- `src/renderer/styles.css`：清晰记录/诊断视图样式。
- `tests/app/restoreContextStore.test.ts`、`sessionService.test.ts`、`preloadTypes.test.ts`、`preloadLaunchPayload.test.ts`、`App.test.tsx`、`sessionSecurity.test.ts`：现有回归合同。
- `docs/PROJECT_REQUIREMENTS.md`、`DECISIONS.md`、`PROJECT_PROFILE.md`：实现完成后的产品、决策和真实验证边界。

### 明确不改

- 不把事件正文写入 `sessions.json`、`session-transcripts`、Workspace 项目文件或前端持久化状态。
- 不从 PTY 文本猜测 `user_message` / `assistant_message` / 工具角色。
- 不记录原始请求/响应 payload、完整环境变量、恢复正文、原生日志路径、私有游标或错误堆栈到 Renderer。
- 不提供原始 PTY 导出。
- 不把三种 CLI 原生日志解析塞进 `SessionService`。

## 测试夹具和 seam 约定

为避免各任务重新发明测试接口，所有新增测试统一使用以下约定：

- 文件系统测试在 `beforeEach` 中用 `mkdtemp(path.join(os.tmpdir(), 'agentdock-record-test-'))` 创建 `tempDir`，在 `afterEach` 中用 `rm(tempDir, { recursive: true, force: true })` 清理；不读真实用户记录。
- `nativeUserEvent(overrides?: Partial<Extract<SessionRecordEventDto, { kind: 'user_message' }>>): Extract<SessionRecordEventDto, { kind: 'user_message' }>` 返回正文为“合成用户消息”的 native 事件。
- `validBatch(overrides?: Partial<SessionRecordAppendBatch>): SessionRecordAppendBatch` 返回 sessionId `session-1`、source `claude`、runId `run-1`、事件 `nativeUserEvent({ eventId: 'native-1' })`。
- `posixMode(filePath: string): Promise<number>` 在 Windows 返回 0，在 macOS/Linux 返回 `stat(filePath).mode & 0o777`。
- `fakeClock` 实现 `{ now(): Date; advance(ms: number): void }`；所有退避测试通过 fake scheduler/clock 推进，不使用真实 sleep。
- `fakeCodexAdapter(batches: RecordSourceBatch[])` 和 `failingAdapter()` 都实现 `RecordSourceAdapter`，并暴露 Vitest spy `readIncremental`。
- `binding` 固定为测试 Profile/Home/Workspace 的最小 `RecordSourceBinding`，路径全部位于 `tempDir`。
- PTY 生命周期测试使用现有 fake `PtyAdapter` 和 `runtime.emitData/emitExit` seam；不把真实用户 API Key 放进 fixture。
- Renderer 测试用 `tests/app/App.test.tsx` 已有的 `window.agentDock` mock 扩展五个记录 API，所有未涉及记录的 API 保持原有 mock。

---

## Batch 0：基线与任务派发准备

- [ ] **Step 0.1：记录工作区基线并保护用户改动**

Run:

```bash
git status --short --branch
git diff --check
git diff --stat
```

Expected:

- 能看到当前分支和用户已有 dirty 文件。
- `git diff --check` 为 PASS。
- 不执行 reset、checkout、clean 或自动格式化。

- [ ] **Step 0.2：运行批准计划前的基线闸门**

Run:

```bash
npm run workflow:doctor
npm run test:workflow
npx vitest run tests/app/sessionTranscriptStore.test.ts tests/app/sessionServiceTerminal.test.ts tests/app/restoreContextStore.test.ts tests/app/preloadTypes.test.ts tests/app/App.test.tsx
npm run typecheck
npm run build
```

Expected: 全部 PASS；build 允许保留当前已知的 Vite chunk size warning。若 dirty 基线已有失败，停止派发并记录失败命令、测试名和与本功能无关的证据。

- [ ] **Step 0.3：按角色创建任务卡**

为 Task 1—9 分别使用 `.agent-workflow/templates/task-card.md` 创建任务卡；每张卡必须列出精确文件、禁止覆盖 dirty hunk、必加载 skill 和完成命令。更新 `.agent-workflow/state.md` 到 `dispatch_hook` 后再派发。

---

## Task 1：共享事件合同与格式化器（L2）

**Files:**

- Create: `src/shared/sessionRecordFormatting.ts`
- Create: `tests/app/sessionRecordFormatting.test.ts`
- Modify: `src/shared/agentdockTypes.ts`

- [ ] **Step 1.1：写失败测试——固定事件、状态和格式化合同**

```ts
import { describe, expect, it } from 'vitest';
import {
  formatSessionRecordMarkdown,
  formatSessionRecordPlainText,
  sessionRecordSyncStatusLabel,
} from '../../src/shared/sessionRecordFormatting';
import type { SessionRecordSnapshot } from '../../src/shared/agentdockTypes';

const snapshot: SessionRecordSnapshot = {
  sessionId: 'session-1',
  status: 'ready',
  source: 'codex',
  eventCount: 4,
  truncated: false,
  hasMore: false,
  lastSyncedAt: '2026-07-25T08:00:00.000Z',
  events: [
    {
      eventId: 'user-1',
      sessionId: 'session-1',
      runId: 'run-1',
      sequence: 1,
      occurredAt: '2026-07-25T07:59:00.000Z',
      timeSource: 'native',
      kind: 'user_message',
      source: 'codex',
      trust: 'native',
      payload: { text: '检查构建' },
      truncated: false,
    },
    {
      eventId: 'tool-1',
      sessionId: 'session-1',
      runId: 'run-1',
      sequence: 2,
      occurredAt: '2026-07-25T07:59:10.000Z',
      timeSource: 'native',
      kind: 'tool_call',
      source: 'codex',
      trust: 'native',
      payload: { toolName: 'exec_command', argumentsSummary: 'npm run build' },
      truncated: false,
    },
    {
      eventId: 'result-1',
      sessionId: 'session-1',
      runId: 'run-1',
      sequence: 3,
      occurredAt: '2026-07-25T07:59:20.000Z',
      timeSource: 'native',
      kind: 'tool_result',
      source: 'codex',
      trust: 'native',
      payload: { outcome: 'success', text: 'build passed' },
      truncated: false,
    },
    {
      eventId: 'assistant-1',
      sessionId: 'session-1',
      runId: 'run-1',
      sequence: 4,
      occurredAt: '2026-07-25T08:00:00.000Z',
      timeSource: 'native',
      kind: 'assistant_message',
      source: 'codex',
      trust: 'native',
      payload: { text: '构建已通过' },
      truncated: false,
    },
  ],
};

describe('session record formatting', () => {
  it('formats only clear record DTO fields', () => {
    expect(formatSessionRecordPlainText(snapshot)).toContain('用户：检查构建');
    expect(formatSessionRecordPlainText(snapshot)).toContain('工具调用：exec_command · npm run build');
    expect(formatSessionRecordPlainText(snapshot)).not.toContain('filePath');
    expect(formatSessionRecordMarkdown(snapshot)).toContain('## 用户');
    expect(formatSessionRecordMarkdown(snapshot)).toContain('**状态：** 已就绪');
  });

  it('maps every synchronization state to fixed Chinese text', () => {
    expect(sessionRecordSyncStatusLabel('pending')).toBe('待同步');
    expect(sessionRecordSyncStatusLabel('syncing')).toBe('正在同步');
    expect(sessionRecordSyncStatusLabel('ready')).toBe('已就绪');
    expect(sessionRecordSyncStatusLabel('partial')).toBe('部分可用');
    expect(sessionRecordSyncStatusLabel('stale')).toBe('可能滞后');
    expect(sessionRecordSyncStatusLabel('failed')).toBe('同步失败');
    expect(sessionRecordSyncStatusLabel('unavailable')).toBe('暂不可用');
  });
});
```

- [ ] **Step 1.2：运行确认 RED**

Run: `npx vitest run tests/app/sessionRecordFormatting.test.ts`

Expected: FAIL，原因是共享类型和格式化器尚不存在。

- [ ] **Step 1.3：增加精确共享类型**

在 `agentdockTypes.ts` 增加并仅增加以下公开合同：

```ts
export type SessionRecordEventKind =
  | 'user_message'
  | 'assistant_message'
  | 'tool_call'
  | 'tool_result'
  | 'status';

export type SessionRecordSource = 'claude' | 'codex' | 'grok' | 'agentdock';
export type SessionRecordTrust = 'native' | 'derived-status';
export type SessionRecordTimeSource = 'native' | 'read';
export type SessionRecordSyncStatus =
  | 'pending'
  | 'syncing'
  | 'ready'
  | 'partial'
  | 'stale'
  | 'failed'
  | 'unavailable';

type SessionRecordEventBase = {
  eventId: string;
  sessionId: string;
  runId: string;
  sequence?: number;
  occurredAt: string;
  timeSource: SessionRecordTimeSource;
  source: SessionRecordSource;
  trust: SessionRecordTrust;
  truncated: boolean;
};

export type SessionRecordEventDto =
  | (SessionRecordEventBase & {
      kind: 'user_message' | 'assistant_message';
      trust: 'native';
      payload: { text: string };
    })
  | (SessionRecordEventBase & {
      kind: 'tool_call';
      trust: 'native';
      payload: { toolName: string; argumentsSummary?: string };
    })
  | (SessionRecordEventBase & {
      kind: 'tool_result';
      trust: 'native';
      payload: { outcome: 'success' | 'failure' | 'partial'; text?: string };
    })
  | (SessionRecordEventBase & {
      kind: 'status';
      source: 'agentdock';
      trust: 'derived-status';
      payload: { code: 'started' | 'restored' | 'completed' | 'failed' | 'waiting'; text?: string };
    });

export type SessionRecordSnapshot = {
  sessionId: string;
  status: SessionRecordSyncStatus;
  source?: Exclude<SessionRecordSource, 'agentdock'>;
  events: SessionRecordEventDto[];
  eventCount: number;
  lastSyncedAt?: string;
  message?: string;
  truncated: boolean;
  hasMore: boolean;
};

export type SessionRecordListRequest = {
  sessionId: string;
  beforeEventId?: string;
  limit?: number;
};
export type SessionRecordRequest = { sessionId: string };
export type SessionRecordActionResult = {
  status: 'completed' | 'canceled' | 'unavailable';
  eventCount: number;
  stale: boolean;
  fileName?: string;
};
export type SessionDiagnosticsResult = {
  sessionId: string;
  text: string;
  truncated: boolean;
  label: '原始 PTY（诊断，不是正式记录）';
};
```

不要在这些类型中加入文件路径、游标、原始 payload、错误堆栈或 env。

- [ ] **Step 1.4：实现纯格式化器**

`sessionRecordFormatting.ts` 必须：

- 按 `occurredAt -> sequence -> 输入顺序` 稳定排序。
- 对五种事件使用固定中文标签。
- 只读取联合类型允许的字段。
- Markdown 标题中不拼接路径或恢复正文。
- `partial/stale/failed/unavailable` 均写入输出头部，复制/导出不会伪装为最新。

- [ ] **Step 1.5：运行确认 GREEN**

Run:

```bash
npx vitest run tests/app/sessionRecordFormatting.test.ts
npm run typecheck
```

Expected: PASS。

- [ ] **Step 1.6：提交独立合同**

只 stage Task 1 文件，检查 `git diff --cached` 不含用户既有修改后提交：

```bash
git commit -m "feat(records): define clear session event contracts"
```

---

## Task 2：私有 JSONL 事件存储（L3）

**Files:**

- Create: `src/main/recordSources/types.ts`（先定义 store 与后续 adapter 共用的私有 binding）
- Create: `src/main/stores/sessionRecordEventStore.ts`
- Create: `tests/app/sessionRecordEventStore.test.ts`

- [ ] **Step 2.1：写失败测试——路径、权限、去重、上限和损坏恢复**

测试至少包含：

```ts
it('stores one private JSONL stream per safe session id and deduplicates event ids', async () => {
  const store = createSessionRecordEventStore(tempDir);
  const event = nativeUserEvent({ eventId: 'native-1', sessionId: 'session-1' });

  await store.appendBatch({
    sessionId: 'session-1',
    source: 'claude',
    runId: 'run-1',
    cursor: 'cursor-1',
    status: 'ready',
    events: [event, event],
    syncedAt: '2026-07-25T08:00:00.000Z',
  });

  const snapshot = await store.readSnapshot('session-1');
  expect(snapshot.events).toHaveLength(1);
  expect(snapshot.index.cursor).toBe('cursor-1');
  expect(await posixMode(path.join(tempDir, 'session-records'))).toBe(0o700);
  expect(await posixMode(path.join(tempDir, 'session-records/session-1/events.jsonl'))).toBe(0o600);
});

it('rejects unsafe ids without writing outside session-records', async () => {
  const store = createSessionRecordEventStore(tempDir);
  await expect(store.readSnapshot('../escape')).rejects.toThrow('会话 ID');
  await expect(readFile(path.join(tempDir, 'escape'), 'utf-8')).rejects.toThrow();
});

it('keeps the last consistent snapshot when a batch contains an invalid event', async () => {
  const store = createSessionRecordEventStore(tempDir);
  await store.appendBatch(validBatch());
  await expect(store.appendBatch({
    ...validBatch(),
    events: [{ ...nativeUserEvent(), trust: 'derived-status' }],
  })).rejects.toThrow('角色事件必须来自原生记录');
  await expect(store.readSnapshot('session-1')).resolves.toMatchObject({
    events: [expect.objectContaining({ eventId: 'native-1' })],
  });
});
```

再覆盖：

- 单事件 UTF-8 最大 128 KiB，超出时按字段截断并设 `truncated: true`。
- 单 Session 最大 64 MiB / 50,000 事件，保留最新完整事件并标记 snapshot `truncated`。
- index 损坏时从有效 JSONL 重建去重集合，状态为 `stale`。
- JSONL 中间行损坏时只返回损坏前的完整事件，状态为 `failed`，不把后续未验证文本解析成事件。
- `deleteSession` 只删除测试 Session 对应的 `session-records/session-1` 目录；测试先把真实目录名保存到 `recordDirectory` 变量，再断言 transcript、summary 和 workspace 不变。

- [ ] **Step 2.2：运行确认 RED**

Run: `npx vitest run tests/app/sessionRecordEventStore.test.ts`

Expected: FAIL，原因是 store 尚不存在。

- [ ] **Step 2.3：实现 store 合同和常量**

先在 `recordSources/types.ts` 定义私有 binding：

```ts
export type RecordSourceBinding = {
  sessionId: string;
  runId: string;
  source: 'claude' | 'codex' | 'grok';
  nativeSessionId?: string;
  workspacePath: string;
  recordHome: string;
  startedAt: string;
};
```

再由 `sessionRecordEventStore.ts` 导出：

```ts
export const SESSION_RECORD_EVENT_MAX_BYTES = 128 * 1024;
export const SESSION_RECORD_FILE_MAX_BYTES = 64 * 1024 * 1024;
export const SESSION_RECORD_MAX_EVENTS = 50_000;

export type SessionRecordIndex = {
  schemaVersion: 1;
  source?: 'claude' | 'codex' | 'grok';
  binding?: RecordSourceBinding;
  cursor?: string;
  seenEventKeys: string[];
  status: SessionRecordSyncStatus;
  lastSyncedAt?: string;
  message?: string;
  truncated: boolean;
};

export type SessionRecordEventStore = {
  appendBatch(input: SessionRecordAppendBatch): Promise<SessionRecordStoreSnapshot>;
  appendStatus(input: SessionRecordStatusAppend): Promise<SessionRecordStoreSnapshot>;
  readSnapshot(sessionId: string): Promise<SessionRecordStoreSnapshot>;
  updateSyncState(input: SessionRecordSyncStateUpdate): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
};

export type SessionRecordAppendBatch = {
  sessionId: string;
  source: 'claude' | 'codex' | 'grok';
  runId: string;
  cursor?: string;
  status: SessionRecordSyncStatus;
  events: SessionRecordEventDto[];
  syncedAt: string;
  message?: string;
};

export type SessionRecordStatusAppend = {
  sessionId: string;
  runId: string;
  event: Extract<SessionRecordEventDto, { kind: 'status' }>;
};

export type SessionRecordSyncStateUpdate = {
  sessionId: string;
  status: SessionRecordSyncStatus;
  binding?: RecordSourceBinding;
  cursor?: string;
  source?: 'claude' | 'codex' | 'grok';
  lastSyncedAt?: string;
  message?: string;
  truncated?: boolean;
};

export type SessionRecordStoreSnapshot = {
  events: SessionRecordEventDto[];
  index: SessionRecordIndex;
  byteSize: number;
};
```

实现规则：

1. 安全 Session ID 正则固定为 `/^[A-Za-z0-9][A-Za-z0-9._-]*$/`。
2. 每 Session 使用串行 Promise 队列。
3. 普通增量批次先完整校验和序列化，再使用 `appendPrivateFile` 追加完整 JSONL 行；随后原子写 `index.json`。崩溃留下的尾部半行在下次读取时隔离并标记 `stale`。
4. 只有达到事件/字节保留上限、修复损坏尾部或重建索引时，才使用 `writePrivateFileAtomically` 压缩替换 `events.jsonl`，避免每次同步重写 64 MiB 文件。
5. 去重键优先 `source + eventId`；eventId 由适配器保证稳定。
6. `user_message/assistant_message/tool_call/tool_result` 的 `trust` 必须是 `native`；`derived-status` 只允许 `status`。
7. store 内部错误可以记录相对 Session 标识，但不得把绝对路径或事件正文写进错误消息。
8. `binding` 只存在私有 `index.json`，用于 App 重启后继续同步；映射 `SessionRecordSnapshot` 时必须完全删除 `binding/cursor/绝对路径`。

- [ ] **Step 2.4：运行 GREEN 与回归**

Run:

```bash
npx vitest run tests/app/sessionRecordEventStore.test.ts tests/app/privateFileSystem.test.ts
npm run typecheck
```

Expected: PASS。

- [ ] **Step 2.5：提交 store**

```bash
git commit -m "feat(records): persist private session event streams"
```

---

## Task 3：适配器基础设施与路径安全（L3）

**Files:**

- Modify: `src/main/recordSources/types.ts`
- Create: `src/main/recordSources/pathValidation.ts`
- Create: `src/main/recordSources/jsonlReader.ts`
- Create: `tests/app/recordSourceInfrastructure.test.ts`

- [ ] **Step 3.1：写失败测试——受限根目录和字节游标**

```ts
it('accepts a regular record file inside an approved home and rejects symlinks or escapes', async () => {
  const approvedRoot = path.join(tempDir, 'codex-home');
  const recordFile = path.join(approvedRoot, 'sessions/2026/07/25/session.jsonl');
  await mkdir(path.dirname(recordFile), { recursive: true });
  await writeFile(recordFile, '{"type":"event"}\n', 'utf-8');

  await expect(resolveApprovedRecordFile({
    candidatePath: recordFile,
    approvedRoots: [approvedRoot],
  })).resolves.toBe(await realpath(recordFile));

  await expect(resolveApprovedRecordFile({
    candidatePath: path.join(tempDir, '../outside.jsonl'),
    approvedRoots: [approvedRoot],
  })).rejects.toThrow('允许的记录目录');
});

it('reads complete UTF-8 JSONL records and advances an opaque byte cursor', async () => {
  await writeFile(recordFile, '{"id":"1","text":"中文"}\n{"id":"2","text":"next"}\n', 'utf-8');
  const first = await readJsonlIncremental({ filePath: recordFile, maxBytes: 24 });
  expect(first.records).toEqual([{ id: '1', text: '中文' }]);
  const second = await readJsonlIncremental({
    filePath: recordFile,
    cursor: first.nextCursor,
    maxBytes: 1024,
  });
  expect(second.records).toEqual([{ id: '2', text: 'next' }]);
});
```

再覆盖：半行留到下批、单行超限隔离、malformed JSON 返回结构化 warning、不把原始行正文放进错误、文件缩短时游标安全重置并标记 `partial`。

- [ ] **Step 3.2：运行确认 RED**

Run: `npx vitest run tests/app/recordSourceInfrastructure.test.ts`

Expected: FAIL，原因是基础设施文件尚不存在。

- [ ] **Step 3.3：实现主进程内部合同**

`types.ts` 保留 Task 2 的 `RecordSourceBinding`，再增加以下精确边界：

```ts
export type RecordSourceStatus = 'ready' | 'partial' | 'unavailable' | 'failed';

export type RecordSourceCapability = {
  status: RecordSourceStatus;
  nativeSessionId?: string;
  reason?: string;
};

export type RecordSourceBatch = {
  status: RecordSourceStatus;
  events: Exclude<SessionRecordEventDto, { kind: 'status' }>[];
  nextCursor?: string;
  hasMore: boolean;
  warnings: string[];
};

export type RecordSourceAdapter = {
  source: 'claude' | 'codex' | 'grok';
  probe(binding: RecordSourceBinding): Promise<RecordSourceCapability>;
  readIncremental(
    binding: RecordSourceBinding,
    cursor: string | undefined,
  ): Promise<RecordSourceBatch>;
};
```

游标只在主进程私有 index 中保存，可以包含哈希、文件标识和 byte offset，但不得进入共享类型或 Renderer。

- [ ] **Step 3.4：实现路径校验和 JSONL reader**

路径校验顺序固定为：

1. `path.resolve` candidate 和 approved roots。
2. 验证 candidate 位于至少一个 approved root 内。
3. 对现有 root/candidate 执行 `realpath`，再次验证包含关系。
4. 对 candidate 的每一级执行 `lstat`，拒绝非系统别名的符号链接。
5. 只接受普通文件，最大单次读取 1 MiB。

JSONL reader 使用 `Buffer` 按 byte offset 读取；只释放完整换行记录，UTF-8 起始字节不完整时向后校正。warning 只包含行号、错误类别和来源类型。
目录发现使用 Node 标准库递归读取，深度最多 8 层、每次 probe 最多检查 5,000 个 JSONL 文件；不跟随符号链接，达到上限返回 `partial`，不引入 glob 依赖。

- [ ] **Step 3.5：运行 GREEN**

Run:

```bash
npx vitest run tests/app/recordSourceInfrastructure.test.ts tests/app/privateFileSystem.test.ts
npm run typecheck
```

Expected: PASS。

- [ ] **Step 3.6：提交基础设施**

```bash
git commit -m "feat(records): add safe native record readers"
```

---

## Task 4：Claude / Codex / Grok 原生记录适配器（L3）

**Files:**

- Create: `src/main/recordSources/claudeRecordSource.ts`
- Create: `src/main/recordSources/codexRecordSource.ts`
- Create: `src/main/recordSources/grokRecordSource.ts`
- Create: `tests/app/claudeRecordSource.test.ts`
- Create: `tests/app/codexRecordSource.test.ts`
- Create: `tests/app/grokRecordSource.test.ts`
- Create: `tests/fixtures/session-records/claude/session-basic.jsonl`
- Create: `tests/fixtures/session-records/claude/session-malformed.jsonl`
- Create: `tests/fixtures/session-records/codex/session-basic.jsonl`
- Create: `tests/fixtures/session-records/codex/session-ambiguous.jsonl`
- Create: `tests/fixtures/session-records/grok/session-basic.jsonl`
- Create: `tests/fixtures/session-records/grok/session-unsupported.jsonl`

- [ ] **Step 4.1：写 Claude RED**

合成 fixture 明确包含：`user`、`assistant`、`tool_use`、`tool_result`、进度事件、未知事件、malformed 行和假 Secret。

断言：

```ts
const batch = await adapter.readIncremental(binding, undefined);
expect(batch.events.map((event) => event.kind)).toEqual([
  'user_message',
  'assistant_message',
  'tool_call',
  'tool_result',
]);
expect(JSON.stringify(batch.events)).not.toContain('fixture-secret-value');
expect(JSON.stringify(batch.events)).not.toContain('Working');
expect(batch.status).toBe('partial');
```

- [ ] **Step 4.2：写 Codex RED**

fixture 覆盖 `session_meta/thread id`、用户输入、assistant 输出、`function_call`、`function_call_output`、乱序 sequence、重复 native id 和未知 `additional_tools` 事件。

断言适配器：

- 只从 `recordHome/sessions/**/*.jsonl` 搜索。
- 有明确 thread/session id 时按 id 绑定。
- 没有可证明绑定的文件时返回 `unavailable`，绝不选择“最新文件”冒充当前并发 Session。
- 未知事件使状态变 `partial`，但不会生成角色事件。

- [ ] **Step 4.3：写 Grok RED**

fixture 覆盖独立 `GROK_HOME` 下能证明 session id 的 JSONL 和没有稳定 schema 的目录。

断言：

- 能证明 id 和字段时映射原生事件。
- 只有 `--continue` 能力、没有稳定记录或 schema 不识别时返回 `partial/unavailable`。
- 不从文本提示符、TUI 行或 transcript 猜测用户/Agent。

- [ ] **Step 4.4：运行三组测试确认 RED**

Run:

```bash
npx vitest run tests/app/claudeRecordSource.test.ts tests/app/codexRecordSource.test.ts tests/app/grokRecordSource.test.ts
```

Expected: FAIL，原因是三个 adapter 尚不存在。

- [ ] **Step 4.5：实现严格映射**

共同规则：

1. Claude 根目录仅为真实用户 Home 下的 `.claude/projects`；优先文件名或记录内 native session id 精确匹配。
2. Codex 根目录仅为运行时实际 `CODEX_HOME` 下的 `sessions`；兼容模式必须使用本 Session 临时 home，并在该目录删除前最终同步。
3. Grok 根目录仅为运行时实际 `GROK_HOME`；只支持 fixture 和真实探针确认过的字段组合。
4. binding 已有 native session id 时只能精确匹配该 id；没有 id 时，候选必须同时匹配 workspace、startedAt 时间窗口和来源 metadata，且候选数恰好为 1。零个返回 `unavailable`，多个返回 `partial`，不得用“最新文件”决胜。
5. 文本字段先限长，再调用现有 `redactSecrets`；工具参数只保留稳定的有界摘要。
6. 缺 native event id 时，用 `source + native session id + sequence + 规范化 payload` 生成 SHA-256；不得用随机数。
7. 原生时间缺失时使用读取时间并设 `timeSource: 'read'`。
8. 未识别记录只增加 warning/`partial`，不生成事件。

- [ ] **Step 4.6：运行 GREEN 和安全扫描**

Run:

```bash
npx vitest run tests/app/recordSourceInfrastructure.test.ts tests/app/claudeRecordSource.test.ts tests/app/codexRecordSource.test.ts tests/app/grokRecordSource.test.ts tests/app/secretRedaction.test.ts
npm run typecheck
rg -n "fixture-secret-value" src
```

Expected: 测试和 typecheck PASS；最后一条 `rg` 无输出。

- [ ] **Step 4.7：提交适配器**

```bash
git commit -m "feat(records): read trusted CLI session events"
```

---

## Task 5：后台同步、游标、状态和恢复材料（L3）

**Files:**

- Create: `src/main/sessionRecordSyncService.ts`
- Create: `tests/app/sessionRecordSyncService.test.ts`

- [ ] **Step 5.1：写失败测试——去重、重启、退避、最终同步**

使用 fake adapter、fake clock 和内存 store seam，禁止真实 sleep。至少覆盖：

```ts
it('serializes concurrent sync requests and persists each native event once', async () => {
  const service = createSessionRecordSyncService({
    adapters: [fakeCodexAdapter([batchOne, batchOne])],
    store,
    clock,
    retryDelaysMs: [250, 1_000, 3_000],
  });
  await service.bind(binding);

  await Promise.all([
    service.syncNow('session-1', 'opened'),
    service.syncNow('session-1', 'manual'),
  ]);

  expect((await service.getSnapshot('session-1')).events).toHaveLength(1);
  expect(adapter.readIncremental).toHaveBeenCalledTimes(1);
});

it('keeps the previous cursor and marks stale after final sync failure', async () => {
  await store.appendBatch(validBatch({ cursor: 'cursor-good' }));
  const service = createSessionRecordSyncService({
    adapters: [failingAdapter()],
    store,
    clock,
    retryDelaysMs: [],
  });
  await service.bind(binding);
  await service.finalSync('session-1', 'exit');
  const snapshot = await service.getSnapshot('session-1');
  expect(snapshot.status).toBe('stale');
  expect((await store.readSnapshot('session-1')).index.cursor).toBe('cursor-good');
});
```

再覆盖：

- `schedule` 250ms 去抖，多次 PTY output 只触发一批。
- 当前状态为 `unavailable/partial` 时，后续 `opened/pty-output/manual` 同步会重新 probe；启动瞬间尚未生成文件不能永久锁死能力状态。
- `ready/partial/unavailable/failed` 到共享状态的固定映射。
- 适配器无可靠来源时只追加 AgentDock `status`，不生成角色事件。
- 新 runId 保留旧事件并继续去重。
- 创建新的 sync service 实例后，可以从私有 index 恢复 binding/cursor 并继续增量同步；旧 Session 没有 index binding 时明确 `unavailable`。
- `buildRestoreMaterial` 只返回 native 角色事件和 AgentDock 必要状态，限制 20,000 字符。
- `dispose` 等待在途 sync，不丢最后一致版本。

- [ ] **Step 5.2：运行确认 RED**

Run: `npx vitest run tests/app/sessionRecordSyncService.test.ts`

Expected: FAIL，原因是 service 尚不存在。

- [ ] **Step 5.3：实现服务公开合同**

```ts
export type SessionRecordSyncService = {
  bind(binding: RecordSourceBinding): Promise<void>;
  appendStatus(input: {
    sessionId: string;
    runId: string;
    code: 'started' | 'restored' | 'completed' | 'failed' | 'waiting';
    text?: string;
    occurredAt: string;
  }): Promise<void>;
  schedule(sessionId: string, reason: 'pty-output' | 'opened'): void;
  syncNow(
    sessionId: string,
    reason: 'launch' | 'opened' | 'manual' | 'retry',
  ): Promise<SessionRecordSnapshot>;
  finalSync(
    sessionId: string,
    reason: 'stop' | 'exit' | 'restart' | 'dispose',
  ): Promise<SessionRecordSnapshot>;
  getSnapshot(sessionId: string): Promise<SessionRecordSnapshot>;
  buildRestoreMaterial(sessionId: string): Promise<string | undefined>;
  deleteSession(sessionId: string): Promise<void>;
  dispose(): Promise<void>;
};
```

实现规则：

- 每 Session 一个 sync Promise；并发调用复用同一 Promise。
- `bind` 立即把完整 `RecordSourceBinding` 保存到私有 index；`syncNow` 内存无 binding 时从 store 恢复，绝不向 Renderer 返回。
- `schedule` 只排队，不 await，不阻塞 PTY。
- 失败退避固定为 250ms、1s、3s，最多三次；测试通过注入 scheduler 驱动。
- `finalSync` 有 5s 有界 deadline；超时保留旧 cursor，状态设 `stale`。
- 多 Session `dispose` 并发等待各自 final sync，最长受单个 5s deadline 限制，不按 Session 数串行累加。
- `deleteSession` 先取消该 Session 的 debounce/retry timer，等待在途 sync 结束，再删除 binding/index/events。
- 适配器 `failed` 映射 `failed`；已有事件且最终失败映射 `stale`。
- 事件排序由 store/formatter 完成，service 不改写原生时间。
- 任何 error message 先 `redactSecrets`，再限制 240 字符。

- [ ] **Step 5.4：运行 GREEN**

Run:

```bash
npx vitest run tests/app/sessionRecordEventStore.test.ts tests/app/sessionRecordSyncService.test.ts
npm run typecheck
```

Expected: PASS。

- [ ] **Step 5.5：提交同步服务**

```bash
git commit -m "feat(records): synchronize native session events"
```

---

## Task 6：SessionService 生命周期与恢复优先级（L3）

**Files:**

- Modify: `src/main/sessionService.ts`
- Modify: `src/main/restoreContextStore.ts`
- Create: `tests/app/sessionServiceRecordSync.test.ts`
- Modify: `tests/app/restoreContextStore.test.ts`
- Modify: `tests/app/sessionService.test.ts`

- [ ] **Step 6.1：写失败测试——生命周期触发且 PTY 不等待后台同步**

覆盖以下调用顺序：

```ts
expect(recordSync.bind).toHaveBeenCalledWith(expect.objectContaining({
  sessionId: session.id,
  source: 'codex',
  recordHome: '/tmp/agentdock-test-data/codex-profiles/profile-a',
}));
expect(recordSync.syncNow).toHaveBeenCalledWith(session.id, 'launch');

runtime.emitData(session.id, 'terminal redraw only');
expect(recordSync.schedule).toHaveBeenCalledWith(session.id, 'pty-output');
expect(recordSync.appendStatus).not.toHaveBeenCalledWith(
  expect.objectContaining({ code: 'user_message' }),
);
```

分别测试 `onExit`、`killTerminal`、`restart`、`deleteSessionRecord`、`dispose`：

- 最终同步发生在 Codex 临时 `CODEX_HOME` 删除前。
- `restart` 先 final sync，再创建新 runId 并重新 bind。
- `deleteSessionRecord` 删除 clear record store，但不删除 workspace。
- final sync 失败不阻止 PTY 退出/停止，Session 状态仍正确并标记记录可能滞后。
- PTY data 回调不 await adapter 或磁盘。

- [ ] **Step 6.2：写失败测试——恢复材料优先级**

`restoreContextStore` 新输入为：

```ts
type RestoreContextInput = {
  workspacePath: string;
  session: AgentSession;
  summaryMarkdown?: string;
  clearRecordText?: string;
  transcriptTail: string;
};
```

断言：

1. `clearRecordText` 非空时，恢复文件包含 `Trusted Session Record`，不包含 transcript fallback 正文。
2. 清晰记录为空时保留现有 summary + transcript tail fallback。
3. 恢复 instruction 仍是短读取指令，完整正文不进入 argv、Session command 或 memoryRestore summary。
4. `memoryRestore` 用户可见摘要固定为“记忆已恢复”“未找到可恢复记忆”“记忆恢复失败”之一。

- [ ] **Step 6.3：运行确认 RED**

Run:

```bash
npx vitest run tests/app/sessionServiceRecordSync.test.ts tests/app/restoreContextStore.test.ts tests/app/sessionService.test.ts
```

Expected: 新测试 FAIL，旧测试保持原有结果。

- [ ] **Step 6.4：最小接线**

在 `CreateSessionServiceOptions` 增加可选 `recordSync`，默认使用 no-op 实现以保持现有测试构造器兼容。

生命周期顺序固定为：

1. 解析运行时实际 `CODEX_HOME/GROK_HOME`。
   - Claude binding 使用 `path.join(homeDir, '.claude')`。
   - Codex binding 使用本次 PTY 实际 env 中的 `CODEX_HOME`。
   - Grok binding 使用本次 PTY 实际 env 中的 `GROK_HOME`。
2. 创建 runId：`sessionId + startedAt` 的稳定哈希。
3. `recordSync.bind`，追加 `started` 状态，并异步 `syncNow(..., 'launch')`。
4. PTY data 只调用 `recordSync.schedule`。
5. exit/stop/restart/dispose 先 `finalSync`，再清理临时 home/proxy。
6. 恢复时先 `buildRestoreMaterial`；只有 undefined 才读 transcript tail。
7. native resume 成功或 AgentDock prompt 注入成功后只追加 `restored` 短状态，不写恢复正文。

不得把 adapter import 到 `SessionService`；只能依赖 `SessionRecordSyncService` 接口。
`SessionService.dispose` 只对本窗口拥有的 Session 调用 `finalSync`，不得 dispose 全局共享 sync service；全局 service 由 Main 在所有窗口 service 完成 dispose 后关闭。

- [ ] **Step 6.5：运行 GREEN 与现有终端回归**

Run:

```bash
npx vitest run tests/app/sessionServiceRecordSync.test.ts tests/app/restoreContextStore.test.ts tests/app/sessionService.test.ts tests/app/sessionServiceTerminal.test.ts tests/app/sessionSecurity.test.ts
npm run typecheck
```

Expected: PASS。

- [ ] **Step 6.6：审阅 dirty hunk**

Run:

```bash
git diff -- src/main/sessionService.ts src/main/restoreContextStore.ts tests/app/sessionService.test.ts tests/app/restoreContextStore.test.ts tests/app/sessionServiceRecordSync.test.ts
git diff --check
```

Expected: 只包含清晰记录接线和必要测试；保留用户已有 Grok/恢复/终端改动。若无法分离 staged hunk，不自动 commit，在 handoff 标记。

---

## Task 7：Main / preload / IPC / 复制导出 / 高级诊断（L3）

**Files:**

- Modify: `src/shared/preloadTypes.ts`
- Modify: `src/preload/preload.cts`
- Modify: `src/main/main.ts`
- Create: `tests/app/sessionRecordIpc.test.ts`
- Modify: `tests/app/preloadTypes.test.ts`
- Modify: `tests/app/preloadLaunchPayload.test.ts`
- Modify: `tests/app/sessionSecurity.test.ts`

- [ ] **Step 7.1：写失败测试——API 白名单与最小 payload**

新增 API 方法：

```ts
listSessionRecord(request: SessionRecordListRequest): Promise<SessionRecordSnapshot>;
syncSessionRecord(request: SessionRecordRequest): Promise<SessionRecordSnapshot>;
copySessionRecordText(request: SessionRecordRequest): Promise<SessionRecordActionResult>;
exportSessionRecordMarkdown(request: SessionRecordRequest): Promise<SessionRecordActionResult>;
readSessionDiagnosticsPty(request: SessionRecordRequest): Promise<SessionDiagnosticsResult>;
```

preload 测试必须证明写操作只发送 `{ sessionId }`；list 只允许 `sessionId`、可选 `beforeEventId` 和限制在 1—500 的 `limit`，不能发送路径、cursor、env、payload 或 secret。

- [ ] **Step 7.2：写失败测试——Main 校验和脱敏**

测试静态/注入 seam，验证：

- 所有 handler 先通过当前 window 的 `SessionService.list()` 验证 Session 存在。
- `sessionRecords:list` 默认返回最新 200 条，单次最多 500 条；`eventCount` 是总数，`hasMore` 表示可继续按 `beforeEventId` 读取更早事件。
- Renderer 不能指定 source path 或导出目标路径。
- `copySessionRecordText` 在 main 使用 Electron `clipboard.writeText`，响应不返回完整文本。
- `exportSessionRecordMarkdown` 在 main 打开 `showSaveDialog`；取消时不写文件，成功只返回文件名，不返回私有源路径。
- 复制/导出发生在同步中或 stale 状态时使用最后一致版本，并在 `SessionRecordActionResult.stale` 返回 true。
- `readSessionDiagnosticsPty` 只在显式调用时读取 `readTerminalBuffer`，先 `readableSessionHistory + redactSecrets`，再截取最后 200,000 字符。
- 诊断结果固定 label，永远没有导出方法。
- 任何 handler 错误不包含事件正文、绝对原生路径、Secret 或恢复正文。

- [ ] **Step 7.3：运行确认 RED**

Run:

```bash
npx vitest run tests/app/sessionRecordIpc.test.ts tests/app/preloadTypes.test.ts tests/app/preloadLaunchPayload.test.ts tests/app/sessionSecurity.test.ts
```

Expected: FAIL，原因是 API 与 handler 未接入。

- [ ] **Step 7.4：实现全局服务和 IPC**

`main.ts` 只创建一个全局：

```ts
const sessionRecordEventStore = createSessionRecordEventStore(userDataPath);
const sessionRecordSyncService = createSessionRecordSyncService({
  store: sessionRecordEventStore,
  adapters: [
    createClaudeRecordSource(),
    createCodexRecordSource(),
    createGrokRecordSource(),
  ],
});
```

将同一 service 注入每个 window 的 `SessionService`，避免多窗口重复写 JSONL。
在现有 `before-quit` 流程中先 await `sessionRegistry.disposeAll()`，再 await `sessionRecordSyncService.dispose()`，最后 `app.quit()`；关闭单个窗口不得关闭全局 sync service。

增加 `requireSessionForRecords(event.sender, sessionId)`：

- 只接受符合 Session ID 正则的字符串。
- 必须在该窗口 service 可见的长期 Session 列表中。
- 运行权在另一窗口时仍可读取清晰记录/诊断，但不能通过这些 IPC 写 PTY 或抢占 owner。

IPC channel 精确为：

- `sessionRecords:list`
- `sessionRecords:sync`
- `sessionRecords:copyText`
- `sessionRecords:exportMarkdown`
- `sessionDiagnostics:readPty`

- [ ] **Step 7.5：运行 GREEN**

Run:

```bash
npx vitest run tests/app/sessionRecordIpc.test.ts tests/app/preloadTypes.test.ts tests/app/preloadLaunchPayload.test.ts tests/app/sessionSecurity.test.ts tests/app/mainSessionLaunchWiring.test.ts
npm run typecheck
npm run build
```

Expected: PASS；Renderer bundle 和 preload 不包含 Node fs 访问。

- [ ] **Step 7.6：审阅 Main dirty hunk**

Run:

```bash
git diff -- src/main/main.ts src/preload/preload.cts src/shared/preloadTypes.ts
git diff --check
```

Expected: 不覆盖用户已有 Profile sanitize / Grok /启动接线改动。

---

## Task 8：清晰记录、诊断视图与默认交互语义（L2）

**Files:**

- Create: `src/renderer/components/SessionRecordView.tsx`
- Create: `src/renderer/components/SessionDiagnosticsView.tsx`
- Create: `tests/app/SessionRecordView.test.tsx`
- Create: `tests/app/SessionDiagnosticsView.test.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`
- Modify: `tests/app/App.test.tsx`

- [ ] **Step 8.1：写组件 RED**

`SessionRecordView` 测试：

```tsx
render(
  <SessionRecordView
    session={stoppedSession}
    profileName="Codex A"
    workspaceName="AgentDock"
    snapshot={snapshot}
    loading={false}
    onEnterTerminal={vi.fn()}
    onSync={vi.fn()}
    onCopy={vi.fn()}
    onExport={vi.fn()}
    onOpenDiagnostics={vi.fn()}
  />,
);

expect(screen.getByRole('heading', { name: '清晰记录' })).toBeInTheDocument();
expect(screen.getByText('用户')).toBeInTheDocument();
expect(screen.getByText('检查构建')).toBeInTheDocument();
expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
expect(screen.getByRole('button', { name: '交互终端' })).toBeInTheDocument();
```

`SessionDiagnosticsView` 测试：

- 标题固定“原始 PTY（诊断，不是正式记录）”。
- 初次进入前不调用 API；点击高级诊断后才加载。
- 只读 `pre`，没有导出按钮、输入框或 resize 控件。
- 显示“内容已截断”状态。

- [ ] **Step 8.2：写 App RED——默认视图和恢复短状态**

覆盖：

1. running/starting Session 打开时默认 mount `TerminalPane`。
2. stopped/exited/interrupted/failed Session 打开时默认请求 `listSessionRecord` 并显示清晰记录，不 mount xterm。
3. 非运行 Session 点击“交互终端”触发现有 resume，然后成功后切到 terminal。
4. 清晰记录不可用时显示原因和高级诊断入口，不显示 transcript 冒充事件。
5. 运行中 Session 显式切换清晰记录后保持只读；返回终端才允许输入。
6. Session 变为 exited 时，当前视图默认切到 record。
7. memoryRestore.loaded/empty/failed 分别只显示固定一句；即使 `restore.summary` 含正文，DOM 也不得出现正文。
8. “复制输出”在非运行 Session 改为“复制清晰记录”；高级诊断没有复制/导出原始 PTY。

- [ ] **Step 8.3：运行确认 RED**

Run:

```bash
npx vitest run tests/app/SessionRecordView.test.tsx tests/app/SessionDiagnosticsView.test.tsx tests/app/App.test.tsx
```

Expected: 新合同 FAIL。

- [ ] **Step 8.4：实现每 Session 视图状态**

`App.tsx` 使用：

```ts
type SessionViewMode = 'terminal' | 'record' | 'diagnostics';

function defaultSessionViewMode(session: AgentSession | undefined): SessionViewMode {
  return session?.status === 'running' || session?.status === 'starting'
    ? 'terminal'
    : 'record';
}
```

状态按 Session ID 保存于当前 React 内存：

```ts
const [sessionViewModeById, setSessionViewModeById] = React.useState<
  Record<string, SessionViewMode>
>({});
const [recordSnapshotById, setRecordSnapshotById] = React.useState<
  Record<string, SessionRecordSnapshot>
>({});
```

不得写 localStorage。Session 切换时：

- 没有显式模式则使用默认。
- 打开 record 时调用 `listSessionRecord`；点击重试调用 `syncSessionRecord`。
- 时间线底部在 `hasMore` 时显示“加载更早记录”，使用当前最早 `eventId` 作为 `beforeEventId`，按稳定排序去重合并。
- 打开 diagnostics 时才调用 `readSessionDiagnosticsPty`。
- 切回 terminal 后才 mount `TerminalPane`。

`SessionMemoryRestoreBar` 不再读取并展示 summary 第一行，固定映射：

- loaded → `记忆已恢复`
- empty → `未找到可恢复记忆`
- failed → `记忆恢复失败`

- [ ] **Step 8.5：实现样式**

`styles.css` 增加：

- 时间线最大宽度、事件卡层级、长文本 `white-space: pre-wrap` 与 `overflow-wrap: anywhere`。
- 记录工具栏固定但不遮挡终端 header。
- diagnostics 使用等宽字体和高对比警示，但不模拟可输入终端。
- 760px 以下工具栏换行，清晰记录仍可滚动。
- 使用现有颜色变量和按钮样式，不引入 UI 库。

- [ ] **Step 8.6：运行 GREEN、可访问性和现有布局回归**

Run:

```bash
npx vitest run tests/app/SessionRecordView.test.tsx tests/app/SessionDiagnosticsView.test.tsx tests/app/App.test.tsx tests/app/TerminalPane.test.tsx tests/app/layoutPolish.test.ts
npm run typecheck
npm run build
```

Expected: PASS。

- [ ] **Step 8.7：审阅 Renderer dirty hunk**

Run:

```bash
git diff -- src/renderer/App.tsx src/renderer/styles.css
git diff --check
```

Expected: 保留用户已有 App/Grok/终端改动；无完整恢复正文、raw payload 或本地路径进入组件 state。

---

## Task 9：全量验证、真实 L3 验收、文档与交付（L3）

**Files:**

- Modify: `docs/PROJECT_REQUIREMENTS.md`
- Modify: `DECISIONS.md`
- Modify: `PROJECT_PROFILE.md`
- Create: `.agent-workflow/verification/2026-07-25-agentdock-clear-session-record.md`
- Create: `.agent-workflow/delivery/2026-07-25-agentdock-clear-session-record-delivery-report.md`
- Modify: `.agent-workflow/state.md`

- [ ] **Step 9.1：运行全部自动化闸门**

Run:

```bash
npm run workflow:doctor
npm run test:workflow
npm test
npm run typecheck
npm run build
git diff --check
```

Expected: 全部 PASS；只允许记录已知 Vite chunk warning，不允许未解释测试跳过。

- [ ] **Step 9.2：执行 macOS 三工具真实探针**

在用户本机已保存 Profile 范围内，各启动一个 Claude、Codex、Grok 会话，逐个验证：

1. 提交一条中文用户消息。
2. 触发至少一个真实工具调用和工具结果。
3. 清晰记录只出现可信事件，无 TUI spinner/重绘。
4. 停止 Session 后自动进入清晰记录。
5. 重启 App 后事件仍可读且不重复。
6. 点击继续后恢复状态只有一句。

若任一 CLI 无稳定原生来源，记录实际 `partial/unavailable` 和探针证据，不改用 PTY 猜测。

- [ ] **Step 9.3：执行并发、PTY 和最终同步验证**

真实启动两个 Session，验证：

- 两个事件文件和 runId 隔离。
- 停止一个不影响另一个 PTY。
- 中文输入、粘贴、Ctrl+C、resize 正常。
- exit/stop/dispose 前最后事件已 flush；失败时 UI 标记可能滞后。
- Codex 兼容模式临时 home 删除前已完成最终同步。

- [ ] **Step 9.4：执行 Secret、恢复正文、权限和导出验证**

使用一次性 canary 作为临时 Profile 的 API Key（写入现有本机加密 Vault 后，验证结束立即删除该临时 Profile），不把真实 Key 写入报告：

```bash
export AGENTDOCK_RECORD_CANARY="agentdock-record-canary-20260725"
AGENTDOCK_USER_DATA="/Users/peyoba/Library/Application Support/agentdock"
AGENTDOCK_SESSION_ROOT="$AGENTDOCK_USER_DATA/session-records"
AGENTDOCK_SESSION_DIR="$(find "$AGENTDOCK_SESSION_ROOT" -mindepth 1 -maxdepth 1 -type d -print | head -n 1)"
test -n "$AGENTDOCK_SESSION_DIR"
```

Run the scan as a separate command:

```bash
rg -F "$AGENTDOCK_RECORD_CANARY" "$AGENTDOCK_SESSION_ROOT" "/tmp/agentdock-clear-record-validation.md" ".agentdock/context"
```

Expected: exit status 1 and no output. Then run the permission check:

```bash
stat -f "%Lp %N" "$AGENTDOCK_SESSION_ROOT" "$AGENTDOCK_SESSION_DIR/events.jsonl" "$AGENTDOCK_SESSION_DIR/index.json"
```

Expected: directory 700, events/index 600. The export validation uses the explicit user-selected file `/tmp/agentdock-clear-record-validation.md`.

- canary 在清晰记录、诊断、导出、错误、Renderer state 和恢复可见 UI 中均不存在。
- macOS 目录为 700，事件/index 为 600。
- 导出只含清晰记录，没有 raw PTY、原始路径或恢复正文。
- 进程 argv、Session command、普通 transcript 不含恢复正文。

验证后从 API 配置删除临时 Profile 和其 Vault 槽位，并取消当前 shell 的 canary；不修改 `.env`。

- [ ] **Step 9.5：记录 Windows 边界**

如果没有 Windows 10/11 x64 真机或 CI runner：

- 自动化与交叉构建结果如实记录。
- ConPTY、GUI、中文输入、真实三 CLI 和文件 ACL 结论保持 `PARTIAL`。
- 不写“Windows 已完成验收”。

- [ ] **Step 9.6：完成角色闸门**

按顺序收集 handoff：

`acceptance_hook -> quality_gate_hook -> security_gate_hook -> risk_gate_hook -> performance_gate_hook -> integration_hook`。

任一角色 `FAIL/BLOCKED` 时停止 delivery，不得用主 Agent 口头覆盖。

- [ ] **Step 9.7：更新中文文档和交付报告**

文档必须写明：

- 清晰记录与 PTY 的职责分流。
- 原生来源严格可信、无来源明确降级。
- IPC、Secret、导出和恢复正文边界。
- 实际支持的 Claude/Codex/Grok 格式与版本。
- Windows 未验证项。
- 所有命令、结果、产物路径和未验证项。

- [ ] **Step 9.8：最终提交与分支收尾**

先使用 `superpowers:verification-before-completion` 复核刚运行的命令输出。只有 staged diff 不含用户既有无关改动时才提交：

```bash
git commit -m "feat(records): add trusted clear session history"
```

实现完成且测试全绿后，再使用 `superpowers:finishing-a-development-branch` 提供 merge/PR/保留分支选项；不自动 push 或发布。

---

## 依赖顺序与批次检查点

| 批次 | 任务 | 前置 | 可验收产物 |
|------|------|------|------------|
| A | Task 1—3 | 用户批准计划 | 共享合同、私有 store、安全 reader |
| B | Task 4—5 | A 绿色 | 三适配器、同步/状态/恢复材料 |
| C | Task 6—7 | B 绿色 | Session 生命周期、IPC、复制/导出/诊断 |
| D | Task 8 | C 绿色 | 清晰记录 UI、默认视图、固定恢复状态 |
| E | Task 9 | A—D 全绿 | 全量自动化、真实 L3、文档和交付 |

每个批次结束必须：

1. 运行该批次列出的测试和 `npm run typecheck`。
2. 更新 `.agent-workflow/state.md`。
3. 审阅 `git diff --check` 和 dirty hunk。
4. 向用户报告修改文件、验证结果、未验证项和下一批次。

## 计划自审

- SPEC 覆盖：事件模型、三适配器、JSONL、游标、去重、同步状态、最终 flush、Session 生命周期、IPC、默认视图、复制/Markdown、诊断、恢复、安全、旧数据、并发、真实验证均有对应任务。
- 过度工程检查：不引入数据库、watcher 依赖、状态库、LLM 分类、Gateway、云同步或原始 PTY 导出。
- 类型一致性：全计划统一使用 `SessionRecordEventDto`、`SessionRecordSnapshot`、`SessionRecordSyncService`、`RecordSourceAdapter`、`SessionRecordEventStore`。
- 可信度检查：只有 adapter 能生成四种角色/工具事件；`SessionService` 只能生成 `derived-status`。
- 用户改动保护：所有重叠 dirty 文件都有独立 hunk 审阅步骤，禁止整文件覆盖和无审阅 stage。
