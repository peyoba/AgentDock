# Agent Workflow State

## 当前任务
AgentDock Phase 2 Real Terminal & Keychain：Phase 1 已验证完成；Phase 2 Task 1（Session Orchestration Adapter Injection）已完成，下一步将进入真实 node-pty / Keychain 集成暂停点。

## 风险等级
L3

触发原因：Electron 桌面应用、内嵌终端 PTY、API Key/Keychain、环境变量注入、外部 CLI（Claude/Codex）、GitHub 仓库初始化。

## 当前 Hook
plan_review_hook

## 当前阶段
phase-2-task-1-pass

## 已派发角色
| 角色 | 状态 | 产出 |
|------|------|------|
| 主 Agent | PASS | 项目骨架、文档、工作流配置、GitHub 仓库 |
| ⑦文档工程师 | PASS | docs/PROJECT_REQUIREMENTS.md、README.md、PROJECT_PROFILE.md、DECISIONS.md |
| ⑧集成工程师 | PASS | workflow doctor、workflow tests、typecheck、build |
| ⑨部署工程师 | PASS | GitHub private repo: https://github.com/peyoba/AgentDock |
| 主 Agent | PASS | Phase 1 基础层实现与验证：测试框架、类型/脱敏、启动环境、adapter contracts、metadata stores、preload IPC、Renderer UI、session orchestration |
| 主 Agent | PASS | Phase 2 SPEC 与实施计划：`.agent-workflow/specs/2026-07-02-agentdock-phase-2-real-terminal-keychain.md`、`docs/plans/2026-07-02-agentdock-phase-2-real-terminal-keychain.md` |
| 主 Agent | PASS | Phase 2 Task 1：SessionService fake Keychain/PTTY adapter 注入编排与安全返回测试 |

状态只能使用：`READY / RUNNING / PASS / FAIL / BLOCKED / SKIPPED`

## 阻塞点
无

## 用户待确认
是否允许进入 Phase 2 真实 `node-pty` / macOS Keychain 集成。`node-pty` 和 `keytar` 已在 optionalDependencies 中并已安装可 resolve，但真实集成本身仍触发暂停条件。

## 下一步
暂停等待用户确认后，再进入 Phase 2 Task 2 / Task 3 的真实 Keychain / PTY adapter 实现与验证。

## Phase 1 暂停规则
Phase 1 内部任务不需要逐项再确认；只有新增生产依赖、进入真实 node-pty/Keychain 集成、修改产品范围或遇到安全风险时才暂停请求用户确认。

## 决策记录
| 时间 | 决策 | 理由 |
|------|------|------|
| 2026-07-01 | Electron + React + TypeScript + xterm.js + node-pty | 内嵌终端成熟度最高，接近 VSCode/Cursor |
| 2026-07-01 | 主界面终端优先，当前会话详情默认收起 | 用户接受简化方向 |
| 2026-07-01 | API 配置按工具类型分类，参考 CC Switch | 用户明确要求 |
| 2026-07-01 | 创建 GitHub 私有仓库 | 用户明确要求创建 GitHub 仓库；私有仓库更适合开发初期 |
| 2026-07-02 | Phase 1 执行确认并补充安全/UI 测试约束 | 用户确认计划并要求 Codex endpoint 隔离、Renderer/IPC 不返回完整 secret/env、UI 测试覆盖关键 UI 行为 |

## 验证记录
| 时间 | 命令 | 结果 |
|------|------|------|
| 2026-07-01 | `npm run workflow:doctor` | PASS |
| 2026-07-01 | `npm run test:workflow` | PASS：8 passed |
| 2026-07-01 | `npm run typecheck` | PASS |
| 2026-07-01 | `npm run build` | PASS |
| 2026-07-01 | `grep` 密钥模式扫描 | 未发现真实 key |
| 2026-07-02 | `npm run workflow:doctor` | PASS |
| 2026-07-02 | `npm run test:workflow` | PASS：8 passed |
| 2026-07-02 | `npm run test` | PASS：3 files / 5 tests |
| 2026-07-02 | `npm run build` | PASS |
| 2026-07-02 | key-like secret scan | 未发现真实 API key；命中项仅为历史文档/mockup 占位符 |
| 2026-07-02 | `npm run workflow:doctor` | PASS |
| 2026-07-02 | `npm run test:workflow` | PASS：8 passed |
| 2026-07-02 | `npm run test` | PASS：6 files / 11 tests |
| 2026-07-02 | `npm run build` | PASS |
| 2026-07-02 | key-like secret scan | 未发现真实 API key；命中项仅为历史文档/mockup 占位符 |
| 2026-07-02 | `npm run workflow:doctor` | PASS |
| 2026-07-02 | `npm run test:workflow` | PASS：8 passed |
| 2026-07-02 | `npm run test` | PASS：8 files / 15 tests |
| 2026-07-02 | `npm run build` | PASS |
| 2026-07-02 | key-like secret scan | 未发现真实 API key；命中项仅为历史文档/mockup 占位符 |
| 2026-07-02 | `npm run test -- sessionService sessionSecurity` | PASS：2 files / 2 tests |
| 2026-07-02 | `npm run build` | PASS |
| 2026-07-02 | `npm run test` | PASS：9 files / 16 tests |
| 2026-07-02 | `npm run workflow:doctor` | PASS |
| 2026-07-02 | `npm run test:workflow` | PASS：8 passed |

## 批次进展
| 批次 | 状态 | 产出 |
|------|------|------|
| Phase 1 Batch 1 | PASS | 测试框架、共享类型、密钥脱敏、Claude/Codex 启动环境生成；验证记录 `.agent-workflow/verification/2026-07-02-phase-1-batch-1.md` |
| Phase 1 Batch 2 | PASS | Keychain/PTY adapter contracts、Profile/Workspace metadata stores、preload IPC 安全边界；验证记录 `.agent-workflow/verification/2026-07-02-phase-1-batch-2.md` |
| Phase 1 Batch 3 | PASS | 终端优先 Renderer、UI 行为测试、内存 session orchestration；验证记录 `.agent-workflow/verification/2026-07-02-phase-1-batch-3.md` |
| Phase 1 MVP Foundation | PASS | 总验证记录 `.agent-workflow/verification/2026-07-02-agentdock-phase-1-mvp-foundation.md` |
| Phase 2 Plan | PASS | SPEC 与计划已创建；真实集成前等待确认 |
| Phase 2 Task 1 | PASS | `SessionService` 支持 fake Keychain/PTTY adapter 注入、构建 env 并 spawn fake PTY；返回/list 只暴露安全 metadata |
