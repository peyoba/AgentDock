# 开发交付报告

## 任务概述
修复 AgentDock 运行中 Claude/Codex 终端把 xterm OSC 颜色查询回复和已回显 color reply 残留显示成乱码的问题。

## 任务分级
L3。

理由：修改了 PTY 交互链路中的 renderer 终端输入/输出处理，影响 agent CLI TUI、历史回放和终端真实交互体验。

## 执行过的 Hook
- intake_hook
- risk_classification_hook
- plan_review_hook
- red_hook
- green_hook
- integration_hook
- delivery_hook

## 工作分工
| 角色 | 任务 | 结论 | 产出 |
|------|------|------|------|
| 主 Agent | 需求澄清、根因定位、SPEC/计划 | PASS | `.agent-workflow/specs/2026-07-07-terminal-control-sequence-garbled-output.md` |
| ①测试 | RED 测试复现 OSC guard 缺失与 color reply 残留 | PASS | `tests/app/TerminalPane.test.tsx` |
| ②开发 | 最小实现 agent-only OSC query guard 与 live output 过滤 | PASS | `src/renderer/components/TerminalPane.tsx`、`src/renderer/terminalOutput.ts` |
| ③验收 | 对照 SPEC 验证 agent 会话修复、本地 shell 不受影响 | PASS | TerminalPane 24 tests |
| ④质量 | 全量测试、typecheck、build、diff check | PASS | 验证记录 |
| ⑩风险 | 真实 xterm parser smoke 验证根因路径 | PASS | `.agent-workflow/verification/2026-07-07-terminal-control-sequence-garbled-output.md` |

## 流程偏离说明
当前运行环境没有独立子 Agent 调度工具，且工作区已有与终端恢复相关的大量未提交改动；本次在当前工作区按单 Agent 模拟角色流程执行，未创建新 worktree。

## 测试结果
- `npx vitest run tests/app/TerminalPane.test.tsx -t "OSC query\|color replies"`：PASS，3 passed。
- `npx vitest run tests/app/TerminalPane.test.tsx`：PASS，24 passed。
- `npm test`：PASS，42 files / 271 tests。
- `npm run workflow:doctor`：PASS。
- `npm run typecheck`：PASS。
- `npm run build`：PASS；仅 Vite chunk size warning。
- `git diff --check`：PASS。

## 真实验证
真实 `@xterm/xterm@5.5.0` + JSDOM `Terminal.open()` smoke：

- 未加 guard 时，写入 `OSC 10/11 ; ?` 后 `onData` 收到 `ESC]10;rgb:ffff/ffff/ffffST` 与 `ESC]11;rgb:0000/0000/0000ST`。
- 加入与产品实现一致的 `OSC 4/10/11/12` query guard 后，同样输入 `OSC 10/11/4 ; ?`，`onData` 输出为空数组。

## 风险结论
- 未修改 secret、环境变量、IPC 契约或 preload 白名单。
- 未修改 Claude/Codex 启动命令、模型、profile 或 vault。
- 本地 shell 会话 `preserveHistory={false}` 不安装 guard，raw terminal 行为保留。
- 未做打包后 GUI 手动复测，风险由真实 xterm smoke 和自动化测试降低。

## 交付状态
可交付。

## 下一步建议
用当前 App 启动同一个 Codex profile 做一次人工复测，确认截图中的 `^[]10;rgb` 不再出现。
