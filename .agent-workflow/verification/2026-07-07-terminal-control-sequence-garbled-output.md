# 真实验证记录

## 验证对象
AgentDock 运行中 Claude/Codex agent 终端的 OSC 颜色查询回复拦截与输出残留过滤。

## 验证环境
本机开发环境：macOS / Node.js / Electron renderer 测试环境。

## 使用的真实依赖
- 真实 `@xterm/xterm@5.5.0` parser 与 `Terminal.open()` 后的 theme/report 行为。
- 项目真实 TypeScript/Vite 构建链路。

## 验证步骤
1. 写入 RED 测试，复现 agent 会话未注册 OSC guard、live/replay 输出保留 color reply 残留。
2. 实现 `TerminalPane` agent-only OSC query guard 和 `preserveLiveAgentOutput` color reply 过滤。
3. 运行聚焦测试、完整 TerminalPane 测试、全量 Vitest、workflow doctor、typecheck、build。
4. 用真实 xterm + JSDOM open smoke 验证：未加 guard 时 `OSC 10/11 ; ?` 会向 `onData` 产生 `ESC]10/11;rgb...ST`；加 guard 后 `onData` 无输出。

## 证据门
| 检查项 | 命令或证据 | 结果 |
|--------|------------|------|
| RED 测试 | `npx vitest run tests/app/TerminalPane.test.tsx -t "suppresses xterm color query replies"` | PASS：实现前失败，`registeredIdents` 为空 |
| RED 测试 | `npx vitest run tests/app/TerminalPane.test.tsx -t "OSC query\|color replies"` | PASS：实现前 color reply 两个用例失败 |
| 聚焦测试 | `npx vitest run tests/app/TerminalPane.test.tsx -t "OSC query\|color replies"` | PASS：3 passed |
| 终端组件测试 | `npx vitest run tests/app/TerminalPane.test.tsx` | PASS：24 passed |
| 全量测试 | `npm test` | PASS：42 files / 271 tests |
| Workflow | `npm run workflow:doctor` | PASS |
| Typecheck | `npm run typecheck` | PASS |
| 构建 | `npm run build` | PASS；仅 Vite chunk size warning |
| 空白检查 | `git diff --check` | PASS |
| 真实依赖验证 | 真实 xterm + JSDOM open smoke，未加 guard 输出 `ESC]10/11;rgb...ST`，加 guard 输出 `[]` | PASS |

## 实际结果
- agent 会话运行中会注册 `OSC 4/10/11/12` query guard；payload 中包含 `?` 时拦截，避免 xterm color report 写回 PTY。
- `preserveLiveAgentOutput` 会移除 raw `ESC]10/11/12/4;rgb...ST/BEL` 和 caret-echoed `^[]10/11/12/4;rgb...^[\` / `^G` 残留。
- `preserveHistory={false}` 的本地 `zsh` / `bash` 会话不安装 guard，仍保留 raw terminal 行为。

## 未验证项
- 未启动真实打包后的 AgentDock GUI 手动复测截图中的同一 Codex profile；本次用真实 xterm parser smoke 和自动化测试覆盖根因路径。

## 结论
PASS

## 发现的问题
无。

## 后续动作
进入 delivery_hook，输出交付报告。
