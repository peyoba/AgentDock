# AgentDock 第二阶段真实终端与 Keychain 实施计划

> **给 Claude / Codex：** 执行本计划时必须使用 `superpowers:executing-plans`，并按 TDD 逐项实现、逐项验证。

**目标：** 把 Phase 1 的安全基础层连接到真实 macOS Keychain、真实 `node-pty` 和 xterm.js 终端渲染，让 AgentDock 能启动真实隔离会话。

**架构：** Main process 继续拥有 secret、env 和 PTY；Renderer 只通过受控 IPC 收发 terminal data，不接收完整 secret 或完整 env。Keychain 和 PTY 必须通过 adapter 注入到 session orchestration，方便 fake adapter 单元测试与真实 adapter 验证分离。

**技术栈：** Electron + React + TypeScript + xterm.js + `node-pty` + `keytar`。`node-pty` 和 `keytar` 已在 optionalDependencies 中并已安装可 resolve；但进入真实集成仍触发暂停条件，需要用户确认。

---

## 暂停点

根据用户规则，以下动作必须暂停确认：

- 开始真实 `node-pty` adapter 实现；
- 开始真实 macOS Keychain adapter 实现；
- 处理真实 API key、真实账号、真实外部服务；
- 需要新增生产依赖；
- 需要修改产品范围。

因此本计划可先落地，但执行 Task 2 / Task 3 的真实 adapter 实现前必须确认。

---

## Task 1：Session Orchestration Adapter Injection

**文件：**
- 修改：`src/main/sessionService.ts`
- 修改：`tests/app/sessionService.test.ts`
- 新建：`tests/app/sessionSecurity.test.ts`

**步骤 1：写失败测试**

测试 SessionService 能接收 fake keychain / fake pty adapter，并且返回 session metadata 时不包含完整 secret/env。

**步骤 2：验证 RED**

```bash
npm run test -- sessionService sessionSecurity
```

预期：FAIL，现有 service 还不能注入 adapter。

**步骤 3：最小实现**

- 为 `createSessionService` 增加可选依赖：keychain adapter、pty adapter、appDataPath。
- `launch` 内部读取 fake secret、构建 env、调用 fake pty spawn。
- session metadata 只保存 id/title/profileId/workspaceId/command/status/startedAt。
- 不通过返回值暴露 secret/env。

**步骤 4：验证 GREEN**

```bash
npm run test -- sessionService sessionSecurity
npm run build
```

**步骤 5：提交**

```bash
git add src/main/sessionService.ts tests/app/sessionService.test.ts tests/app/sessionSecurity.test.ts
git commit -m "feat: inject session runtime adapters"
```

---

## Task 2：Real Keychain Adapter

**暂停条件：** 进入真实 macOS Keychain 集成。执行前必须确认。

**文件：**
- 修改：`src/main/adapters/keychainAdapter.ts`
- 新建：`tests/app/keychainAdapter.test.ts` 或 `.agent-workflow/verification/<date>-keychain.md`

**步骤：**

1. 用 fake test 固定 adapter interface 行为。
2. 使用 `keytar` 实现 `createKeytarAdapter`。
3. 真实验证使用测试 service/account 和明显假 secret。
4. 验证 write/read/delete。
5. 记录真实验证结果。

---

## Task 3：Real PTY Adapter

**暂停条件：** 进入真实 `node-pty` 集成。执行前必须确认。

**文件：**
- 修改：`src/main/adapters/ptyAdapter.ts`
- 新建：`tests/app/ptyAdapter.test.ts` 或 `.agent-workflow/verification/<date>-pty.md`

**步骤：**

1. 用 fake/minimal test 固定 spawn/write/resize/kill 合同。
2. 使用 `node-pty` 实现 `createNodePtyAdapter`。
3. 真实验证本地安全命令，例如 shell echo，不使用真实 API key。
4. 验证 output、input、resize、kill。
5. 记录真实验证结果。

---

## Task 4：Terminal IPC

**文件：**
- 修改：`src/shared/preloadTypes.ts`
- 修改：`src/preload/preload.ts`
- 修改：`src/main/main.ts`
- 新建：`tests/app/terminalIpcTypes.test.ts`

**目标：**

- 增加 terminal input / resize / kill IPC。
- 增加 terminal output 事件订阅。
- IPC payload 不得包含完整 secret/env。

---

## Task 5：xterm.js Terminal Binding

**文件：**
- 修改：`src/renderer/components/TerminalPane.tsx`
- 可能新建：`src/renderer/hooks/useTerminalSession.ts`
- 新建：`tests/app/TerminalPane.test.tsx`

**目标：**

- 每个 session 创建 xterm Terminal instance。
- terminal input 写入 IPC。
- terminal output 写入 xterm。
- resize 事件调用 IPC。
- UI 继续保持终端优先和详情默认收起。

---

## Task 6：真实会话验证

**文件：**
- 新建：`.agent-workflow/verification/2026-07-02-phase-2-real-terminal-keychain.md`
- 修改：`.agent-workflow/state.md`

**验证：**

```bash
npm run workflow:doctor
npm run test:workflow
npm run test
npm run build
```

真实验证记录：

- Keychain 测试 service/account write/read/delete。
- PTY 本地 echo/input/resize/kill。
- 若用户确认真实 CLI/key，再验证 Claude/Codex 会话隔离。

