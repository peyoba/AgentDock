# Terminal Control Sequence Garbled Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 AgentDock 运行中 Claude/Codex 终端把 OSC 颜色查询回复和 TUI 控制序列回显成可见乱码的问题。

**Architecture:** 只在 agent 会话的 renderer 终端层做最小修复：阻止 xterm.js 对 OSC 颜色查询生成的回复继续写回 PTY，并过滤已经被 PTY echo 成普通文本的颜色回复残留。保留 zsh/bash 本地 shell 的原始终端行为，不改 main/preload IPC 契约，不引入新依赖。

**Tech Stack:** Electron + React + TypeScript + xterm.js + Vitest。

---

## 1. 背景与根因

用户截图显示运行中的 Codex 会话出现两类可见混乱：

- `^[]10;rgb:ffff/ffff/ffff^[\`、`^[]11;rgb:0000/0000/0000^[\` 一类颜色回复被当作普通文本显示。
- TUI 刷新状态行和输入提示被压进主 scrollback，和最近恢复体验/终端历史改动相关。

已定位到的根因：

- `src/renderer/components/TerminalPane.tsx` 当前把 `terminal.onData` 的所有内容都转发给 `window.agentDock.writeTerminal`。
- xterm.js 5.5 默认处理 `OSC 10/11/12 ; ?` 和 `OSC 4 ; index ; ?` 查询时，会通过 `coreService.triggerDataEvent(...)` 发出 `ESC]10;rgb...ST` 形式的回复。
- 对 agent 会话来说，这些 terminal-generated replies 会沿 `onData -> PTY stdin` 写回子进程；如果子进程/TTY 当时处于 echo 模式，就会以 `^[]10;rgb...^[\` 的可见文本回显。
- 当前 `src/renderer/terminalOutput.ts` 的 `preserveLiveAgentOutput` 只剥离 alternate-screen 和部分清屏/光标归位控制，没有过滤已被 echo 成普通文本的 OSC 颜色回复。

## 2. 范围

本次做：

- agent 会话中拦截 xterm OSC 颜色查询回复，避免再写回 PTY。
- 过滤运行中/回放路径里的 raw 或 caret-echoed OSC 颜色回复残留。
- 保持 zsh/bash 本地 shell 的 `preserveHistory={false}` 原始终端行为。
- 增加 Vitest 覆盖，先 RED 后 GREEN。

本次不做：

- 不调整 Claude/Codex 启动命令和模型配置。
- 不改 PTY adapter、密钥存储、IPC 类型或 preload 白名单。
- 不引入新依赖，不修改 package 配置、锁文件、`.env`。
- 不重做终端渲染架构或引入完整 TUI 分层缓冲。

## 3. 风险等级

L3。

触发原因：终端 PTY 输入输出、xterm 渲染、agent CLI TUI 交互、历史回放/续接缓冲。必须补真实终端验证记录。

## 4. 文件职责

- `tests/app/TerminalPane.test.tsx`：新增 RED 测试，覆盖 OSC 查询拦截只在 agent 会话启用、local shell 不启用、echoed color replies 不进入 `terminal.write`。
- `src/renderer/components/TerminalPane.tsx`：在 xterm instance 创建后安装 agent-only OSC 查询 guard，并在 cleanup 时释放。
- `src/renderer/terminalOutput.ts`：扩展 agent 输出过滤，移除 raw/caret-echoed OSC color replies，保留本地 shell raw 输出。
- `.agent-workflow/state.md`：按 hook 更新当前阶段与待确认项。
- `.agent-workflow/verification/2026-07-07-terminal-control-sequence-garbled-output.md`：实现后记录真实验证。
- `.agent-workflow/delivery/2026-07-07-terminal-control-sequence-garbled-output-delivery-report.md`：交付前记录结果。

## 5. 验收标准

- 运行中 Claude/Codex agent 会话不再显示 `^[]10;rgb...^[\`、`^[]11;rgb...^[\` 或 raw `OSC 10/11/12/4` 颜色回复残留。
- `zsh` / `bash` 本地 shell 会话继续走 raw terminal，不注册 agent-only OSC guard。
- 退出态/只读历史仍走 `terminalOutputToPlainText`，不回退最近的历史可读性修复。
- 新增测试先确认 RED，再实现 GREEN。
- 完成前运行：
  - `npx vitest run tests/app/TerminalPane.test.tsx`
  - `npm run workflow:doctor`
  - `npm run typecheck`
  - `npm run build`
- 涉及终端真实验证：至少用打包前 dev/build 产物或 node-pty smoke 记录一次 OSC 查询/echo 场景验证，结论写入 verification 文档。

---

### Task 1: RED 测试 agent-only OSC 查询拦截

**Files:**

- Modify: `tests/app/TerminalPane.test.tsx`

- [ ] **Step 1: 扩展 FakeTerminal 支持 parser handler 记录**

在 `FakeTerminal` 类里增加字段和方法：

```ts
static oscHandlers: Array<{ ident: number; callback: (data: string) => boolean | Promise<boolean> }> = [];

parser = {
  registerOscHandler: vi.fn((ident: number, callback: (data: string) => boolean | Promise<boolean>) => {
    FakeTerminal.oscHandlers.push({ ident, callback });
    return { dispose: vi.fn() };
  }),
};
```

并在 `beforeEach` 重置：

```ts
FakeTerminal.oscHandlers = [];
```

- [ ] **Step 2: 写失败测试**

新增测试：

```ts
it('suppresses xterm color query replies for live agent sessions only', async () => {
  render(<TerminalPane sessionId="session-1" preserveHistory />);

  const registeredIdents = FakeTerminal.oscHandlers.map((handler) => handler.ident);
  expect(registeredIdents).toEqual(expect.arrayContaining([4, 10, 11, 12]));

  const foregroundHandler = FakeTerminal.oscHandlers.find((handler) => handler.ident === 10);
  expect(foregroundHandler?.callback('?')).toBe(true);
  expect(foregroundHandler?.callback('rgb:ffff/ffff/ffff')).toBe(false);
});

it('does not install agent-only OSC query guards for local shell sessions', async () => {
  render(<TerminalPane sessionId="session-1" preserveHistory={false} />);

  expect(FakeTerminal.oscHandlers).toHaveLength(0);
});
```

- [ ] **Step 3: 运行 RED**

Run:

```bash
npx vitest run tests/app/TerminalPane.test.tsx -t "OSC query"
```

Expected: FAIL，因为 `TerminalPane` 尚未注册 `parser.registerOscHandler`。

---

### Task 2: RED 测试 echoed OSC color reply 过滤

**Files:**

- Modify: `tests/app/TerminalPane.test.tsx`

- [ ] **Step 1: 写失败测试**

新增测试：

```ts
it('strips echoed terminal color replies from live agent output', async () => {
  render(<TerminalPane sessionId="session-1" />);
  const terminal = FakeTerminal.instances[0];
  await act(async () => {});

  act(() =>
    outputListener?.({
      sessionId: 'session-1',
      data: 'ready ^[]10;rgb:ffff/ffff/ffff^[\\^[]11;rgb:0000/0000/0000^[\\ next',
    }),
  );

  expectTerminalWriteData(terminal, 'ready  next');
});

it('strips raw terminal color replies from replayed agent output', async () => {
  agentDock.readTerminalBuffer = vi
    .fn()
    .mockResolvedValue('old\u001b]10;rgb:ffff/ffff/ffff\u001b\\ output');

  render(<TerminalPane sessionId="session-1" />);
  const terminal = FakeTerminal.instances[0];

  await vi.waitFor(() => {
    expectTerminalWriteData(terminal, 'old output');
  });
});
```

- [ ] **Step 2: 运行 RED**

Run:

```bash
npx vitest run tests/app/TerminalPane.test.tsx -t "color replies"
```

Expected: FAIL，因为 `preserveLiveAgentOutput` 尚未过滤这些回复。

---

### Task 3: GREEN 实现最小修复

**Files:**

- Modify: `src/renderer/components/TerminalPane.tsx`
- Modify: `src/renderer/terminalOutput.ts`

- [ ] **Step 1: 在 `src/renderer/terminalOutput.ts` 增加过滤规则**

实现思路：

```ts
const rawTerminalColorReplyPattern =
  /\x1b\](?:4;\d+|1[012]);rgb:[0-9a-fA-F]{1,4}\/[0-9a-fA-F]{1,4}\/[0-9a-fA-F]{1,4}(?:\x07|\x1b\\)/g;
const echoedTerminalColorReplyPattern =
  /\^\[\](?:4;\d+|1[012]);rgb:[0-9a-fA-F]{1,4}\/[0-9a-fA-F]{1,4}\/[0-9a-fA-F]{1,4}\^\[\\/g;
```

把 `preserveLiveAgentOutput` 改成先过滤 color replies，再保留现有 alternate-screen/destructive-screen 过滤：

```ts
export function preserveLiveAgentOutput(data: string): string {
  return data
    .replace(rawTerminalColorReplyPattern, '')
    .replace(echoedTerminalColorReplyPattern, '')
    .replace(alternateScreenControlPattern, '')
    .replace(destructiveScreenControlPattern, '');
}
```

- [ ] **Step 2: 在 `src/renderer/components/TerminalPane.tsx` 增加 agent-only OSC guard**

新增 helper：

```ts
const AGENT_OSC_QUERY_IDS = [4, 10, 11, 12] as const;

function isOscColorQueryPayload(data: string): boolean {
  return data.split(';').some((part) => part.trim() === '?');
}

function installAgentOscQueryGuards(terminal: Terminal): () => void {
  const disposables = AGENT_OSC_QUERY_IDS.map((ident) =>
    terminal.parser.registerOscHandler(ident, (data) => {
      return isOscColorQueryPayload(data);
    }),
  );

  return () => {
    disposables.forEach((disposable) => disposable.dispose());
  };
}
```

在 `TerminalPane` effect 中，创建 terminal 后、订阅 `onData` 前安装：

```ts
const cleanupOscQueryGuards =
  preserveHistory && !readOnly ? installAgentOscQueryGuards(terminal) : () => undefined;
```

cleanup 中调用：

```ts
cleanupOscQueryGuards();
```

- [ ] **Step 3: 跑 GREEN 测试**

Run:

```bash
npx vitest run tests/app/TerminalPane.test.tsx
```

Expected: PASS。

---

### Task 4: 集成验证与交付记录

**Files:**

- Create: `.agent-workflow/verification/2026-07-07-terminal-control-sequence-garbled-output.md`
- Create: `.agent-workflow/delivery/2026-07-07-terminal-control-sequence-garbled-output-delivery-report.md`
- Modify: `.agent-workflow/state.md`

- [ ] **Step 1: 项目要求命令**

Run:

```bash
npm run workflow:doctor
npm run typecheck
npm run build
```

Expected:

- `workflow:doctor` PASS。
- `typecheck` PASS。
- `build` PASS；若只有既有 Vite chunk size warning，记录为非阻塞。

- [ ] **Step 2: 补真实终端验证**

至少执行一种真实验证并记录：

- 真实 AgentDock dev/package 中启动 Codex agent 会话，触发或回放包含 `OSC 10/11` 查询的输出，确认终端不出现 `^[]10;rgb` / `^[]11;rgb`。
- 或用 `node-pty` + xterm parser/renderer smoke 验证：agent 模式注册 guard 后，`OSC 10/11 ; ?` 不再通过 `onData` 写入 PTY；同时 `preserveLiveAgentOutput` 会移除已 echo 的 `^[]10;rgb...^[\`。

- [ ] **Step 3: 交付文档**

验证文档必须包含：

```md
# 2026-07-07 Terminal Control Sequence Garbled Output Verification

## 命令
- `npx vitest run tests/app/TerminalPane.test.tsx`: PASS/FAIL
- `npm run workflow:doctor`: PASS/FAIL
- `npm run typecheck`: PASS/FAIL
- `npm run build`: PASS/FAIL

## 真实终端验证
- 场景：
- 步骤：
- 结果：
- 结论：

## 风险结论
- 未修改 secret/环境变量 IPC 契约。
- 未修改 zsh/bash raw shell 行为。
```

交付报告必须使用中文，并说明若未完成真实 AgentDock UI 复测则不能写“完全完成”。

---

## 自审

- Spec coverage：覆盖截图中的 OSC color reply 可见乱码和 agent live replay 过滤路径；保留 local shell raw 行为。
- Placeholder scan：无 `TBD`、`TODO`、`implement later`。
- Type consistency：`TerminalPane` 使用 xterm `terminal.parser.registerOscHandler`，`TerminalPane.test.tsx` FakeTerminal 增加同名 parser mock。
