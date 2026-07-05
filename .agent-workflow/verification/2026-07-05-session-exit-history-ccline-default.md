# 真实验证记录

## 验证对象
退出态操作条、会话历史持久化、5MB 历史上限提示与归档、CCometixLine 默认开启。

## 验证环境
本地 macOS，Electron 打包产物。

## 使用的真实依赖
- 本地 JSON metadata store
- node-pty adapter 合同测试
- Electron macOS 打包产物
- 包内 `@cometix/ccline-darwin-arm64@1.1.2`
- macOS codesign

## 验证步骤
1. TDD 增加 session history store、SessionService、preload、Renderer 测试。
2. 实现退出态操作条：恢复会话、重新启动、复制输出、关闭标签。
3. 实现会话历史持久化：重启后恢复标签和输出；运行中会话标记为 `interrupted`。
4. 实现 5MB 单会话历史保存上限提示和 `存档历史` 动作。
5. 实现 Claude Profile CCometixLine 默认开启，显式关闭保留。
6. 全量测试、workflow doctor、typecheck、build、package、codesign、包内 marker 验证。

## 证据门
| 检查项 | 命令或证据 | 结果 |
|--------|------------|------|
| 聚焦测试 | `npx vitest run tests/app/metadataStores.test.ts tests/app/sessionService.test.ts tests/app/App.test.tsx tests/app/preloadTypes.test.ts` | PASS：4 files / 70 tests |
| 回归聚焦 | `npx vitest run tests/app/sessionServiceTerminal.test.ts tests/app/sessionService.test.ts` | PASS：2 files / 20 tests |
| Typecheck | `npm run typecheck` | PASS |
| 全量测试 | `npm test` | PASS：32 files / 199 tests |
| Workflow | `npm run workflow:doctor` | PASS |
| 构建 | `npm run build` | PASS：仅 Vite chunk size warning |
| 打包 | `npm run package:mac` | PASS：`release/packages/20260705-172808/AgentDock-darwin-arm64/AgentDock.app` |
| 签名 | `codesign --verify --deep --strict --verbose=2 release/packages/20260705-172808/AgentDock-darwin-arm64/AgentDock.app` | PASS |
| 包内 ccline | `.../app.asar.unpacked/node_modules/@cometix/ccline-darwin-arm64/ccline --version` | PASS：`ccline 1.1.2` |
| 包内 marker | app.asar 中包含 `historyLimitReached`、`resumeCommand`、`archiveSessionHistory`、`SESSION_HISTORY_BUFFER_LIMIT_BYTES` | PASS |

## 实际结果
最新包包含退出态操作条、历史保存/恢复、5MB 保存上限提示和归档、CCometixLine 默认开启。

## 未验证项
- 未做人工重启 App 后历史标签恢复 smoke；已通过 store、service、renderer 和 packaged marker 覆盖主要链路。

## 结论
PASS

## 发现的问题
无。

## 后续动作
交付用户使用最新包做人工 smoke。
