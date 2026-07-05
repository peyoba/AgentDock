# Terminal Live Replay Control Sequences Verification

## 任务

修复运行中的 Claude/Codex 终端在切换标签或回放 buffer 时，把动态 TUI 控制序列过滤成重复文本的问题。

## 风险等级

L3。原因：涉及 Electron renderer、xterm.js 终端渲染、PTY 输出回放、macOS 打包产物。

## 验证命令

| 类型 | 命令 | 结果 |
|------|------|------|
| RED | `npx vitest run tests/app/TerminalPane.test.tsx` | FAIL before：`keeps raw terminal control sequences when replaying a live agent session` 失败，回放输出中的 `\x1b[?1049h`、`\x1b[?1006h`、`\x1b[2J`、`\x1b[H` 被过滤 |
| Focused | `npx vitest run tests/app/TerminalPane.test.tsx` | PASS：16 tests |
| Renderer related | `npx vitest run tests/app/App.test.tsx tests/app/TerminalPane.test.tsx` | PASS：2 files / 71 tests |
| Workflow | `npm run workflow:doctor` | PASS |
| Full tests | `npm test` | PASS：33 files / 215 tests |
| Typecheck | `npm run typecheck` | PASS |
| Build | `npm run build` | PASS：仅 Vite chunk size warning |
| Diff check | `git diff --check` | PASS |
| Package first try | `npm run package:mac` | FAIL：packager 阶段 `fetch failed`，源码 build 已通过 |
| Package retry | `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run package:mac` | PASS：`release/packages/20260705-223035/AgentDock-darwin-arm64/AgentDock.app` |
| Codesign | `codesign --verify --deep --strict --verbose=2 release/packages/20260705-223035/AgentDock-darwin-arm64/AgentDock.app` | PASS |
| Packaged marker | `rg` scan of `dist/renderer` and source | PASS：包内 renderer 包含 `preserveHistory && readOnly ? ... : data` 逻辑 |

## 真实验证说明

已生成并签名 macOS package。未在本轮自动启动真实 Claude/Codex 长会话做视觉 smoke；该步骤会复用用户本机 API Profile 和 workspace，需用户用新包观察切换标签后动态进度不再展开为重复文本。

## 结论

有条件可交付：代码路径、测试、build、package、codesign 和包内 marker 已验证。剩余风险是特定 CLI 的长时间动态刷新体验，需要在最新包中人工确认。
