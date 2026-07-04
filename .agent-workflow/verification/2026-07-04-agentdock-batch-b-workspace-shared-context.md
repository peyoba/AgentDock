# 真实验证记录

## 验证对象
AgentDock Batch B Workspace Shared Context：workspace 本地上下文文件、PTY 环境变量注入、终端输出记录、renderer 查看入口、macOS 打包产物。

## 验证环境
本地 macOS / Electron + React + TypeScript / npm / node-pty / zsh。

## 使用的真实依赖
- 真实 `node-pty` adapter。
- 本机 `zsh`。
- 本地文件系统临时 workspace。
- Electron macOS package 与 codesign。

## 验证步骤
1. 运行全量 app 测试、workflow doctor、workflow tests、typecheck、build 和 diff check。
2. 使用编译后的 `SessionService` + 真实 `node-pty` 启动本地 `zsh`，写入 `echo agentdock-context-smoke`。
3. 轮询临时 workspace 的 `.agentdock/context/shared-context.md`，确认出现 PTY 输出且不包含 key/token/env secret 标记。
4. 执行 `npm run package:mac` 生成 macOS App。
5. 对新 App 执行 `codesign --verify --deep --strict --verbose=2`。
6. 执行 key/token 模式扫描。

## 证据门
| 检查项 | 命令或证据 | 结果 |
|--------|------------|------|
| App 测试 | `npm run test` | PASS：30 files / 156 tests |
| Workflow doctor | `npm run workflow:doctor` | PASS |
| Workflow tests | `npm run test:workflow` | PASS：8 passed |
| Typecheck | `npm run typecheck` | PASS |
| Build | `npm run build` | PASS：仅 Vite chunk size warning |
| Diff check | `git diff --check` | PASS |
| 真实 PTY context smoke | 编译后 main 模块 + 真实 `node-pty` + `zsh`，输出 `agentdock-context-smoke` | PASS |
| Package | `npm run package:mac` | PASS：`release/packages/20260704-173315/AgentDock-darwin-arm64/AgentDock.app` |
| Codesign | `codesign --verify --deep --strict --verbose=2 release/packages/20260704-173315/AgentDock-darwin-arm64/AgentDock.app` | PASS：valid on disk / satisfies Designated Requirement |
| Key/token scan | key/token regex scan on current diff and untracked files | PASS：无输出 |

## 实际结果
- workspace context store 创建 `shared-context.md`、`index.json` 和 session transcript。
- `SessionService` 在启动 PTY 前创建 context 文件，并向 PTY 注入非敏感 context 路径。
- 真实 `zsh` PTY 输出被写入 workspace 的 shared context。
- Renderer 当前会话详情可读取 shared context 并打开 context 文件夹。
- 新 macOS App 已生成并通过 codesign strict verify：`release/packages/20260704-173315/AgentDock-darwin-arm64/AgentDock.app`。

## 未验证项
- 未发起真实 Claude/Codex API 请求；本批次只验证本地 PTY、文件写入、IPC 和打包，不验证外部模型服务。
- 未做 notarization；当前仍为本地 ad-hoc signed package。

## 结论
PASS

## 发现的问题
无。

## 后续动作
进入 delivery_hook，提交交付报告；用户可用新包做手动 smoke。
