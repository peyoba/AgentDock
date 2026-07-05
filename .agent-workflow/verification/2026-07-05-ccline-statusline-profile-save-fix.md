# 真实验证记录

## 验证对象
CCometixLine StatusLine 配置保存回滚修复。

## 验证环境
本地 macOS，Electron 打包产物。

## 使用的真实依赖
- 本地 profile JSON store
- Electron macOS 打包产物
- 包内 `@cometix/ccline-darwin-arm64@1.1.2`
- macOS codesign

## 验证步骤
1. 先用 RED 测试复现 profile store 保存后丢失 `claudeCclineStatusLineEnabled`。
2. 修复 profile sanitizer / migration 白名单。
3. 运行聚焦测试、全量测试、workflow doctor、typecheck、build。
4. 重新打 macOS 包并验证签名、包内 ccline 与包内字段 marker。

## 证据门
| 检查项 | 命令或证据 | 结果 |
|--------|------------|------|
| RED 测试 | `npx vitest run tests/app/metadataStores.test.ts tests/app/configMigration.test.ts` | PASS：修复前按预期失败，缺少 `claudeCclineStatusLineEnabled` |
| 聚焦测试 | `npx vitest run tests/app/App.test.tsx tests/app/sessionService.test.ts tests/app/cclineLocator.test.ts tests/app/packageMacScript.test.ts tests/app/metadataStores.test.ts tests/app/configMigration.test.ts` | PASS：6 files / 86 tests |
| 全量测试 | `npm test` | PASS：31 files / 188 tests |
| Workflow | `npm run workflow:doctor` | PASS |
| Typecheck | `npm run typecheck` | PASS |
| 构建 | `npm run build` | PASS：仅 Vite chunk size warning |
| 打包 | `npm run package:mac` | PASS：`release/packages/20260705-163705/AgentDock-darwin-arm64/AgentDock.app` |
| 签名 | `codesign --verify --deep --strict --verbose=2 release/packages/20260705-163705/AgentDock-darwin-arm64/AgentDock.app` | PASS |
| 包内 ccline | `.../app.asar.unpacked/node_modules/@cometix/ccline-darwin-arm64/ccline --version` | PASS：`ccline 1.1.2` |
| 包内 marker | app.asar 中 `dist/main/main.js` 与 `dist/main/stores/profileStore.js` 包含 `claudeCclineStatusLineEnabled` | PASS |

## 实际结果
Profile 保存、迁移、主进程返回链路现在都会保留 `claudeCclineStatusLineEnabled`。

## 未验证项
- 未在人工 UI 中点击最新包复测；已通过 store/UI/session/package 自动化和包内 marker 覆盖保存与启动配置链路。

## 结论
PASS

## 发现的问题
此前 UI mock 测试只验证提交 payload，未覆盖真实 store/main sanitizer 返回值。

## 后续动作
交付用户使用最新包复测。
