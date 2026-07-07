# Context Restore TUI / Restart Fix 验证记录

## 验证对象

退出态终端历史回放、重启恢复 prompt 注入、重启操作即时反馈、macOS 打包产物。

## 验证环境

本机 macOS，Electron + React + TypeScript，真实 `node-pty`，本机自签名 `AgentDock Codesign`。

## 使用的真实依赖

- 真实 `node-pty`
- 本机 macOS codesign
- electron-packager 产物
- 内嵌 `@cometix/ccline-darwin-arm64@1.1.2`

## 验证步骤

1. 先补 RED 测试，覆盖 TUI 控制序列进入 restore prompt、退出态历史乱码、重启无即时反馈。
2. 实现共享纯文本清理：退出态历史回放和 restore prompt 使用清理后的可读文本，运行中 TUI 输出保持原始控制序列。
3. 跑聚焦测试、全量测试、workflow、typecheck、build。
4. 打包 macOS App，执行 codesign strict verify。
5. 用真实 `node-pty` + `cat` 验证 restore prompt 写入真实 PTY 后不包含 ESC/ANSI/临时 spinner 文本。

## 证据门

| 检查项 | 命令或证据 | 结果 |
|--------|------------|------|
| RED 测试 | `npx vitest run tests/app/contextRestore.test.ts tests/app/TerminalPane.test.tsx tests/app/sessionService.test.ts` | PASS：实现前 4 个预期失败 |
| RED 测试 | `npx vitest run tests/app/App.test.tsx -t "shows immediate feedback while restarting"` | PASS：实现前缺少即时状态 |
| 聚焦测试 | `npx vitest run tests/app/App.test.tsx tests/app/contextRestore.test.ts tests/app/TerminalPane.test.tsx tests/app/sessionService.test.ts` | PASS：4 files / 105 tests |
| 工作流 | `npm run workflow:doctor` / `npm run test:workflow` | PASS：doctor 全绿；pytest 8 passed |
| 全量测试 | `npm test` | PASS：41 files / 254 tests |
| Typecheck / Build | `npm run typecheck` / `npm run build` | PASS；build 仅 Vite chunk size warning |
| 空白检查 | `git diff --check` | PASS |
| 打包 | `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run package:mac` | PASS：`release/packages/20260706-224846/AgentDock-darwin-arm64/AgentDock.app` |
| 签名 | `codesign --verify --deep --strict --verbose=2 release/packages/20260706-224846/AgentDock-darwin-arm64/AgentDock.app` | PASS |
| 包内检查 | `npx asar list ... | rg "terminalText|contextRestore|terminalOutput|sessionService"` | PASS |
| ccline smoke | packaged `ccline --version` | PASS：`ccline 1.1.2` |
| 真实 PTY | real `node-pty` restore prompt smoke with raw TUI transcript tail | PASS |

## 实际结果

退出态历史回放不再把 ANSI/TUI 控制序列当普通文本显示；恢复 prompt 会保留最近可读对话内容并过滤临时 spinner、ESC 和 ANSI 色码；点击退出态“重新启动/恢复会话”会立即显示正在重启状态。

## 未验证项

- 未消耗真实 Claude/Codex API 额度做端到端对话恢复；本轮真实验证覆盖到 PTY 注入边界。

## 结论

PASS

## 发现的问题

无新增阻塞问题。

## 后续动作

进入交付；用户手动测试新包 `release/packages/20260706-224846/AgentDock-darwin-arm64/AgentDock.app`。
