# AgentDock Codex NewAPI 完整工具能力实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 保持 `newapi + gpt-5.6-sol + /v1/responses`，通过单 Session 内部模型别名和 loopback `model` 单字段重写恢复 Codex 完整终端/文件工具，并修复运行模式不可见与恢复正文进入 argv 的问题。

**Architecture:** Codex 在 `newapi-tool-compatible` 模式下使用 Main 进程生成的未知内部模型别名，从而发送标准顶层 Responses tools；Main 进程 loopback 适配器只把请求中的别名改回真实模型，其他请求字段和 SSE 原样透传。SessionService 管理代理生命周期、真实 Key 隔离、模式持久化和别名显示替换；恢复正文改为 PTY 就绪后输入，不再进入 CLI argv。

**Tech Stack:** Electron Main + React + TypeScript + xterm.js + node-pty + Node.js `http`/`fetch` + Vitest；不新增生产或开发依赖。

---

## 0. 执行前约束

- 当前工作区非干净，且目标文件与上一阶段修改重叠；执行时不得 `reset --hard`、stash、clean 或覆盖用户改动。
- `.agent-workflow/` 已按项目决策保持本地，不纳入 Git commit。
- 当前全量测试基线为 `55 passed / 2 failed files`、`380 passed / 6 failed tests`；6 条失败全部是旧恢复断言，与本计划的 argv 安全修复直接重叠。
- 不先把旧断言改成接受完整恢复正文进入 argv；Task 1 直接把它们替换为新的安全 RED 合同。
- 开始执行前使用 `superpowers:using-git-worktrees` 评估隔离；由于未提交改动与目标文件重叠，默认在当前工作区执行，并先保存只读 diff 清单和 `/tmp` 备份补丁。

## 文件结构

### 新增文件

- `src/main/codexToolCompatibilityRequest.ts` — 内部模型别名生成、请求校验和仅重写 `model` 的纯函数。
- `src/main/codexToolCompatibilityProxy.ts` — loopback HTTP 生命周期、token 校验、真实 Key 替换和 SSE 透传。
- `src/main/initialPromptInjector.ts` — Claude/Codex TUI 就绪检测、一次性 PTY prompt 注入和超时/退出处理。
- `tests/app/codexToolCompatibilityProxy.test.ts` — 请求纯函数、代理安全、SSE、并发隔离测试。
- `tests/app/initialPromptInjector.test.ts` — 分块就绪信号、单次注入、超时和退出测试。

### 修改文件

- `src/shared/agentdockTypes.ts` — `CodexLaunchMode`、Profile/Session/IPC 字段。
- `src/main/stores/configMigration.ts` — Profile schema v6 迁移。
- `src/main/stores/profileStore.ts` — Codex 默认模式白名单持久化。
- `src/main/sessionService.ts` — 代理生命周期、运行时 Profile、模式恢复、别名显示替换、prompt injector 接线。
- `src/main/main.ts` — IPC 校验、Profile 正规化和代理工厂注入。
- `src/shared/preloadTypes.ts`、`src/preload/preload.cts` — 新字段类型保持白名单边界。
- `src/renderer/App.tsx` — 通用运行模式 state、launch/restart request 和 Profile 切换默认值。
- `src/renderer/components/CommandBar.tsx` — Claude/Codex/zsh 可见运行模式选择。
- `src/renderer/components/ApiConfigPanel.tsx` — Codex Profile 默认运行模式设置。
- `tests/app/configMigration.test.ts`、`metadataStores.test.ts`、`preloadTypes.test.ts` — 新字段持久化与 IPC 安全。
- `tests/app/sessionService.test.ts`、`sessionServiceTerminal.test.ts`、`sessionSecurity.test.ts` — 生命周期、输出替换、argv 和恢复 RED/GREEN。
- `tests/app/App.test.tsx`、`layoutPolish.test.ts` — 运行模式 UI 和请求合同。
- `README.md`、`PROJECT_PROFILE.md`、`docs/PROJECT_REQUIREMENTS.md`、`DECISIONS.md` — 用户说明、真实验证和长期决策。

---

### Task 1: ①测试工程师建立完整 RED 合同

**Files:**
- Create: `tests/app/codexToolCompatibilityProxy.test.ts`
- Create: `tests/app/initialPromptInjector.test.ts`
- Modify: `tests/app/configMigration.test.ts`
- Modify: `tests/app/metadataStores.test.ts`
- Modify: `tests/app/preloadTypes.test.ts`
- Modify: `tests/app/sessionService.test.ts`
- Modify: `tests/app/sessionServiceTerminal.test.ts`
- Modify: `tests/app/sessionSecurity.test.ts`
- Modify: `tests/app/App.test.tsx`
- Modify: `tests/app/layoutPolish.test.ts`
- Create: `.agent-workflow/task-cards/01-test-codex-newapi-full-tool-capability.md`
- Create: `.agent-workflow/handoffs/01-test-codex-newapi-full-tool-capability.md`

- [ ] **Step 1: 保存当前工作区证据，不改变 Git 状态**

Run:

```bash
git status --short --branch
git diff --stat
git diff --check
git diff --binary > /tmp/agentdock-before-codex-tool-capability.patch
```

Expected:

- 输出当前 dirty 文件；
- `git diff --check` 无错误；
- `/tmp` 补丁只用于意外恢复，不提交仓库。

- [ ] **Step 2: 为请求重写纯函数写失败测试**

```ts
import { describe, expect, it } from 'vitest';
import {
  createCodexInternalModelAlias,
  rewriteCodexCompatibilityRequest,
} from '../../src/main/codexToolCompatibilityRequest';

describe('rewriteCodexCompatibilityRequest', () => {
  it('changes only the internal model alias and preserves standard tools', () => {
    const internalModel = createCodexInternalModelAlias('session-a');
    const source = {
      model: internalModel,
      tool_choice: 'auto',
      store: false,
      stream: true,
      tools: [{ type: 'function', name: 'exec_command', parameters: { type: 'object' } }],
      input: [{ role: 'user', content: 'test-only' }],
    };

    expect(rewriteCodexCompatibilityRequest({
      bodyText: JSON.stringify(source),
      internalModel,
      upstreamModel: 'gpt-5.6-sol',
    })).toEqual({
      ...source,
      model: 'gpt-5.6-sol',
    });
  });
});
```

- [ ] **Step 3: 为代理安全和 SSE 写失败测试**

测试必须覆盖：

```ts
it('requires the per-session local bearer token');
it('accepts only POST /v1/responses');
it('does not forward a mismatched internal model');
it('replaces the local token with the upstream secret without logging either value');
it('streams SSE chunks before upstream completion');
it('keeps two sessions pinned to different ports, tokens and upstream models');
it('close resolves while a streaming request is open');
```

日志断言使用测试占位 secret，并验证 `JSON.stringify(logger.mock.calls)` 不包含该值或请求正文 marker。

- [ ] **Step 4: 把 6 条旧恢复断言替换为 argv 安全 RED 合同**

关键断言：

```ts
expect(restartSpawn?.command).toBe('codex');
expect(restartSpawn?.command).not.toContain('<agentdock-restored-memory>');
expect(runtime.writes).toEqual([]);

runtime.emitData('session-1', '╭─ >_ OpenAI Codex\n› ');

expect(runtime.writes).toEqual([
  { sessionId: 'session-1', input: `${expectedRestorePrompt}\r` },
]);
```

Claude 测试要求启动命令不含 `--append-system-prompt <restore-body>`，TUI 就绪后仅写入一次恢复正文。

- [ ] **Step 5: 为 prompt injector 写失败测试**

```ts
it('waits for a chunk-split Codex prompt before writing once');
it('waits for a Claude input prompt before writing once');
it('does not write when no initial prompt exists');
it('rejects when the PTY exits before readiness');
it('rejects on readiness timeout without writing the prompt');
```

使用 fake clock；禁止真实 sleep。

- [ ] **Step 6: 为类型、迁移和 UI 写失败测试**

```ts
expect(migrated.codexDefaultLaunchMode).toBeUndefined();
expect(saved.codexDefaultLaunchMode).toBe('newapi-tool-compatible');
expect(session.codexLaunchMode).toBe('newapi-tool-compatible');
```

Renderer 必须覆盖：

```ts
expect(screen.getByLabelText('Codex 运行模式')).toHaveValue('newapi-tool-compatible');
fireEvent.change(screen.getByLabelText('Codex 运行模式'), {
  target: { value: 'native-responses' },
});
expect(api.launchSession).toHaveBeenCalledWith(expect.objectContaining({
  command: expect.stringMatching(/^codex\b/),
  codexLaunchMode: 'native-responses',
}));
```

本地 Shell 选择必须发送 `command: 'zsh'` 且不发送 Codex/Claude mode。

- [ ] **Step 7: 运行 RED 集合并确认失败原因**

Run:

```bash
npx vitest run \
  tests/app/codexToolCompatibilityProxy.test.ts \
  tests/app/initialPromptInjector.test.ts \
  tests/app/configMigration.test.ts \
  tests/app/metadataStores.test.ts \
  tests/app/preloadTypes.test.ts \
  tests/app/sessionService.test.ts \
  tests/app/sessionServiceTerminal.test.ts \
  tests/app/sessionSecurity.test.ts \
  tests/app/App.test.tsx \
  tests/app/layoutPolish.test.ts
```

Expected: FAIL；失败只来自新模块/字段/行为尚未实现，不得来自语法错误、fixture 泄密或错误 import。

- [ ] **Step 8: 提交 RED 测试**

```bash
git add tests/app/codexToolCompatibilityProxy.test.ts \
  tests/app/initialPromptInjector.test.ts \
  tests/app/configMigration.test.ts \
  tests/app/metadataStores.test.ts \
  tests/app/preloadTypes.test.ts \
  tests/app/sessionService.test.ts \
  tests/app/sessionServiceTerminal.test.ts \
  tests/app/sessionSecurity.test.ts \
  tests/app/App.test.tsx \
  tests/app/layoutPolish.test.ts
git commit -m "test: define codex newapi tool compatibility contracts"
```

---

### Task 2: ②开发工程师实现共享类型与 Profile 迁移

**Files:**
- Modify: `src/shared/agentdockTypes.ts`
- Modify: `src/main/stores/configMigration.ts`
- Modify: `src/main/stores/profileStore.ts`
- Modify: `src/main/main.ts`
- Modify: `src/shared/preloadTypes.ts`
- Modify: `src/preload/preload.cts`
- Test: `tests/app/configMigration.test.ts`
- Test: `tests/app/metadataStores.test.ts`
- Test: `tests/app/preloadTypes.test.ts`

- [ ] **Step 1: 运行类型/迁移 RED 子集**

```bash
npx vitest run tests/app/configMigration.test.ts tests/app/metadataStores.test.ts tests/app/preloadTypes.test.ts
```

Expected: FAIL，缺少 `CodexLaunchMode` 和相关字段。

- [ ] **Step 2: 添加共享合同**

```ts
export type CodexLaunchMode = 'native-responses' | 'newapi-tool-compatible';

export type ApiProfile = {
  // existing fields
  codexDefaultLaunchMode?: CodexLaunchMode;
};

export type AgentSession = {
  // existing fields
  codexLaunchMode?: CodexLaunchMode;
};

export type LaunchRequest = {
  profileId: string;
  workspaceId: string;
  command: string;
  claudeLaunchMode?: ClaudeLaunchMode;
  codexLaunchMode?: CodexLaunchMode;
};
```

`RestartSessionRequest` 同样增加 `codexLaunchMode?: CodexLaunchMode`。

- [ ] **Step 3: 把 Profile schema 提升到 v6**

```ts
export type ConfigVersion = 1 | 2 | 3 | 4 | 5 | 6;
export const CURRENT_CONFIG_VERSION: ConfigVersion = 6;
```

v1-v5 迁移保持 `codexDefaultLaunchMode: undefined`；v6 只接受两个联合值，非法值丢弃。`profileStore` 只对白名单联合值持久化。

- [ ] **Step 4: Main IPC 只接受与 Profile 工具类型匹配的模式**

```ts
function validatedCodexLaunchMode(
  profile: ApiProfile,
  mode: CodexLaunchMode | undefined,
): CodexLaunchMode | undefined {
  if (profile.toolType !== 'codex') return undefined;
  if (mode === 'native-responses' || mode === 'newapi-tool-compatible') return mode;
  return profile.codexDefaultLaunchMode;
}
```

Claude request 必须删除 Codex mode；Codex request 必须删除 Claude mode；zsh 两者都删除。

- [ ] **Step 5: 运行子集并 typecheck**

```bash
npx vitest run tests/app/configMigration.test.ts tests/app/metadataStores.test.ts tests/app/preloadTypes.test.ts
npm run typecheck
```

Expected: PASS。

- [ ] **Step 6: 提交类型与迁移**

```bash
git add src/shared/agentdockTypes.ts src/main/stores/configMigration.ts \
  src/main/stores/profileStore.ts src/main/main.ts \
  src/shared/preloadTypes.ts src/preload/preload.cts \
  tests/app/configMigration.test.ts tests/app/metadataStores.test.ts tests/app/preloadTypes.test.ts
git commit -m "feat: persist codex launch compatibility mode"
```

---

### Task 3: ②开发工程师实现模型别名请求层与 loopback 代理

**Files:**
- Create: `src/main/codexToolCompatibilityRequest.ts`
- Create: `src/main/codexToolCompatibilityProxy.ts`
- Test: `tests/app/codexToolCompatibilityProxy.test.ts`

- [ ] **Step 1: 运行代理 RED 测试**

```bash
npx vitest run tests/app/codexToolCompatibilityProxy.test.ts
```

Expected: FAIL，模块不存在。

- [ ] **Step 2: 实现纯请求层**

```ts
export const CODEX_COMPATIBILITY_BODY_LIMIT_BYTES = 8 * 1024 * 1024;

export function createCodexInternalModelAlias(sessionId: string): string {
  return `agentdock-tool-runtime-${sessionId.replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

export function rewriteCodexCompatibilityRequest({
  bodyText,
  internalModel,
  upstreamModel,
}: {
  bodyText: string;
  internalModel: string;
  upstreamModel: string;
}): Record<string, unknown> {
  const parsed = JSON.parse(bodyText) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Codex compatibility request must be a JSON object');
  }
  const body = parsed as Record<string, unknown>;
  if (body.model !== internalModel) {
    throw new Error('Codex compatibility request model does not match this session');
  }
  return { ...body, model: upstreamModel };
}
```

错误不得包含 bodyText、internal token 或 upstream secret。

- [ ] **Step 3: 实现单 Session 代理合同**

```ts
export type CodexToolCompatibilityProxyInstance = {
  baseUrl: string;
  localApiKey: string;
  internalModel: string;
  close(): Promise<void>;
};

export type StartCodexToolCompatibilityProxyInput = {
  upstreamBaseUrl: string;
  upstreamApiKey: string;
  upstreamModel: string;
  profileId: string;
  sessionId: string;
  log?: (event: {
    profileId: string;
    sessionId: string;
    upstreamHost: string;
    path: string;
    statusCode: number;
    durationMs: number;
  }) => void;
};
```

服务器必须：

- `listen(0, '127.0.0.1')`；
- 使用 `crypto.randomBytes(32)` 生成本地 token；
- 只接受正确 bearer token 和 `POST /v1/responses`；
- 有界读取 body；
- 删除入站 `host/content-length/connection/authorization`；
- 设置真实 upstream Authorization；
- 用 `pipeline(Readable.fromWeb(upstream.body), response)` 流式返回；
- close 时 abort 在途 fetch、关闭连接并可重复调用。

- [ ] **Step 4: 运行代理测试和 typecheck**

```bash
npx vitest run tests/app/codexToolCompatibilityProxy.test.ts
npm run typecheck
```

Expected: PASS；SSE 首块在上游结束前可读取。

- [ ] **Step 5: 提交代理模块**

```bash
git add src/main/codexToolCompatibilityRequest.ts \
  src/main/codexToolCompatibilityProxy.ts \
  tests/app/codexToolCompatibilityProxy.test.ts
git commit -m "feat: add session scoped codex model rewrite proxy"
```

---

### Task 4: ②开发工程师接入 SessionService 生命周期

**Files:**
- Modify: `src/main/sessionService.ts`
- Modify: `src/main/main.ts`
- Test: `tests/app/sessionService.test.ts`
- Test: `tests/app/sessionServiceTerminal.test.ts`
- Test: `tests/app/sessionSecurity.test.ts`

- [ ] **Step 1: 运行 SessionService RED 子集**

```bash
npx vitest run tests/app/sessionService.test.ts tests/app/sessionServiceTerminal.test.ts tests/app/sessionSecurity.test.ts
```

Expected: FAIL，缺少代理工厂、生命周期和别名隔离。

- [ ] **Step 2: 为 SessionService 增加可注入代理工厂**

```ts
type CreateSessionServiceOptions = {
  // existing options
  startCodexToolCompatibilityProxy?: typeof startCodexToolCompatibilityProxy;
};
```

内部增加：

```ts
const codexCompatibilityProxies = new Map<string, CodexToolCompatibilityProxyInstance>();

async function closeCodexCompatibilityProxy(sessionId: string): Promise<void> {
  const proxy = codexCompatibilityProxies.get(sessionId);
  if (!proxy) return;
  codexCompatibilityProxies.delete(sessionId);
  await proxy.close().catch(() => undefined);
}
```

- [ ] **Step 3: 生成运行时 Profile/env/config**

兼容模式中：

```ts
const proxy = await startCodexToolCompatibilityProxy({
  upstreamBaseUrl: profile.baseUrl,
  upstreamApiKey: secret,
  upstreamModel: profile.defaultModel ?? 'gpt-5-codex',
  profileId: profile.id,
  sessionId: session.id,
});
codexCompatibilityProxies.set(session.id, proxy);

const runtimeProfile: ApiProfile = {
  ...profile,
  baseUrl: proxy.baseUrl,
  defaultModel: proxy.internalModel,
};
const runtimeSecret = proxy.localApiKey;
```

`buildLaunchEnvironment` 和 `buildCodexConfig` 使用 runtime Profile/secret；Session title、Profile metadata 和用户可见模型继续使用原始 Profile。

- [ ] **Step 4: 关闭所有生命周期出口**

在以下路径等待 `closeCodexCompatibilityProxy(sessionId)`：

- PTY spawn 失败；
- 正常 exit finalization；
- stop/kill；
- archive/delete；
- restart 前旧 runtime 清理；
- dispose/App quit。

禁止一个 Session 的 close 关闭其他 Session。

- [ ] **Step 5: 精确替换用户可见输出中的内部别名**

```ts
function displayTerminalData(
  data: string,
  proxy: CodexToolCompatibilityProxyInstance | undefined,
  realModel: string | undefined,
): string {
  if (!proxy || !realModel) return data;
  return data.split(proxy.internalModel).join(realModel);
}
```

替换后的数据同时进入 Renderer 和持久化 sanitizer。只替换当前 Session 精确内部别名。

- [ ] **Step 6: 保存和恢复本次 Codex mode**

`launch`、`restart(resume/fresh)` 和 continuation 都必须写入/保留 `session.codexLaunchMode`。本地 zsh 删除该字段。

- [ ] **Step 7: 运行 SessionService 测试**

```bash
npx vitest run tests/app/sessionService.test.ts tests/app/sessionServiceTerminal.test.ts tests/app/sessionSecurity.test.ts
npm run typecheck
```

Expected: 除 Task 6 的新 prompt injector RED 外，其余代理生命周期测试 PASS。

- [ ] **Step 8: 提交 SessionService 集成**

```bash
git add src/main/sessionService.ts src/main/main.ts \
  tests/app/sessionService.test.ts tests/app/sessionServiceTerminal.test.ts tests/app/sessionSecurity.test.ts
git commit -m "feat: run codex tool compatibility per session"
```

---

### Task 5: ②开发工程师恢复可见运行模式 UI

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/components/CommandBar.tsx`
- Modify: `src/renderer/components/ApiConfigPanel.tsx`
- Modify: `src/renderer/styles.css`
- Test: `tests/app/App.test.tsx`
- Test: `tests/app/layoutPolish.test.ts`
- Test: `tests/app/metadataStores.test.ts`

- [ ] **Step 1: 运行 Renderer RED 子集**

```bash
npx vitest run tests/app/App.test.tsx tests/app/layoutPolish.test.ts tests/app/metadataStores.test.ts
```

Expected: FAIL，Codex 运行模式选择不存在。

- [ ] **Step 2: 定义 Renderer 选择值**

```ts
type LaunchModeSelection =
  | ClaudeLaunchMode
  | CodexLaunchMode
  | 'local-shell';
```

Profile 变化时：

- Claude → `claudeLaunchMode` 或现有默认；
- Codex → `profile.codexDefaultLaunchMode ?? 'native-responses'`；
- zsh 只由用户显式选择。

- [ ] **Step 3: 把 CommandBar 改为可见 select**

Codex options：

```tsx
<option value="newapi-tool-compatible">完整工具 · NewAPI 兼容</option>
<option value="native-responses">原生 Codex · Responses</option>
<option value="local-shell">本地终端 · zsh</option>
```

Claude options：

```tsx
<option value="lite">轻量 Agent · 内置工具 / 空 MCP</option>
<option value="full">完整 Agent · 内置工具 + MCP</option>
<option value="local-shell">本地终端 · zsh</option>
```

移除独立 zsh 按钮，避免两个入口表达同一模式。

- [ ] **Step 4: 构造准确 launch/restart request**

```ts
if (launchMode === 'local-shell') {
  request.command = 'zsh';
} else if (profile.toolType === 'codex') {
  request.command = defaultCommandFor(profile);
  request.codexLaunchMode = launchMode as CodexLaunchMode;
} else {
  request.command = defaultCommandFor(profile);
  request.claudeLaunchMode = launchMode as ClaudeLaunchMode;
}
```

restart 默认使用 Session 保存的 mode，不使用当前顶部其他 Profile 的 mode。

- [ ] **Step 5: API Config 保存 Codex 默认模式**

仅 Codex 表单显示：

```tsx
<select aria-label="Codex 默认运行模式" value={draft.codexDefaultLaunchMode ?? 'native-responses'}>
```

切换工具类型离开 Codex 时删除该字段。

- [ ] **Step 6: 运行 Renderer 测试和 typecheck**

```bash
npx vitest run tests/app/App.test.tsx tests/app/layoutPolish.test.ts tests/app/metadataStores.test.ts
npm run typecheck
```

Expected: PASS；顶部紧凑布局不截断模式文字。

- [ ] **Step 7: 提交 UI**

```bash
git add src/renderer/App.tsx src/renderer/components/CommandBar.tsx \
  src/renderer/components/ApiConfigPanel.tsx src/renderer/styles.css \
  tests/app/App.test.tsx tests/app/layoutPolish.test.ts tests/app/metadataStores.test.ts
git commit -m "feat: restore explicit agent launch modes"
```

---

### Task 6: ②开发工程师修复恢复正文 argv 泄漏

**Files:**
- Create: `src/main/initialPromptInjector.ts`
- Modify: `src/main/sessionService.ts`
- Test: `tests/app/initialPromptInjector.test.ts`
- Test: `tests/app/sessionService.test.ts`
- Test: `tests/app/sessionSecurity.test.ts`

- [ ] **Step 1: 运行 prompt RED 子集**

```bash
npx vitest run tests/app/initialPromptInjector.test.ts tests/app/sessionService.test.ts tests/app/sessionSecurity.test.ts
```

Expected: FAIL；当前正文仍在 argv。

- [ ] **Step 2: 实现条件式就绪检测**

```ts
export type InitialPromptTool = 'claude' | 'codex';

export function createInitialPromptInjector({
  tool,
  prompt,
  write,
  timeoutMs = 15_000,
}: {
  tool: InitialPromptTool;
  prompt: string;
  write(input: string): void;
  timeoutMs?: number;
}): {
  acceptOutput(data: string): void;
  exit(): void;
  completion: Promise<void>;
  cancel(): void;
};
```

规则：

- 累积最多 32KB 启动输出；
- Codex 等待 `>_ OpenAI Codex` 后出现输入提示 `›`；
- Claude 等待 Claude 启动标识后出现主输入提示；
- 标识允许跨 chunk；
- 只执行一次 `write(`${prompt}\r`)`；
- timeout 只作为失败上限，不用于延时触发；
- exit/cancel 清理 timer 并拒绝/结束 promise。

- [ ] **Step 3: 移除 argv prompt 拼接**

删除恢复场景对以下函数的使用：

```ts
appendInitialPromptCommand
appendClaudeSystemPromptCommand
```

Agent 启动命令保持原始 CLI/原生 resume 命令。PTY spawn 后立即注册 output/exit handler，再创建 injector。

- [ ] **Step 4: 正确写入 memoryRestore 状态**

- injector 成功后：`memoryRestore.status = 'loaded'`；
- timeout/提前退出：`memoryRestore.status = 'failed'`，保存脱敏 error；
- CLI 会话本身已正常运行但恢复失败时，不把 PTY 状态伪造成 running+loaded；UI 显示恢复失败。

- [ ] **Step 5: 运行恢复安全测试**

```bash
npx vitest run tests/app/initialPromptInjector.test.ts tests/app/sessionService.test.ts tests/app/sessionSecurity.test.ts
npm run typecheck
```

Expected: PASS；此前 6 条旧失败被新安全合同替代，全量测试不再保留旧短 argv 期望。

- [ ] **Step 6: 提交 argv 修复**

```bash
git add src/main/initialPromptInjector.ts src/main/sessionService.ts \
  tests/app/initialPromptInjector.test.ts tests/app/sessionService.test.ts tests/app/sessionSecurity.test.ts
git commit -m "fix: inject restored memory after terminal readiness"
```

---

### Task 7: ③验收、④质量、⑤安全、⑩风险、⑥性能闸门

**Files:**
- Create: `.agent-workflow/reviews/03-acceptance-codex-newapi-full-tool-capability.md`
- Create: `.agent-workflow/reviews/04-quality-codex-newapi-full-tool-capability.md`
- Create: `.agent-workflow/reviews/05-security-codex-newapi-full-tool-capability.md`
- Create: `.agent-workflow/reviews/10-risk-codex-newapi-full-tool-capability.md`
- Create: `.agent-workflow/reviews/06-performance-codex-newapi-full-tool-capability.md`
- Modify only if a gate finds a concrete SPEC violation.

- [ ] **Step 1: ③验收逐条核对 SPEC 第 11 节**

重点拒绝：

- 只显示警告但工具仍不可用；
- mock-only 工具证明；
- 自动 fallback；
- 用户界面显示内部别名；
- resume/fresh 丢失 mode。

- [ ] **Step 2: ④质量检查职责和复杂度**

确认：

- 两个新模块各自职责单一；
- `sessionService.ts` 只做编排，不复制 HTTP 细节；
- 无空洞命名和 silent catch；
- 新文件默认不超过 200 行；超过时按请求纯函数/HTTP 生命周期拆分，不新建工厂体系。

- [ ] **Step 3: ⑤安全检查**

执行：

```bash
rg -n "Authorization|OPENAI_API_KEY|localApiKey|upstreamApiKey|agentdock-restored-memory" \
  src/main src/preload src/renderer tests/app
```

人工确认命中只在必要变量名、测试占位值和受控内存路径；日志、IPC、metadata、错误不得包含值。

- [ ] **Step 4: ⑩风险检查升级与回滚**

确认：

- Codex 升级后如果 `gpt-5.6-sol` 恢复标准顶层 tools，用户可以显式选择原生模式；
- 不自动探测或切换；
- 关闭兼容模式即可回滚到旧原生链路；
- NewAPI 不可用时只影响对应 Session。

- [ ] **Step 5: ⑥性能检查 SSE 和并发**

使用本地挂起 SSE upstream 验证：

- 首块实时到达；
- backpressure 不无限缓存；
- close 能中断 fetch；
- 2 个并发 Session 不串流；
- 10MB 流式测试不产生完整正文副本日志。

- [ ] **Step 6: 如有打回，单项修复并重跑对应聚焦测试**

每个角色最多打回 2 次；超过阈值按 workflow 进入 BLOCKED。

---

### Task 8: ⑦文档、⑧集成、⑨部署与真实交付验证

**Files:**
- Modify: `README.md`
- Modify: `PROJECT_PROFILE.md`
- Modify: `docs/PROJECT_REQUIREMENTS.md`
- Modify: `DECISIONS.md`
- Create: `.agent-workflow/verification/2026-07-12-codex-newapi-full-tool-capability.md`
- Create: `.agent-workflow/delivery/2026-07-12-codex-newapi-full-tool-capability-delivery-report.md`

- [ ] **Step 1: ⑦更新中文文档**

说明：

- Codex 三种运行模式；
- `完整工具 · NewAPI 兼容` 的适用范围；
- 不切换 NewAPI Codex 渠道；
- 不做自动 fallback；
- 真实 Key 不进入 Codex 子进程；
- 恢复正文不进入 argv。

- [ ] **Step 2: ⑧运行聚焦和全量自动验证**

```bash
npx vitest run tests/app/codexToolCompatibilityProxy.test.ts \
  tests/app/initialPromptInjector.test.ts \
  tests/app/sessionService.test.ts \
  tests/app/sessionServiceTerminal.test.ts \
  tests/app/sessionSecurity.test.ts \
  tests/app/App.test.tsx
npm test
npm run workflow:doctor
npm run test:workflow
npm run typecheck
npm run build
git diff --check
```

Expected: 全部 PASS；build 只允许已知 Vite chunk size 非阻塞 warning。

- [ ] **Step 3: ⑧执行真实 NewAPI/node-pty 工具闭环**

使用当前保存 Profile，在专用临时验证目录执行：

```text
pwd
uname -a
memory_pressure
读取指定测试文件
创建/读取/修改/删除临时测试文件
npm run typecheck
```

记录命令是否由 `exec_command` 真实调用、退出码和脱敏结果摘要，不复制完整响应或 Key。

- [ ] **Step 4: ⑧验证生命周期和隔离**

- 新建兼容模式 Session；
- stop → resume → `pwd`；
- fresh restart → `pwd`；
- 形成 interrupted → 恢复 → `pwd`；
- 第二个 Codex Profile/Session 并发；
- 关闭一个 Session 后另一个继续执行；
- 核对 CODEX_HOME、随机端口和本地 token 不复用。

- [ ] **Step 5: ⑤/⑧执行 argv 和 secret 真实检查**

```bash
ps -axo pid=,ppid=,command= | rg 'codex|claude'
```

只记录布尔结论：argv 不含恢复正文和真实 API Key。对 userData、workspace `.agentdock/context` 和本批日志做 secret-like scan，报告不得粘贴命中值。

- [ ] **Step 6: ⑨生成 dirty 验证包**

```bash
npm run package:mac
codesign --verify --deep --strict --verbose=2 \
  release/packages/<buildId>/AgentDock-darwin-arm64/AgentDock.app
```

记录实际 `<buildId>`、commit、dirty 状态和 build-info。当前工作区未清理前只允许标记为 dirty 验证包，不宣称 clean 发布候选。

- [ ] **Step 7: 完成交付报告和最终提交**

```bash
git add src tests README.md PROJECT_PROFILE.md docs/PROJECT_REQUIREMENTS.md DECISIONS.md \
  docs/superpowers/plans/2026-07-12-agentdock-codex-newapi-full-tool-capability.md
git commit -m "feat: restore full codex tools through newapi"
```

如果前面已按任务拆分提交，本步骤只提交剩余文档和验证相关 tracked 文件，不 squash 未经用户确认的历史提交。

---

## 计划自审

### SPEC 覆盖

- 模型别名、单字段 model 重写：Task 3、4。
- Responses/SSE 原样透传：Task 3、7。
- 真实 Key 隔离和 loopback token：Task 3、4、7。
- 运行模式恢复：Task 2、5。
- 新建/resume/fresh/interrupted 一致：Task 4、8。
- 内部别名不对用户可见：Task 4、5、7。
- 恢复正文不进入 argv：Task 1、6、8。
- 无新增依赖、无 Gateway/fallback：Task 3、7、8。
- 真实生产工具验收：Task 8。

### 类型一致性

- 共享类型统一使用 `CodexLaunchMode = 'native-responses' | 'newapi-tool-compatible'`。
- Profile 字段统一为 `codexDefaultLaunchMode`。
- Session/IPC 字段统一为 `codexLaunchMode`。
- 代理实例统一返回 `baseUrl`、`localApiKey`、`internalModel`、`close()`。

### 占位与范围检查

- 所有文件路径、类型名、测试命令、提交信息和验收步骤均已明确。
- `<buildId>` 只表示运行打包命令后产生的动态构建编号，不是待设计字段。
- 计划不先同步旧断言到不安全 argv 行为，避免无效返工。
- 计划不引入 Chat bridge、Agent Runtime、自动路由或成本 Dashboard。
