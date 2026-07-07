# Context Restore TUI / Restart Fix 交付报告

## 任务概述

修复用户测试中发现的两个问题：

- 重启前当前窗口的最近对话没有以可读上下文传给新 Agent。
- 退出态终端历史出现大量 TUI/ANSI 乱码，点击重新启动时缺少即时反馈，看起来像没反应。

## 任务分级

L3。

理由：涉及 Electron Renderer、PTY 输出回放、恢复 prompt 注入、会话重启路径、AI CLI 上下文输入和本地打包产物。

## 执行过的 Hook

- `red_hook`
- `green_hook`
- `integration_hook`
- `delivery_hook`

## 工作分工

| 角色 | 任务 | 结论 | 产出 |
|------|------|------|------|
| 主 Agent | 根因定位、TDD、实现、验证、打包 | PASS | 代码变更、验证记录、交付报告 |
| ⑧集成 | 聚焦测试、全量测试、workflow、typecheck、build、package、codesign | PASS | `.agent-workflow/verification/2026-07-06-context-restore-tui-restart-fix.md` |
| ⑨部署 | 生成新 macOS 包并签名验证 | PASS | `release/packages/20260706-224846/AgentDock-darwin-arm64/AgentDock.app` |

## 流程偏离说明

用户明确要求“自己干完并打包”，本轮按快速修复执行，没有等待额外 SPEC 确认。仍保留 TDD、真实 PTY smoke、全量验证和交付记录。

## 测试结果

| 命令 | 结果 |
|------|------|
| `npx vitest run tests/app/contextRestore.test.ts tests/app/TerminalPane.test.tsx tests/app/sessionService.test.ts` RED | PASS：实现前 4 个预期失败 |
| `npx vitest run tests/app/App.test.tsx -t "shows immediate feedback while restarting"` RED | PASS：实现前缺少即时状态 |
| `npx vitest run tests/app/App.test.tsx tests/app/contextRestore.test.ts tests/app/TerminalPane.test.tsx tests/app/sessionService.test.ts` | PASS：4 files / 105 tests |
| `npm run workflow:doctor` | PASS |
| `npm run test:workflow` | PASS：8 passed |
| `npm test` | PASS：41 files / 254 tests |
| `npm run typecheck` | PASS |
| `npm run build` | PASS；仅 Vite chunk size warning |
| `git diff --check` | PASS |

## 真实验证

| 项目 | 结果 |
|------|------|
| real `node-pty` restore prompt smoke with raw TUI transcript tail | PASS：真实 PTY 收到可读中文最近对话，不包含 ESC、ANSI 色码或 `Working(9s)` 临时状态 |
| macOS package | PASS：`release/packages/20260706-224846/AgentDock-darwin-arm64/AgentDock.app` |
| codesign strict verify | PASS |
| packaged app.asar marker scan | PASS：包含 `dist/shared/terminalText.js`、`contextRestore`、`sessionService` |
| packaged ccline smoke | PASS：`ccline 1.1.2` |

## 风险结论

- 安全：没有新增 secret 暴露面；恢复 prompt 继续走脱敏，并额外去除终端控制字符。
- 运行风险：运行中终端仍保留原始控制序列，不破坏 Claude/Codex TUI 交互；仅退出态历史和 restore prompt 转纯文本。
- 未验证风险：未调用真实 Claude/Codex API 做端到端对话恢复，避免消耗用户额度；真实验证覆盖到 PTY 注入边界。

## 交付状态

可交付。

## 下一步建议

手动打开新包，重点复测：退出态历史是否可读、点“重新启动”是否出现即时状态、重启后的 Agent 是否能读到重启前最近对话。
