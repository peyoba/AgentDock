# 真实验证记录

## 验证对象
AgentDock `总结并续开` handoff prompt 自动注入新终端会话。

## 验证环境
本地 macOS，Electron + TypeScript 构建产物，真实 `node-pty`。

## 使用的真实依赖
- 真实 `node-pty`
- 本地 shell/PTY
- 构建后的 `dist/main/summaryContinuation.js`

## 验证步骤
1. 先写 RED 测试，证明续开 helper 不存在时失败。
2. 新增 `summaryContinuation` helper，并在主进程 summary continuation 接线中使用。
3. 运行聚焦测试、全量测试、workflow、typecheck、build。
4. 用构建产物启动真实 `node-pty` + `cat`，调用 `launchContinuationWithPrompt`，确认 handoff prompt 被进程收到。
5. 对本次相关文件做 secret-like pattern 扫描。

## 证据门
| 检查项 | 命令或证据 | 结果 |
|--------|------------|------|
| RED 测试 | `npx vitest run tests/app/summaryContinuation.test.ts` | PASS：实现前因 `src/main/summaryContinuation` 不存在而失败 |
| 聚焦测试 | `npx vitest run tests/app/summaryContinuation.test.ts` | PASS：1 file / 1 test |
| 聚焦回归 | `npx vitest run tests/app/summaryJobService.test.ts tests/app/sessionService.test.ts tests/app/App.test.tsx` | PASS：3 files / 79 tests |
| 全量测试 | `npm test` | PASS：38 files / 235 tests |
| 工作流检查 | `npm run workflow:doctor` | PASS |
| 工作流测试 | `npm run test:workflow` | PASS：8 passed |
| Lint / Typecheck | `npm run typecheck` | PASS |
| 构建 | `npm run build` | PASS：仅 Vite chunk size warning |
| macOS 打包 | `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run package:mac` | PASS：`release/packages/20260706-190128/AgentDock-darwin-arm64/AgentDock.app` |
| 签名验证 | `codesign --verify --deep --strict --verbose=2 release/packages/20260706-190128/AgentDock-darwin-arm64/AgentDock.app` | PASS |
| 包内 marker scan | `strings release/packages/20260706-190128/AgentDock-darwin-arm64/AgentDock.app/Contents/Resources/app.asar \| rg "launchContinuationWithPrompt\|summaryContinuation\|continuationPromptTerminalInput\|Read the AgentDock handoff first"` | PASS：命中续开 prompt 注入相关 marker |
| packaged ccline smoke | `release/packages/20260706-190128/AgentDock-darwin-arm64/AgentDock.app/Contents/Resources/app.asar.unpacked/node_modules/@cometix/ccline-darwin-arm64/ccline --version` | PASS：`ccline 1.1.2` |
| 空白检查 | `git diff --check` | PASS |
| 真实依赖验证 | `node --input-type=module` smoke using `dist/main/summaryContinuation.js` + real `node-pty` + `cat` | PASS：PTY output 包含 `/tmp/agentdock-handoff-smoke.md` |
| secret-like scan | `rg -n "sk-[A-Za-z0-9_-]{12,}|sk-ant-[A-Za-z0-9_-]{12,}|OPENAI_API_KEY=|ANTHROPIC_AUTH_TOKEN=|ANTHROPIC_API_KEY=" src/main/summaryContinuation.ts tests/app/summaryContinuation.test.ts src/main/main.ts` | PASS：无命中 |

## 实际结果
`总结并续开` 的 continuation launcher 现在会启动同 profile/workspace/command 的新会话，并把 handoff prompt 归一化成单行后写入新 session 的 PTY stdin，末尾发送回车提交。真实 PTY smoke 证明进程可收到该 prompt。新 macOS 可复测包已生成并通过签名验证。

## 未验证项
- 未消耗真实 Claude/Codex API 额度做端到端 LLM 对话验证；本次验证覆盖了主进程接线、单元行为和真实 PTY 输入通道。

## 结论
PASS

## 发现的问题
旧实现只启动新 session 并返回 copyable `handoffPrompt`，没有把 prompt 写入新 CLI，因此续开后的模型不会自动看到 handoff。

## 后续动作
进入 delivery_hook，用户可用开发构建或后续打包产物复测真实 Claude/Codex 续开体验。
