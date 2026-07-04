# 真实验证记录

## 验证对象
Claude StatusLine 的 CCometixLine 内嵌二进制集成，从独立 worktree 分支 `worktree-ccline-embed` 合并到当前 `main`。

## 验证环境
本地 macOS，仓库路径 `/Users/peyoba/Desktop/web/AgentDock`。

## 使用的真实依赖
- npm optional dependency：`@cometix/ccline-darwin-arm64@1.1.2`
- 本机打包证书：`AgentDock Codesign`
- 打包产物：`release/packages/20260705-132413/AgentDock-darwin-arm64/AgentDock.app`

## 验证步骤
1. cherry-pick worktree 提交 `3cde58d` 到当前 `main`，保留当前 vault/清理记录并解决 `.agent-workflow/state.md` 冲突。
2. 运行 ccline/statusLine 聚焦测试。
3. 运行 workflow、全量测试、typecheck、build。
4. 运行 `npm install` 让本地 `node_modules` 与新增 optional dependency 对齐。
5. 重新打包并验证签名与包内 `ccline` 可执行文件。

## 证据门
| 检查项 | 命令或证据 | 结果 |
|--------|------------|------|
| Focused tests | `npx vitest run tests/app/cclineLocator.test.ts tests/app/sessionService.test.ts tests/app/packageMacScript.test.ts` | PASS：3 files / 15 tests |
| Workflow doctor | `npm run workflow:doctor` | PASS |
| Workflow tests | `npm run test:workflow` | PASS：8 passed |
| App tests | `npm test` | PASS：31 files / 187 tests |
| Typecheck | `npm run typecheck` | PASS |
| Build | `npm run build` | PASS：仅 Vite chunk size warning |
| Dependency install | `npm install` | PASS：added 1 package |
| Local ccline binary | `node_modules/@cometix/ccline-darwin-arm64/ccline --version` | PASS：`ccline 1.1.2` |
| Package | `npm run package:mac` | PASS：`release/packages/20260705-132413/AgentDock-darwin-arm64/AgentDock.app` |
| Package signature | `codesign --verify --deep --strict --verbose=2 release/packages/20260705-132413/AgentDock-darwin-arm64/AgentDock.app` | PASS |
| Packaged ccline | `.../app.asar.unpacked/node_modules/@cometix/ccline-darwin-arm64/ccline --version` | PASS：`ccline 1.1.2` |
| Package marker scan | `grep -a 'resolveCclineCommand' .../app.asar`、`grep -a '@cometix/ccline-darwin-arm64' .../app.asar` | PASS |

## 实际结果
- `worktree-ccline-embed` 的 StatusLine/ccline 提交已合入当前 `main`。
- 用户 PATH 中已有 `ccline` 时会优先使用用户安装版本；否则回退到随 App 解包的 `@cometix/ccline-darwin-arm64/ccline`。
- 新包 `20260705-132413` 已签名，并包含可执行 `ccline 1.1.2`。

## 未验证项
- 未在 UI 内实际启动 Claude 并观察状态栏渲染；该步骤会启动真实 Agent CLI 会话，留给用户 smoke。

## 结论
PASS，有条件交付：代码、测试、构建、打包和包内二进制均验证通过；最终 UI 状态栏显示需用户在新包中启动 Claude profile 确认。

## 发现的问题
本地 `node_modules` 初始未安装新增 optional dependency；已运行 `npm install` 同步依赖树后完成打包验证。

## 后续动作
进入 `delivery_hook`；推送合并提交后清理 worktree 可另行处理。
