# 会话 Transcript 存储与上下文恢复验证记录

## 范围

实现 per-session transcript 文件存储、旧 `sessions.json` 迁移、移除底部 5MB 本地回放提示、基于 summary/近期 transcript tail 的恢复 prompt、以及本地历史清理策略。

## 风险等级

L3。

原因：涉及 Electron 主进程 session history 存储、PTY 输出、Renderer 用户提示、AI 续接 prompt、secret 脱敏边界和 macOS 打包产物。

## 验证命令

| 命令 | 结果 |
|------|------|
| `npx vitest run tests/app/sessionTranscriptStore.test.ts tests/app/metadataStores.test.ts tests/app/sessionService.test.ts tests/app/sessionServiceTerminal.test.ts tests/app/contextBudgetEstimator.test.ts tests/app/contextRestore.test.ts tests/app/App.test.tsx` | PASS：7 files / 107 tests |
| `npm run workflow:doctor` | PASS |
| `npm run test:workflow` | PASS：8 passed |
| `npm test` | PASS：41 files / 250 tests |
| `npm run typecheck` | PASS |
| `npm run build` | PASS；仅 Vite chunk size warning |
| `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run package:mac` | PASS：`release/packages/20260706-221852/AgentDock-darwin-arm64/AgentDock.app` |
| `codesign --verify --deep --strict --verbose=2 release/packages/20260706-221852/AgentDock-darwin-arm64/AgentDock.app` | PASS |
| `git diff --check` | PASS |

## 真实验证

| 项目 | 结果 |
|------|------|
| node-pty restore prompt smoke | PASS：真实 `node-pty` 启动 `cat`，写入旧输出，Ctrl-D 退出后 restart，新 PTY 收到 restore prompt，输出包含 `Continue this AgentDock session` 和 `previous smoke output` |
| secret-like 扫描 | PASS：命中项为文档/测试里的假 key 示例和 skill 文案；未发现真实 API Key |
| macOS 包签名 | PASS：最终包满足 designated requirement |

## 结论

本批次功能通过自动化测试、构建、打包、codesign 和真实 PTY smoke。未执行真实 Claude/Codex API 请求；本轮验证不消耗用户 API 额度。
