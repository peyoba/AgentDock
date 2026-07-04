# 开发交付报告

## 任务概述
修复 AgentDock 启动 Claude/Codex 等 Agent CLI 时不跟随用户级已更新版本的问题。核心改动是让 PTY 启动环境优先使用 `~/.local/bin`、`~/.npm-global/bin`、`~/.claude/bin` 等用户级 CLI 路径，并在 `zsh -lc` 命令前重新导出 PATH，避免登录 shell 配置把 Homebrew 旧版本重新放到前面。

## 任务分级
L3，理由：影响真实 PTY、外部 CLI binary 解析、环境变量/PATH 行为和 macOS 打包产物。

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
| ①测试 | 写 PATH 顺序和 login shell PATH 保护回归测试 | PASS | `tests/app/ptyAdapter.test.ts` |
| ②开发 | 调整 PTY PATH 合成和命令前 PATH export | PASS | `src/main/adapters/ptyAdapter.ts` |
| ③验收 | 对照需求确认新 Agent 会话优先命中用户级 Claude CLI | PASS | 真实 node-pty smoke |
| ④质量 | 检查改动范围和命名，保持 adapter 内聚 | PASS | 无新增依赖 |
| ⑤安全 | 确认未触碰 secret 注入、未输出 API key | PASS | 仅 PATH 非敏感值 |
| ⑩风险 | 覆盖真实 PTY 和打包产物验证 | PASS | 验证记录 |
| ⑧集成 | 全量测试、workflow、typecheck、build、package、codesign | PASS | `release/packages/20260704-193715/AgentDock-darwin-arm64/AgentDock.app` |
| ⑦文档 | 记录 L3 验证和交付报告 | PASS | 本文件和 verification 文件 |

## 流程偏离说明
未实际派发独立子 Agent；当前运行环境没有子 Agent 工具，本次按角色清单在主 Agent 内完成并记录结论。

## 测试结果
- `npm run test -- tests/app/ptyAdapter.test.ts`：PASS，1 file / 8 tests。
- `npm run test`：PASS，30 files / 159 tests。
- `npm run workflow:doctor`：PASS。
- `npm run typecheck`：PASS。
- `npm run build`：PASS，仅 Vite chunk size warning。

## 真实验证
- 真实 `node-pty` smoke：`command -v claude; claude --version` 输出 `/Users/peyoba/.local/bin/claude` 和 `2.1.201 (Claude Code)`。
- `npm run package:mac`：PASS，产物 `release/packages/20260704-193715/AgentDock-darwin-arm64/AgentDock.app`。
- `codesign --verify --deep --strict --verbose=2 release/packages/20260704-193715/AgentDock-darwin-arm64/AgentDock.app`：PASS。
- 解包 app.asar 后检查 `dist/main/adapters/ptyAdapter.js`：PASS，包含 `.local`、`.npm-global` 和 `export PATH` 逻辑。

## 风险结论
风险可控。改动只影响新启动的 PTY 会话，不修改用户全局 shell 配置，不影响已经运行的会话，不触碰 API key 或 endpoint 注入逻辑。

## 交付状态
可交付

## 下一步建议
用新包手动启动一个 Claude profile，进入后运行 `/doctor` 或查看启动页版本，确认 GUI 流程也显示新版 Claude CLI。
