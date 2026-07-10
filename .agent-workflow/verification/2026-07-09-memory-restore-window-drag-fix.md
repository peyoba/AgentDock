# 真实验证记录

## 验证对象
AgentDock 记忆恢复上下文加载与 macOS 窗口拖拽区域修复。

## 验证环境
本地 macOS 开发环境，仓库路径 `/Users/peyoba/Desktop/web/AgentDock`。

## 使用的真实依赖
- 本地文件系统：真实写入临时 restore context 文件。
- Vite/TypeScript 构建产物：扫描 `dist/renderer/assets/*.css`。
- Vitest、workflow CLI、TypeScript 编译和 Vite build。

## 验证步骤
1. 写 RED 测试，确认旧实现只写一句话 restore context、窗口拖拽区域位于左下且不可命中。
2. 修复 `restoreContextStore`：恢复文件写入长期摘要和最近 transcript tail；启动指令要求读取为背景记忆，但等待用户下一步。
3. 修复窗口 chrome CSS：顶部保留 34px 可拖拽区域，按钮保持 `no-drag`，App 内容下移避免遮挡。
4. 跑聚焦测试、全量测试、workflow、typecheck、build。
5. 用构建后的 `dist/main/restoreContextStore.js` 真实写入临时 restore context 文件，确认包含摘要和 transcript tail，且不泄露 env assignment 或测试 key。
6. 扫描构建后的 CSS，确认 `padding:34px 0 0`、`.titlebar-spacer` 和 `-webkit-app-region` 进入产物。
7. 执行 macOS 打包、codesign 严格校验，并扫描包内 `app.asar` 确认本次修复 marker 已进入 App。

## 证据门
| 检查项 | 命令或证据 | 结果 |
|--------|------------|------|
| 聚焦测试 | `npx vitest run tests/app/restoreContextStore.test.ts tests/app/windowChrome.test.ts` | PASS：2 files / 9 tests |
| 恢复安全测试 | `npx vitest run tests/app/sessionService.test.ts tests/app/sessionSecurity.test.ts -t "restore context\|restore memory\|restore prompt\|same session id"` | PASS：2 files / 7 tests，28 skipped |
| 全量测试 | `npm test` | PASS：49 files / 317 tests |
| 工作流检查 | `npm run workflow:doctor` | PASS |
| 工作流测试 | `npm run test:workflow` | PASS：8 passed |
| Typecheck | `npm run typecheck` | PASS |
| 构建 | `npm run build` | PASS，仅 Vite chunk size warning |
| 真实文件写入 smoke | `node --input-type=module ... createRestoreContextStore()` | PASS：`RESTORE_CONTEXT_SMOKE_PASS loaded .agentdock/context/restores/session-smoke.md` |
| 构建产物 CSS scan | `rg -n "titlebar-spacer\|padding:34px 0 0\|-webkit-app-region:drag\|-webkit-app-region:no-drag" dist/renderer/assets/*.css` | PASS：产物包含顶部拖拽区和 no-drag 控件规则 |
| macOS 打包 | `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run package:mac` | PASS：生成 `release/packages/20260709-064902/AgentDock-darwin-arm64/AgentDock.app` |
| codesign | `codesign --verify --deep --strict --verbose=2 release/packages/20260709-064902/AgentDock-darwin-arm64/AgentDock.app` | PASS：valid on disk；satisfies Designated Requirement |
| 包内 marker scan | `node --input-type=module ... app.asar marker scan` | PASS：`PACKAGED_MARKER_SCAN_PASS /dist/main/restoreContextStore.js /dist/renderer/assets/index-Bmc-IMw_.css` |
| 空白检查 | `git diff --check` | PASS |

## 实际结果
- restore context 文件不再只有一句话；会包含 `## Long-Term Summary` 和 `## Recent Transcript Tail`。
- Agent 启动指令不再是 “brief memory summary only”，而是要求读取文件作为 background memory。
- Agent 仍只回复一句恢复完成提示并等待用户，不自动继续旧任务。
- session metadata、spawn command 和 UI 仍不暴露完整 restore context 正文。
- transcript 中的 secret assignment 行会从 restore context 中删除，命令里的 secret assignment 会替换为 `[REDACTED]`。
- 顶部 34px titlebar 区域恢复 `-webkit-app-region: drag`，按钮/input/select 仍为 `no-drag`。

## 未验证项
- 未启动 Electron 图形窗口做人工拖拽。当前通过 CSS 源码测试和构建产物扫描验证；建议下次打开打包 App 时手动拖动顶部 34px 区域确认手感。
- 未做 Electron 图形窗口人工验收。当前已生成可验证包 `release/packages/20260709-064902/AgentDock-darwin-arm64/AgentDock.app`。

## 结论
PASS。

## 发现的问题
旧的恢复体验修复把 restore context 缩减成一句话，导致安全上避免自动继续，但实际 Agent 没有足够上下文可恢复；终端优先布局把标题栏从顶部挪到左下并禁用了 pointer events，导致 macOS 可拖拽窗口区域实际丢失。

## 后续动作
进入 delivery_hook；等待用户验收并建议手动打开 Electron 窗口确认拖拽体验。
