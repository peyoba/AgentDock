# AgentDock 构建版本信息验证

## 验证对象
AgentDock 应用内版本信息和 macOS package 构建元数据。

## 验证环境
本机 macOS，主 worktree：`/Users/peyoba/Desktop/web/AgentDock`，branch `main`。

## 使用的真实依赖
- 本机 npm / Vite / TypeScript / Vitest。
- Electron macOS package 脚本。
- 本机 `AgentDock Codesign` 签名身份。

## 验证步骤
1. 先写 RED 测试，覆盖 build info service、package build metadata、preload API 白名单和 UI 版本 chip。
2. 实现 `AppBuildInfo`、`app:buildInfo` IPC、preload `getBuildInfo()`、左侧会话库版本 chip。
3. 修改 `scripts/package-mac.mjs`，让每个 package 写入 `Contents/Resources/build-info.json`。
4. 运行聚焦测试、全量测试、typecheck、build、package 和 codesign。

## 证据门
| 检查项 | 命令或证据 | 结果 |
|--------|------------|------|
| RED 测试 | `npx vitest run tests/app/buildInfoService.test.ts tests/app/packageMacBuildInfo.test.ts tests/app/preloadTypes.test.ts tests/app/App.test.tsx -t "build metadata\|build identity\|buildInfo\|package version"` | RED：`buildInfoService` 不存在、package helper 不存在、UI 未显示版本 |
| 聚焦测试 | `npx vitest run tests/app/preloadTypes.test.ts tests/app/App.test.tsx tests/app/buildInfoService.test.ts tests/app/packageMacBuildInfo.test.ts` | PASS：4 files / 76 tests |
| 全量测试 | `npm test` | PASS：48 files / 299 tests |
| Typecheck | `npm run typecheck` | PASS |
| Build | `npm run build` | PASS；仅 Vite chunk size warning |
| macOS package | `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run package:mac` | PASS：`release/packages/20260708-062856/AgentDock-darwin-arm64/AgentDock.app` |
| build-info 文件 | `cat release/packages/20260708-062856/AgentDock-darwin-arm64/AgentDock.app/Contents/Resources/build-info.json` | PASS：包含 `version`、`buildId`、`buildTime`、`commit`、`commitShort`、`dirty` |
| codesign | `codesign --verify --deep --strict --verbose=2 release/packages/20260708-062856/AgentDock-darwin-arm64/AgentDock.app` | PASS |

## 实际结果
- 左侧会话库顶部展示 `v版本 · buildId`。
- tooltip 展示 version、buildId、commitShort、buildTime 和 dirty 状态。
- Renderer 通过 preload `getBuildInfo()` 获取结构化构建信息。
- 主进程优先读取 package 内 `Resources/build-info.json`；开发模式缺失该文件时降级为 runtime metadata。
- 每次 `npm run package:mac` 都把构建时间戳目录名作为 `buildId` 写入包内 metadata。

## 未验证项
- 当前验证包是在提交前生成，因此 `dirty: true` 正确反映当时 worktree 有未提交改动；最终提交后会重新打干净包。

## 结论
PASS。
