# Terminal Live Replay Control Sequences Delivery Report

## 任务

修复运行中的 Agent CLI 终端回放时动态控制序列被过滤，导致 `Working...` 等进度内容堆成乱码的问题。

## 风险等级

L3。涉及 Electron renderer、xterm.js、PTY 输出回放和 macOS packaged App。

## 修改文件

- `src/renderer/components/TerminalPane.tsx`
- `tests/app/TerminalPane.test.tsx`
- `.agent-workflow/verification/2026-07-05-terminal-live-replay-control-sequences.md`

## 实现说明

- 运行中的 terminal replay 保留原始 ANSI/control sequences，让 xterm.js 处理动态刷新、清屏和光标移动。
- 退出/中断后的 read-only 历史视图继续过滤破坏性控制序列，保留可读历史。
- 实时 PTY 输出仍保持 raw 写入。

## 验证

验证记录见 `.agent-workflow/verification/2026-07-05-terminal-live-replay-control-sequences.md`。

关键结果：

- RED 测试先失败并命中旧行为。
- 聚焦测试、相关 UI 测试、全量 Vitest、workflow doctor、typecheck、build 通过。
- 新 macOS 包：`release/packages/20260705-223035/AgentDock-darwin-arm64/AgentDock.app`。
- codesign strict verify 通过。

## 风险和剩余验证

可交付但建议用户做一次真实 CLI smoke：启动 Codex/Claude，等待出现动态 `Working...` 进度，切换到其他标签再切回，确认终端不再展开成重复字符。
