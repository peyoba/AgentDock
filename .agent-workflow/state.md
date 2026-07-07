# Agent Workflow State

## 当前任务
2026-07-08 AgentDock 长期会话库与终端优先布局重构 Batch 6：恢复语义整合已完成并通过集成验证，准备提交后进入最终打包、codesign、真实验证和交付报告。

## 风险等级
L3

触发原因：完整目标将涉及会话持久化、PTY 生命周期、Claude/Codex 原生 resume、Renderer 主界面、文件系统读取、IPC 边界和 secret 脱敏边界。Batch 6 已完成 verified-native-first 恢复选择、partial/unavailable fallback 和右侧恢复摘要标识。

## 当前 Hook
integration_hook

## 当前阶段
integration

## 已派发角色
| 角色 | 状态 | 产出 |
|------|------|------|
| 主 Agent | PASS | Batch 0 基线已提交：`b9ee2bd chore: stabilize session restore baseline`；已删除未跟踪构建产物和 SPEC 副本目录；workflow/test/typecheck/build/secret scan 通过 |
| 主 Agent | PASS | Batch 1 native resume 探针：`src/main/nativeResumeProbe.ts`、`tests/app/nativeResumeProbe.test.ts`、`.agent-workflow/verification/2026-07-07-native-resume-probe.md`；Claude capability verified 但 runtime smoke partial；Codex native resume verified |
| 主 Agent | PASS | Batch 2 三层模型：`sessionHistoryStore` 增加 close/archive/delete record；`SessionService` stop-only、close view、archive/delete record、runtime owner registry；preload/main IPC 白名单已接入；全量测试/typecheck/build 通过 |
| 主 Agent | PASS | Batch 3 左侧长期会话库：`SessionLibrary`、workspace 分组、单一 `新会话` 入口、搜索、归档过滤、`...` 菜单、关闭视图 UI 语义；验证记录 `.agent-workflow/verification/2026-07-07-session-library-batch3.md` |
| 主 Agent | PASS | Batch 4 终端优先布局：右侧项目面板默认收起为 rail、展开/收起 UI、`--terminal-min-columns: 100` CSS 约束、中窄屏 overlay 规则；验证记录 `.agent-workflow/verification/2026-07-07-terminal-first-layout-batch4.md` |
| 主 Agent | PASS | Batch 5 只读项目文件树：`workspaceFileTreeService`、`sessionFileIndexStore`、`ProjectPanel`/`WorkspaceFileTree`/`ProjectPanelInfoSections`、`workspaceFiles:listDirectory` IPC；验证记录 `.agent-workflow/verification/2026-07-08-project-panel-file-tree-batch5.md` |
| 主 Agent | PASS | Batch 6 恢复语义整合：`nativeResume` metadata、`MemoryRestoreState.method`、verified native resume 优先、partial/unavailable fallback、右侧恢复摘要标识；验证记录 `.agent-workflow/verification/2026-07-08-session-library-native-restore-batch6.md` |
| 主 Agent | PASS | 长期会话库与终端优先布局实施计划：`docs/superpowers/plans/2026-07-07-agentdock-session-library-terminal-first-ui.md`；包含 Batch 0 基线、Batch 1 native resume 探针、Batch 2-6 分批实现 |
| 主 Agent | PASS | 长期会话库与终端优先布局中文 SPEC：`docs/superpowers/specs/2026-07-07-agentdock-session-library-terminal-first-ui-design.zh-CN.md`；等待用户审阅 |
| 主 Agent | PASS | 终端控制序列乱码修复：RED/GREEN 测试、agent-only OSC query guard、live/replay color reply 过滤、真实 xterm smoke、workflow/typecheck/build 验证；交付报告 `.agent-workflow/delivery/2026-07-07-terminal-control-sequence-garbled-output-delivery-report.md` |
| 主 Agent | PASS | 记忆恢复输入框注入根因定位、TDD 修复、node-pty 真实 smoke、workflow/typecheck/build 验证 |
| 主 Agent | PASS | 项目骨架、文档、工作流配置、GitHub 仓库 |
| ⑦文档工程师 | PASS | docs/PROJECT_REQUIREMENTS.md、README.md、PROJECT_PROFILE.md、DECISIONS.md |
| ⑧集成工程师 | PASS | workflow doctor、workflow tests、typecheck、build |
| ⑨部署工程师 | PASS | GitHub private repo: https://github.com/peyoba/AgentDock |
| 主 Agent | PASS | Phase 1 基础层实现与验证：测试框架、类型/脱敏、启动环境、adapter contracts、metadata stores、preload IPC、Renderer UI、session orchestration |
| 主 Agent | PASS | Phase 2 SPEC 与实施计划：`.agent-workflow/specs/2026-07-02-agentdock-phase-2-real-terminal-keychain.md`、`docs/plans/2026-07-02-agentdock-phase-2-real-terminal-keychain.md` |
| 主 Agent | PASS | Phase 2 Task 1：SessionService fake Keychain/PTTY adapter 注入编排与安全返回测试 |
| 主 Agent | PASS | Phase 2 Task 4（非真实集成部分）：Terminal input/resize/kill IPC whitelist、terminal output 订阅、安全 payload 合同、SessionService fake PTY 控制 |
| 主 Agent | PASS | Phase 2 Task 5（非真实集成部分）：Renderer TerminalPane 创建 xterm instance，输入/resize 走 IPC，按 sessionId 接收 output，unmount 清理订阅 |
| 主 Agent | PASS | Phase 2 Task 2/3：真实 `keytar` Keychain adapter、真实 `node-pty` adapter、本地测试 service/account 与安全 PTY 命令验证 |
| 主 Agent | PASS | Phase 2 Task 6：总验证通过并记录 `.agent-workflow/verification/2026-07-02-phase-2-real-terminal-keychain.md` |
| 主 Agent | PASS | Renderer launch flow：启动按钮接入 `launchSession`、动态 sessions/tabs、active xterm session、安全错误显示 |
| 主 Agent | PASS | Session launch failure safety：workspace 缺失先失败、PTY 启动失败标记 failed、安全错误不泄露 secret/env |
| 主 Agent | PASS | Claude AnyRouter 1m 配置修复、代理 URL 防呆、默认工作区清空、Desktop 预检查跳过；交付报告 `.agent-workflow/delivery/2026-07-03-claude-anyrouter-desktop-permission-delivery-report.md` |
| 主 Agent | PASS | Claude 默认模型选择修复：移除 `opus[1m]` 伪模型并迁移历史配置；交付报告 `.agent-workflow/delivery/2026-07-04-claude-model-selector-fix-delivery-report.md` |
| 主 Agent | PASS | Batch A SPEC 已确认；实施计划 `docs/plans/2026-07-04-agentdock-batch-a-claude-models-multiwindow-package.md` 已生成并完成自审 |
| 主 Agent | PASS | Claude 轻量/完整 MCP 启动模式；默认轻量空 MCP；交付报告 `.agent-workflow/delivery/2026-07-04-claude-lite-mcp-launch-mode-delivery-report.md` |
| 主 Agent | PASS | Batch A 实现：Claude 模型映射、多窗口 Session 隔离、时间戳 macOS 打包；验证记录 `.agent-workflow/verification/2026-07-04-agentdock-batch-a-claude-models-multiwindow-package.md` |
| ⑧集成工程师 | PASS | 全量测试、build、package、packaged 双窗口 zsh smoke |
| ⑨部署工程师 | PASS | 新产物 `release/packages/20260704-120943/AgentDock-darwin-arm64/AgentDock.app`，codesign strict verify 通过 |
| ⑧集成工程师 | PASS | Batch A + Claude lite/full MCP 主分支集成验证；验证记录 `.agent-workflow/verification/2026-07-04-batch-a-claude-lite-integration.md` |
| ⑨部署工程师 | PASS | 新产物 `release/packages/20260704-134324/AgentDock-darwin-arm64/AgentDock.app`，codesign strict verify 与 packaged 双窗口 smoke 通过 |
| 主 Agent | PASS | Claude lite 模式追加 `--setting-sources project,local`，排除 user 级插件 hook |
| ⑨部署工程师 | PASS | 新产物 `release/packages/20260704-142744/AgentDock-darwin-arm64/AgentDock.app`，包内包含 `--setting-sources project,local`，codesign strict verify 通过 |
| 主 Agent | PASS | Batch B Workspace Shared Context 正式实施计划：`docs/plans/2026-07-04-agentdock-batch-b-workspace-shared-context.md` |
| ①测试工程师 | PASS | Batch B RED 测试：context store、SessionService context env/输出记录、preload whitelist、renderer shared context UI |
| ②开发工程师 | PASS | Batch B 实现：workspace context store、SessionService context 注入/记录、IPC/preload、renderer 查看入口 |
| ③验收工程师 | PASS | 对照 Batch B 计划核验 included scope，未加入 LLM summarization/cloud sync/API gateway |
| ④质量工程师 | PASS | `npm run typecheck`、`git diff --check` 通过；模块职责保持 main/preload/renderer 边界 |
| ⑤安全工程师 | PASS | context 输出脱敏、IPC 不返回 secret/env、key/token scan 无输出 |
| ⑩风险审查官 | PASS | L3 风险真实验证：node-pty zsh smoke、package、codesign |
| ⑧集成工程师 | PASS | 全量测试、workflow、typecheck、build 通过；验证记录 `.agent-workflow/verification/2026-07-04-agentdock-batch-b-workspace-shared-context.md` |
| ⑨部署工程师 | PASS | 新产物 `release/packages/20260704-173315/AgentDock-darwin-arm64/AgentDock.app`，codesign strict verify 通过 |
| ⑦文档工程师 | PASS | 交付报告 `.agent-workflow/delivery/2026-07-04-agentdock-batch-b-workspace-shared-context-delivery-report.md` |
| 主 Agent | PASS | 终端右侧新增可拖动 scroll thumb，支持鼠标点击拖动快速跳转长输出 |
| ⑧集成工程师 | PASS | TerminalPane/layout tests、typecheck、workflow doctor、build、package、codesign strict verify 通过 |
| ⑦文档工程师 | PASS | 终端滚动滑块交付报告 `.agent-workflow/delivery/2026-07-04-terminal-scrollbar-drag-delivery-report.md`，验证记录 `.agent-workflow/verification/2026-07-04-terminal-scrollbar-drag.md` |
| 主 Agent | PASS | 同步 README、PROJECT_PROFILE、PROJECT_REQUIREMENTS、DECISIONS、AGENTS.md 的本机加密 vault 决策和最新 package 路径 |
| 主 Agent | PASS | Agent CLI PATH 同步修复：用户级 CLI 目录优先，并在 login shell 命令前重新 `export PATH` |
| ⑧集成工程师 | PASS | 全量测试、workflow doctor、typecheck、build、真实 node-pty Claude PATH smoke、package、codesign strict verify 通过 |
| ⑦文档工程师 | PASS | 交付报告 `.agent-workflow/delivery/2026-07-04-agent-cli-path-sync-delivery-report.md`，验证记录 `.agent-workflow/verification/2026-07-04-agent-cli-path-sync.md` |
| 主 Agent | PASS | vault 密钥材料升级 v2，去除 hostname/目录依赖；9 条本机 vault 记录已迁移并备份 |
| 主 Agent | PASS | macOS `AgentDock Codesign` 自签名证书验证通过，重新打包 `release/packages/20260705-020727/AgentDock-darwin-arm64/AgentDock.app` |
| 主 Agent | PASS | 标签原生 tooltip 替换为 0.3s 自绘 tooltip；包内 marker 验证通过 |
| ⑦文档工程师 | PASS | 清理报告第一阶段：删除过时根文档与 mockups 原型；README/UI 文档/workflow 状态同步 |
| ⑧集成工程师 | PASS | workflow doctor、workflow tests、全量 vitest、typecheck、build、codesign strict verify 通过；验证记录 `.agent-workflow/verification/2026-07-05-vault-signing-cleanup.md` |
| ⑨部署工程师 | PASS | GitHub push 已恢复并推送到 `origin/main`；交付报告 `.agent-workflow/delivery/2026-07-05-vault-signing-cleanup-delivery-report.md` |
| 主 Agent | PASS | CCometixLine 状态栏内嵌：`optionalDependencies` 固定 `@cometix/ccline-darwin-arm64@1.1.2`、`cclineLocator` PATH 已安装版本优先/内嵌二进制兜底、statusLine 命令 shell 安全引号、打包 `asar.unpack` 解包 ccline |
| ⑧集成工程师 | PASS | StatusLine worktree 提交已合并到 `main`；聚焦测试、全量测试、workflow、typecheck、build、package、codesign、packaged ccline smoke 通过；验证记录 `.agent-workflow/verification/2026-07-05-ccline-statusline-merge.md` |
| ⑨部署工程师 | PASS | 新产物 `release/packages/20260705-132413/AgentDock-darwin-arm64/AgentDock.app`，交付报告 `.agent-workflow/delivery/2026-07-05-ccline-statusline-merge-delivery-report.md` |
| 主 Agent | PASS | 修复 `claudeCclineStatusLineEnabled` 在 profile save/list/migration 白名单中丢失，避免保存后 checkbox 回滚 |
| ⑧集成工程师 | PASS | RED 测试、聚焦测试、全量测试、workflow doctor、typecheck、build 通过；验证记录 `.agent-workflow/verification/2026-07-05-ccline-statusline-profile-save-fix.md` |
| ⑨部署工程师 | PASS | 新产物 `release/packages/20260705-163705/AgentDock-darwin-arm64/AgentDock.app`，codesign strict verify 与 packaged ccline smoke 通过；交付报告 `.agent-workflow/delivery/2026-07-05-ccline-statusline-profile-save-fix-delivery-report.md` |
| 主 Agent | PASS | 退出态操作条：恢复会话、重新启动、复制输出、关闭标签；异常退出独立文案 |
| 主 Agent | PASS | 会话历史持久化：重启后恢复标签和输出，运行中会话标记 `interrupted`，单会话 5MB 保存上限提示与归档 |
| 主 Agent | PASS | CCometixLine 对所有 Claude Profile 默认开启，显式关闭保留关闭 |
| ⑧集成工程师 | PASS | 聚焦测试、全量测试、workflow doctor、typecheck、build、package、codesign、packaged marker 通过；验证记录 `.agent-workflow/verification/2026-07-05-session-exit-history-ccline-default.md` |
| ⑨部署工程师 | PASS | 新产物 `release/packages/20260705-172808/AgentDock-darwin-arm64/AgentDock.app`，交付报告 `.agent-workflow/delivery/2026-07-05-session-exit-history-ccline-default-delivery-report.md` |
| 主 Agent | PASS | 修复 session history 高频并发 append 写坏 `sessions.json`：写入串行化、坏文件备份恢复、本机坏文件已恢复 |
| ⑧集成工程师 | PASS | RED 测试、聚焦测试、全量测试、workflow doctor、typecheck、build、package、codesign、packaged marker 通过；验证记录 `.agent-workflow/verification/2026-07-05-session-history-corruption-fix.md` |
| ⑨部署工程师 | PASS | 新产物 `release/packages/20260705-174749/AgentDock-darwin-arm64/AgentDock.app`，交付报告 `.agent-workflow/delivery/2026-07-05-session-history-corruption-fix-delivery-report.md` |
| 主 Agent | PASS | TerminalPane live replay 保留 raw 控制序列，read-only 历史继续过滤破坏性控制序列 |
| ⑧集成工程师 | PASS | RED 测试、聚焦测试、相关 UI 测试、全量测试、workflow doctor、typecheck、build、package、codesign、packaged marker 通过；验证记录 `.agent-workflow/verification/2026-07-05-terminal-live-replay-control-sequences.md` |
| ⑨部署工程师 | PASS | 新产物 `release/packages/20260705-223035/AgentDock-darwin-arm64/AgentDock.app`，交付报告 `.agent-workflow/delivery/2026-07-05-terminal-live-replay-control-sequences-delivery-report.md` |
| 主 Agent | PASS | Context Budget Auto Summary Phase 1：pressure estimator、summary store/job service、SessionService/IPC/preload、shared-context 摘要优先、renderer summary actions；验证记录 `.agent-workflow/verification/2026-07-06-context-budget-auto-summary.md` |
| 主 Agent | PASS | Context Budget Auto Summary Phase 2：真实 Claude `--print` / Codex `exec` summary runner、主进程接线、错误脱敏、Codex config 无密钥写入；新产物 `release/packages/20260706-010227/AgentDock-darwin-arm64/AgentDock.app`；交付报告 `.agent-workflow/delivery/2026-07-06-context-budget-auto-summary-runner-delivery-report.md` |
| 主 Agent | PASS | 总结并续开 prompt 注入修复：新 session 启动后自动写入 handoff prompt 到 PTY；新产物 `release/packages/20260706-190128/AgentDock-darwin-arm64/AgentDock.app`；验证记录 `.agent-workflow/verification/2026-07-06-summary-continuation-prompt-injection.md`；交付报告 `.agent-workflow/delivery/2026-07-06-summary-continuation-prompt-injection-delivery-report.md` |
| 主 Agent | PASS | Claude lite / summary runner 高优先级审查修复：`claudeLaunchMode` 写入 session 元数据并在续开/恢复/重启保留；Claude summary runner 使用空 MCP strict + project/local settings + `--effort high`；Codex runner 移除当前 CLI 不支持的旧参数；总结入口仅 Claude/Codex agent 会话显示；Codex 真实 summary smoke PASS，Claude 可用 profile `claude-custom-5` 真实 summary smoke PASS；新包 `release/packages/20260706-211053/AgentDock-darwin-arm64/AgentDock.app` codesign/marker/ccline 验证 PASS；验证记录 `.agent-workflow/verification/2026-07-06-claude-lite-summary-review-fixes.md`；交付报告 `.agent-workflow/delivery/2026-07-06-claude-lite-summary-review-fixes-delivery-report.md` |
| 主 Agent | PASS | Context restore TUI/restart fix：退出态历史回放和恢复 prompt 统一转为可读文本，保留运行中 TUI 原始控制序列；重启操作显示即时状态；新包 `release/packages/20260706-224846/AgentDock-darwin-arm64/AgentDock.app` codesign/marker/ccline/node-pty restore smoke 通过；验证记录 `.agent-workflow/verification/2026-07-06-context-restore-tui-restart-fix.md`；交付报告 `.agent-workflow/delivery/2026-07-06-context-restore-tui-restart-fix-delivery-report.md` |
| 主 Agent | PASS | AgentDock 分层记忆恢复：本地 restore context 文件、短读取指令注入、一句话恢复摘要、secret/正文不暴露；新包 `release/packages/20260707-062838/AgentDock-darwin-arm64/AgentDock.app`；验证记录 `.agent-workflow/verification/2026-07-07-agentdock-memory-restore-layering.md`；交付报告 `.agent-workflow/delivery/2026-07-07-agentdock-memory-restore-layering-delivery-report.md` |
| 主 Agent | PASS | 恢复体验与终端历史修复：去除自动继续任务指令、restore 文件只保留简短摘要、过滤 alternate-screen、修复 transcript append queue unhandled rejection |

状态只能使用：`READY / RUNNING / PASS / FAIL / BLOCKED / SKIPPED`

## 阻塞点
无

## 用户待确认
无

## 下一步
提交 Batch 6 恢复语义整合，然后执行最终全量验证、真实 CLI resume/fallback 复核、macOS package、codesign 和交付报告。

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
| 2026-07-04 | Batch A SPEC 已确认并进入实施计划 | 用户确认 Claude 5 个配置项、多窗口、安全打包为当前批次范围 |
| 2026-07-04 | Claude 默认启动采用轻量 MCP 隔离，完整模式可手动选择 | 用户要求启动前请求重量降到最低，同时明确禁止修改默认模型、`context-1m` beta 和重试配置 |
| 2026-07-04 | Batch A worktree 内有条件交付 | 分支内全量验证通过；合并主工作区前需保留并行 Claude lite/full MCP 行为 |
| 2026-07-04 | Batch A 与 Claude lite/full MCP 主分支集成通过 | 主分支验证保留模型映射、多窗口、时间戳打包和默认轻量 MCP 行为 |
| 2026-07-04 | Claude lite 模式排除 user settings | `--strict-mcp-config` 不能阻止 user 级 `enabledPlugins.engram@engram` 的 `UserPromptSubmit` hook，需用 `--setting-sources project,local` 排除 user 来源 |
| 2026-07-04 | Batch B 先落盘计划再开发 | 用户要求关闭窗口后也能从文件继续，计划文件为 `docs/plans/2026-07-04-agentdock-batch-b-workspace-shared-context.md` |
| 2026-07-04 | Workspace Shared Context 只写 workspace 本地 `.agentdock/context/` | 本批次目标是跨 Agent CLI 可读的本地上下文，不做云同步、自动 LLM 总结或修改用户项目 Agent 配置 |
| 2026-07-04 | 新保存 API Key 使用本机加密 `secrets.vault.json`，旧 Keychain 仅用于迁移/适配 | 减少本地/ad-hoc App 系统密码弹窗，同时保持不明文落盘和 IPC 不泄露 secret |
| 2026-07-04 | Agent CLI PATH 优先用户级安装目录 | 用户要求 AgentDock 内 Agent 会话跟随已更新 CLI；`~/.local/bin` 等用户级路径应先于 Homebrew，并在 `zsh -lc` 命令前重新导出 PATH |
| 2026-07-05 | vault v2 密钥材料不再混入 hostname 和 vault 目录字符串 | hostname 随网络漂移导致旧记录不可读；本地 vault 定位是稳定本机加密记录，不追求防本机攻击者 |
| 2026-07-05 | macOS 打包使用 `AgentDock Codesign` 自签名证书 | 避免 ad-hoc 签名 cdhash 每次变化导致 TCC 权限反复弹窗 |
| 2026-07-05 | 清理第一阶段执行后保留 `.agent-workflow/` 和 `docs/requirements/` | workflow CLI/测试仍依赖 `.agent-workflow/`；requirements 仍作为产品与架构背景 |
| 2026-07-05 | ccline 状态栏二进制随 App 内嵌，PATH 已安装版本优先 | 勾选状态栏后零依赖可用，无需手动 `npm install -g`；用户自装新版仍然优先生效；`optionalDependencies` 固定 1.1.2 保证非 darwin-arm64 环境安装不失败 |
| 2026-07-06 | 移除底部 5MB 本地回放提示，终端输出改为 per-session transcript 文件并使用 summary + 最近脱敏 tail 做续接材料 | 5MB 是本地存储保护不是 AI 上下文；大输出放在 `sessions.json` 中脆弱且容易误导用户；AI 续接应由摘要和近期上下文显式注入 |
| 2026-07-06 | 本项目 SPEC/PRD/设计文档/实施计划/交付报告默认中文优先；若先生成英文，必须同步 `.zh-CN.md` 中文版 | 用户明确要求后续每次写 SPEC 都提供中文文档，且中文版作为评审和实施依据 |
| 2026-07-07 | 记忆恢复采用分层存储：短期 transcript tail 快速保存，长期 summary/handoff 压缩落盘，重启时后台生成 restore context 文件并只注入短读取指令 | 用户明确要求输入窗口不要显示长提示词，只展示加载/恢复状态；恢复后摘要只用一句话 |
| 2026-07-07 | 长期会话库恢复策略采用 verified-native-first：Claude 优先探针 `--session-id`/`--resume`，Codex 必须先验证稳定 id 来源；不可验证时显式降级到 AgentDock restore context | 原生 resume 不能依赖脆弱 TUI 文本解析；Codex 当前 CLI 未暴露启动时指定 session id；必须避免静默伪装成原生恢复 |
| 2026-07-07 | 同一 Session Record 的 running PTY 同时只能有一个 owner window；其他窗口只能只读观察，不能抢占或启动第二个 PTY | 保留当前多窗口隔离安全边界，避免多个窗口同时写同一 Claude/Codex TUI |
| 2026-07-07 | 用户主动停止 PTY 使用正式 `stopped` 运行状态；`archived` 是独立归档标记，不是运行状态 | 现有 `SessionStatus` 已包含 `stopped`；主动停止、自然退出 `exited`、异常/重启中断 `interrupted` 在会话库中需要可区分 |
| 2026-07-07 | Batch 0 在主 worktree 直接整理并提交基线 `b9ee2bd` | 用户确认没有其他分支，要求把整个工程整理干净并提交；已排除并删除未跟踪构建产物和 SPEC 副本目录 |
| 2026-07-07 | Batch 1 native resume 决策：Codex native resume verified；Claude native resume partial | Codex `exec --json` 稳定输出 `thread_id` 且 `exec ... resume --json <thread_id>` 恢复 marker 成功；Claude help 有 `--session-id`/`--resume`，但 direct CLI 未登录，profile smoke 超时，未达到 verified 标准 |
| 2026-07-07 | Batch 2 生命周期语义确认：关闭视图不删除记录，停止 PTY 不删除记录，删除记录走显式危险操作，running owner 单窗口独占 | 这是后续左侧长期会话库和只读观察态的基础；避免多个窗口同时写同一 Claude/Codex TUI |

## 验证记录
| 时间 | 命令 | 结果 |
|------|------|------|
| 2026-07-07 | Batch 0 baseline：`git status --short` / `git diff --stat` / `git diff --check` / `npm run workflow:doctor` / `npm run test:workflow` / `npm run typecheck` / `npm test` / `npm run build` / secret-like scan | PASS：dirty worktree 已审阅；diff check 无输出；doctor PASS；workflow pytest 8 passed；typecheck PASS；Vitest 42 files / 271 tests PASS；build PASS，仅 Vite chunk size warning；源码限定 secret scan 无命中；需排除 `index-D3wM5j2Q.js` 和 `docs/superpowers/specs_副本/` |
| 2026-07-07 | `npx vitest run tests/app/nativeResumeProbe.test.ts` | RED then PASS：实现前因 `src/main/nativeResumeProbe` 不存在失败；实现后 1 file / 4 tests 通过 |
| 2026-07-07 | `claude --version` / `claude --help \| rg -- '--session-id\|--resume'` / Claude direct/profile smoke | PARTIAL：Claude 2.1.201 暴露 `--session-id` 与 `--resume`；direct CLI 未登录；`claude-custom-5` profile 普通 `--print` 与 `--session-id` smoke 超时 |
| 2026-07-07 | `codex --version` / `codex resume --help` / `codex exec resume --help` / Codex JSONL resume smoke | PASS：Codex 0.142.5；`codex exec --json` 捕获 `thread_id`；`codex exec --sandbox read-only --skip-git-repo-check --color never resume --json <thread_id>` 恢复 marker 成功 |
| 2026-07-07 | `npm run typecheck` / `npm test` / `git diff --check` / native probe secret-like scan | PASS：typecheck 通过；Vitest 43 files / 275 tests；diff check 无输出；secret-like scan 无命中 |
| 2026-07-07 | Batch 2 RED/GREEN：`npx vitest run tests/app/sessionRecordStore.test.ts` | PASS：closeView、archiveSession、deleteRecord 三个 store 行为先失败后通过 |
| 2026-07-07 | Batch 2 RED/GREEN：`npx vitest run tests/app/sessionService.test.ts -t "without deleting the session record\|closes a view\|archives and deletes session records\|prevents another window"` | PASS：stop-only、close view、archive/delete record、runtime owner 独占先失败后通过 |
| 2026-07-07 | `npx vitest run tests/app/sessionRecordStore.test.ts tests/app/sessionService.test.ts tests/app/sessionServiceTerminal.test.ts tests/app/preloadTypes.test.ts tests/app/sessionSecurity.test.ts tests/app/windowSessionRegistry.test.ts` | PASS：6 files / 47 tests |
| 2026-07-07 | `npm run typecheck` / `npm test` / `npm run build` / `git diff --check` | PASS：typecheck 通过；Vitest 44 files / 282 tests；build 通过，仅 Vite chunk size warning；diff check 无输出 |
| 2026-07-07 | Batch 3 RED/GREEN：`npx vitest run tests/app/App.test.tsx -t "workspace-grouped session library"` | PASS：实现前因 App 仍渲染横向 SessionTabs 失败；实现后通过 |
| 2026-07-07 | Batch 3 renderer：`npx vitest run tests/app/App.test.tsx` / `npm run typecheck` | PASS：App 67 tests；typecheck 通过 |
| 2026-07-07 | Batch 3 integration：`npm run workflow:doctor` / `npm run test:workflow` / `npm test` / `npm run build` / `git diff --check` / secret-like scan | PASS：doctor 全绿；workflow pytest 8 passed；Vitest 44 files / 285 tests；build 通过，仅 Vite chunk size warning；diff check 无输出；secret-like scan 无命中 |
| 2026-07-07 | Batch 4 RED/GREEN：`npx vitest run tests/app/layoutPolish.test.ts -t "project panel collapsed"` / `npx vitest run tests/app/App.test.tsx -t "right project panel"` | PASS：实现前分别因 CSS 约束和项目面板缺失失败；实现后通过 |
| 2026-07-07 | Batch 4 integration：`npm run workflow:doctor` / `npm run test:workflow` / `npm test` / `npm run build` / `git diff --check` / secret-like scan | PASS：doctor 全绿；workflow pytest 8 passed；Vitest 44 files / 287 tests；build 通过，仅 Vite chunk size warning；diff check 无输出；secret-like scan 无命中 |
| 2026-07-08 | Batch 5 RED/GREEN：`npx vitest run tests/app/workspaceFileTreeService.test.ts tests/app/sessionFileIndexStore.test.ts tests/app/preloadTypes.test.ts tests/app/App.test.tsx -t "read-only project file tree\|preloadTypes\|workspaceFileTreeService\|sessionFileIndexStore"` | PASS：实现前分别因模块缺失、preload 白名单缺失、右侧项目面板仍为 placeholder 失败；实现后 4 files / 8 tests 通过 |
| 2026-07-08 | Batch 5 integration：`npm run workflow:doctor` / `npm run test:workflow` / `npm test` / `npm run typecheck` / `npm run build` / `git diff --check` / secret-like scan | PASS：doctor 全绿；workflow pytest 8 passed；Vitest 46 files / 293 tests；typecheck 通过；build 通过，仅 Vite chunk size warning；diff check 无输出；secret-like scan 无命中 |
| 2026-07-08 | Batch 6 RED/GREEN：`npx vitest run tests/app/sessionService.test.ts -t "verified native resume"` / `npx vitest run tests/app/App.test.tsx -t "native resume separately"` | PASS：实现前 verified native metadata 仍走 AgentDock fallback、UI 误标为 fallback；实现后 native-first 和右侧 `原生 resume` 标识通过 |
| 2026-07-08 | Batch 6 integration：`npm run workflow:doctor` / `npm run test:workflow` / `npm test` / `npm run typecheck` / `npm run build` / `git diff --check` / secret-like scan | PASS：doctor 全绿；workflow pytest 8 passed；Vitest 46 files / 295 tests；typecheck 通过；build 通过，仅 Vite chunk size warning；diff check 无输出；secret-like scan 无命中 |
| 2026-07-07 | `claude --version` / `claude --help \| rg -- '--session-id\|--resume'` / `codex --version` / `codex resume --help` / `codex exec resume --help` | PASS：Claude CLI 2.1.201 暴露 `--session-id` 与 `--resume`；Codex CLI 0.142.5 暴露 `resume` / `exec resume`，但未暴露启动时指定 session id 参数；SPEC 已要求 Batch 1 真机探针 |
| 2026-07-07 | `rg -n "TBD\|TODO\|待定\|稍后\|以后再\|implement later\|fill in\|placeholder\|FIXME\|四个批次\|五个批次\|interupted" docs/superpowers/specs/2026-07-07-agentdock-session-library-terminal-first-ui-design.zh-CN.md docs/superpowers/plans/2026-07-07-agentdock-session-library-terminal-first-ui.md` / `git diff --check -- docs/superpowers/specs/2026-07-07-agentdock-session-library-terminal-first-ui-design.zh-CN.md docs/superpowers/plans/2026-07-07-agentdock-session-library-terminal-first-ui.md .agent-workflow/state.md` | PASS：状态枚举一致性修复后无占位词/旧批次数/`interupted` 拼写命中；diff check 无输出 |
| 2026-07-07 | `npm run test:workflow` / `npm run build` | PASS：workflow pytest 8 passed；build 通过，仅 Vite chunk size warning |
| 2026-07-07 | `rg -n "TBD\|TODO\|待定\|稍后\|以后再\|implement later\|fill in\|placeholder\|FIXME\|四个批次\|五个批次" docs/superpowers/specs/2026-07-07-agentdock-session-library-terminal-first-ui-design.zh-CN.md docs/superpowers/plans/2026-07-07-agentdock-session-library-terminal-first-ui.md` / `git diff --check -- docs/superpowers/specs/2026-07-07-agentdock-session-library-terminal-first-ui-design.zh-CN.md docs/superpowers/plans/2026-07-07-agentdock-session-library-terminal-first-ui.md .agent-workflow/state.md` | PASS：SPEC 和实施计划无占位词/旧批次数命中；diff check 无输出 |
| 2026-07-07 | `npm run workflow:doctor` / `npm run test:workflow` / `npm run typecheck` / `npm run build` | PASS：doctor 全绿；workflow pytest 8 passed；typecheck 通过；build 通过，仅 Vite chunk size warning |
| 2026-07-07 | `rg -n "TBD\|TODO\|待定\|稍后\|以后再\|implement later\|fill in\|placeholder\|FIXME\|四个批次" docs/superpowers/specs/2026-07-07-agentdock-session-library-terminal-first-ui-design.zh-CN.md` / `git diff --check -- docs/superpowers/specs/2026-07-07-agentdock-session-library-terminal-first-ui-design.zh-CN.md .agent-workflow/state.md` | PASS：SPEC 无占位词和已知矛盾词命中；本轮文件 diff check 无输出 |
| 2026-07-07 | `npm run workflow:doctor` / `npm run test:workflow` / `npm run typecheck` / `npm run build` | PASS：doctor 全绿；workflow pytest 8 passed；typecheck 通过；build 通过，仅 Vite chunk size warning |
| 2026-07-07 | `npx vitest run tests/app/TerminalPane.test.tsx -t "OSC query\|color replies"` / `npx vitest run tests/app/TerminalPane.test.tsx` | PASS：3 focused tests；TerminalPane 24 tests，覆盖 agent-only OSC query guard 和 live/replay color reply 过滤 |
| 2026-07-07 | real `@xterm/xterm@5.5.0` + JSDOM `Terminal.open()` OSC smoke | PASS：未加 guard 时 `OSC 10/11 ; ?` 产生 `ESC]10/11;rgb...ST`；加 guard 后 `onData` 输出为空数组 |
| 2026-07-07 | `npm test` / `npm run workflow:doctor` / `npm run typecheck` / `npm run build` / `git diff --check` | PASS：42 files / 271 tests；doctor/typecheck/build 通过；build 仅 Vite chunk size warning；diff check 无输出 |
| 2026-07-07 | `npx vitest run tests/app/restoreContextStore.test.ts tests/app/sessionService.test.ts tests/app/sessionSecurity.test.ts tests/app/App.test.tsx tests/app/TerminalPane.test.tsx` | PASS：5 files / 114 tests，覆盖短恢复指令、context 文件不含 transcript tail、UI 不暴露 restore prompt、agent 输出过滤 alternate-screen |
| 2026-07-07 | real xterm buffer script with `CSI ?1049h` before/after filtering | PASS：未过滤 `{baseY:0, viewportY:0}`；过滤后 `{baseY:30, viewportY:30}`，证明旧 scrollback 不再被 alternate buffer 隐藏 |
| 2026-07-07 | `npx vitest run tests/app/sessionTranscriptStore.test.ts` | PASS：1 file / 3 tests，覆盖 append 失败后队列恢复且无悬空 rejected tracking promise |
| 2026-07-07 | `npm run workflow:doctor` / `npm run test:workflow` | PASS：doctor 全绿；pytest 8 passed |
| 2026-07-07 | `npm test` | PASS：42 files / 266 tests，无 unhandled rejection |
| 2026-07-07 | `npm run typecheck` / `npm run build` | PASS：typecheck 通过；build 仅 Vite chunk size warning |
| 2026-07-07 | `git diff --check` | PASS |
| 2026-07-07 | `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run package:mac` | PASS：`release/packages/20260707-070932/AgentDock-darwin-arm64/AgentDock.app` |
| 2026-07-07 | `codesign --verify --deep --strict --verbose=2 release/packages/20260707-070932/AgentDock-darwin-arm64/AgentDock.app` / packaged marker scan | PASS：codesign valid；包内 restore prompt 等待用户、无 `continue the current task`；renderer 包含 alternate-screen filter |
| 2026-07-07 | `npx vitest run tests/app/sessionService.test.ts tests/app/sessionSecurity.test.ts -t "restore prompt\|restore context\|restore memory\|same session id"` | PASS：2 files / 6 tests，覆盖 Claude 使用 `--append-system-prompt` 且不再 `PTY.write` |
| 2026-07-07 | `npx vitest run tests/app/sessionService.test.ts -t "Codex restarts"` | PASS：1 file / 1 test，覆盖 Codex 仍走 CLI 初始 prompt 且不写 stdin |
| 2026-07-07 | `npx vitest run tests/app/restoreContextStore.test.ts tests/app/sessionService.test.ts tests/app/App.test.tsx tests/app/preloadTypes.test.ts tests/app/sessionSecurity.test.ts` | PASS：5 files / 95 tests |
| 2026-07-07 | `npm run workflow:doctor` / `npm test` / `npm run typecheck` / `npm run build` | PASS：doctor 全绿；42 files / 264 tests；typecheck 通过；build 仅 Vite chunk size warning |
| 2026-07-07 | real `node-pty` smoke using `dist/main/sessionService.js` + `createNodePtyAdapter()` | PASS：Claude 类型恢复 prompt 通过 `--append-system-prompt` 进入 argv；stdin 未出现恢复指令；memoryRestore status 为 `loaded` |
| 2026-07-07 | `git diff --check` | PASS |
| 2026-07-07 | `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run package:mac` | PASS：`release/packages/20260707-065311/AgentDock-darwin-arm64/AgentDock.app` |
| 2026-07-07 | `codesign --verify --deep --strict --verbose=2 release/packages/20260707-065311/AgentDock-darwin-arm64/AgentDock.app` / packaged marker scan | PASS：codesign valid；包内包含 `appendClaudeSystemPromptCommand`、`--append-system-prompt`、`appendInitialPromptCommand` 和 `restoreInstructionToInitialPrompt` |
| 2026-07-07 | `npx vitest run tests/app/restoreContextStore.test.ts tests/app/sessionService.test.ts tests/app/App.test.tsx tests/app/preloadTypes.test.ts tests/app/sessionSecurity.test.ts` | PASS：5 files / 94 tests |
| 2026-07-07 | `npm run workflow:doctor` / `npm run test:workflow` | PASS：doctor 全绿；pytest 8 passed |
| 2026-07-07 | `npm run typecheck` / `npm run build` | PASS：build 仅 Vite chunk size warning |
| 2026-07-07 | real `node-pty` restore context smoke using `dist/main/sessionService.js` + `createNodePtyAdapter()` | PASS：旧分层恢复批次验证；后续已由上方 `--append-system-prompt` / Codex 初始 prompt 验证取代 |
| 2026-07-07 | 本次相关文件 secret-like scan | PASS：仅命中固定环境变量名、短指令字符串和测试中模板拼接的假 key；无完整真实 key |
| 2026-07-07 | `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run package:mac` | PASS：`release/packages/20260707-062838/AgentDock-darwin-arm64/AgentDock.app` |
| 2026-07-07 | `codesign --verify --deep --strict --verbose=2 release/packages/20260707-062838/AgentDock-darwin-arm64/AgentDock.app` / packaged marker scan | PASS：codesign valid；包内包含 restore context 与 memory restore markers |
| 2026-07-06 | `npx vitest run tests/app/contextRestore.test.ts tests/app/TerminalPane.test.tsx tests/app/sessionService.test.ts` RED | PASS：实现前 4 个预期失败，覆盖 TUI 控制序列进入 restore prompt、退出态历史乱码、重启注入不可读 |
| 2026-07-06 | `npx vitest run tests/app/App.test.tsx -t "shows immediate feedback while restarting"` RED | PASS：实现前点击退出态重新启动没有即时状态反馈 |
| 2026-07-06 | `npx vitest run tests/app/App.test.tsx tests/app/contextRestore.test.ts tests/app/TerminalPane.test.tsx tests/app/sessionService.test.ts` | PASS：4 files / 105 tests |
| 2026-07-06 | `npm run workflow:doctor` / `npm run test:workflow` | PASS：doctor 全绿；pytest 8 passed |
| 2026-07-06 | `npm test` | PASS：41 files / 254 tests |
| 2026-07-06 | `npm run typecheck` / `npm run build` | PASS：build 仅 Vite chunk size warning |
| 2026-07-06 | `git diff --check` | PASS |
| 2026-07-06 | `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run package:mac` | PASS：`release/packages/20260706-224846/AgentDock-darwin-arm64/AgentDock.app` |
| 2026-07-06 | `codesign --verify --deep --strict --verbose=2 release/packages/20260706-224846/AgentDock-darwin-arm64/AgentDock.app` | PASS |
| 2026-07-06 | packaged app.asar marker scan / packaged ccline smoke | PASS：包内包含 `dist/shared/terminalText.js`、`contextRestore`、`sessionService`；`ccline 1.1.2` |
| 2026-07-06 | real `node-pty` restore prompt smoke with raw TUI transcript tail | PASS：真实 PTY 收到可读中文最近对话，不包含 ESC、ANSI 色码或 `Working(9s)` 临时状态 |
| 2026-07-06 | `npx vitest run tests/app/sessionService.test.ts tests/app/summaryContinuation.test.ts tests/app/summaryRunner.test.ts tests/app/App.test.tsx` RED | PASS：实现前 9 个预期失败，覆盖 lite 模式丢失、summary runner 隔离缺失和 UI 过滤缺失 |
| 2026-07-06 | `npx vitest run tests/app/sessionService.test.ts tests/app/summaryContinuation.test.ts tests/app/summaryRunner.test.ts tests/app/App.test.tsx` | PASS：4 files / 82 tests |
| 2026-07-06 | `npx vitest run tests/app/summaryRunner.test.ts` RED | PASS：实现前因 Codex runner 仍拼接当前 CLI 不支持的 `--ask-for-approval` 失败 |
| 2026-07-06 | `npx vitest run tests/app/summaryRunner.test.ts` RED | PASS：实现前因 Claude runner 缺少 provider 兼容的 `--effort high` 失败 |
| 2026-07-06 | `npx vitest run tests/app/summaryRunner.test.ts` | PASS：1 file / 3 tests |
| 2026-07-06 | `npm run workflow:doctor` / `npm run test:workflow` | PASS：doctor 全绿；pytest 8 passed |
| 2026-07-06 | `npm test` | PASS：最终复跑 39 files / 243 tests |
| 2026-07-06 | `npm run typecheck` / `npm run build` | PASS：build 仅 Vite chunk size warning |
| 2026-07-06 | `claude --help` / `codex exec --help` | PASS：Claude 支持 lite 隔离参数和 `--effort`；Codex 当前不支持 `--ask-for-approval`，旧参数已移除 |
| 2026-07-06 | Real Codex summary smoke (`codex-openai`) | PASS：summary validated OK，outputChars 3202，包含 `# AgentDock Session Summary` |
| 2026-07-06 | Real Claude direct CLI smoke (`claude-custom-5`) | PASS：同等 lite flags 5.2s 返回 `AGENTDOCK_OK` |
| 2026-07-06 | Real Claude summary smoke (`claude-custom-5`) | PASS：`createProfileSummaryRunner` 21.2s 返回合法 Markdown，`validateSummaryMarkdown` ok，outputChars 1700 |
| 2026-07-06 | Real Claude unavailable profile diagnostics | FAIL：`claude-custom-1` 返回 403 上游额度不足；`claude-anyrouter`、`claude-custom-2`、`claude-custom-3`、`claude-custom-4` 75s 无输出超时，需后续定位 provider/CLI |
| 2026-07-06 | `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run package:mac` | PASS：`release/packages/20260706-211053/AgentDock-darwin-arm64/AgentDock.app` |
| 2026-07-06 | `codesign --verify --deep --strict --verbose=2 release/packages/20260706-211053/AgentDock-darwin-arm64/AgentDock.app` | PASS |
| 2026-07-06 | packaged app.asar marker scan / packaged ccline smoke | PASS：summary runner strict MCP、summaryContinuation、terminalOutputSanitizer、sessionService sanitizer markers 存在；`ccline 1.1.2` |
| 2026-07-06 | `git diff --check` / 文档旧口径扫描 / touched 文件 key-like scan | PASS：无空白错误；聚焦旧矛盾口径无命中，宽扫描仅命中历史说明/验证记录文本；本次 touched 文件无真实 key-like 命中 |
| 2026-07-06 | `npx vitest run tests/app/summaryContinuation.test.ts` RED | PASS：实现前因 `src/main/summaryContinuation` 不存在而失败 |
| 2026-07-06 | `npx vitest run tests/app/summaryContinuation.test.ts` | PASS：1 file / 1 test |
| 2026-07-06 | `npx vitest run tests/app/summaryJobService.test.ts tests/app/sessionService.test.ts tests/app/App.test.tsx` | PASS：3 files / 79 tests |
| 2026-07-06 | `npm test` | PASS：38 files / 235 tests |
| 2026-07-06 | `npm run workflow:doctor` / `npm run test:workflow` | PASS：doctor 全绿；pytest 8 passed |
| 2026-07-06 | `npm run typecheck` / `npm run build` | PASS：build 仅 Vite chunk size warning |
| 2026-07-06 | `git diff --check` / summary continuation key-like scan | PASS：无空白错误；本次相关文件无 key-like 命中 |
| 2026-07-06 | real `node-pty` continuation prompt smoke using `dist/main/summaryContinuation.js` + `cat` | PASS：PTY output 包含 `/tmp/agentdock-handoff-smoke.md` |
| 2026-07-06 | `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run package:mac` | PASS：`release/packages/20260706-190128/AgentDock-darwin-arm64/AgentDock.app` |
| 2026-07-06 | `codesign --verify --deep --strict --verbose=2 release/packages/20260706-190128/AgentDock-darwin-arm64/AgentDock.app` | PASS |
| 2026-07-06 | packaged `app.asar` marker scan / packaged ccline smoke | PASS：包内包含 `summaryContinuation` / `launchContinuationWithPrompt`；`ccline 1.1.2` |
| 2026-07-06 | `claude --help` / `codex exec --help` | PASS：本机 CLI 存在，支持 one-shot summary runner 所需参数 |
| 2026-07-06 | `npx vitest run tests/app/summaryRunner.test.ts` RED | PASS：实现前因 `src/main/summaryRunner` 不存在而失败 |
| 2026-07-06 | `npx vitest run tests/app/summaryRunner.test.ts` | PASS：1 file / 3 tests |
| 2026-07-06 | `npx vitest run tests/app/summaryRunner.test.ts tests/app/summaryJobService.test.ts tests/app/sessionService.test.ts tests/app/sessionServiceTerminal.test.ts tests/app/App.test.tsx` | PASS：5 files / 92 tests |
| 2026-07-06 | `npm run workflow:doctor` / `npm run test:workflow` | PASS：doctor 全绿；pytest 8 passed |
| 2026-07-06 | `npm test` | PASS：37 files / 234 tests |
| 2026-07-06 | `npm run typecheck` / `npm run build` | PASS：build 仅 Vite chunk size warning |
| 2026-07-06 | `git diff --check` / summary runner key-like scan | PASS：无空白错误；本次 runner 相关文件无 key-like 命中 |
| 2026-07-06 | `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run package:mac` | PASS：`release/packages/20260706-010227/AgentDock-darwin-arm64/AgentDock.app` |
| 2026-07-06 | `codesign --verify --deep --strict --verbose=2 release/packages/20260706-010227/AgentDock-darwin-arm64/AgentDock.app` | PASS |
| 2026-07-06 | packaged `app.asar` marker scan | PASS：包含 `dist/main/summaryRunner.js`、`createProfileSummaryRunner`、Claude/Codex runner markers |
| 2026-07-05 | `npx vitest run tests/app/TerminalPane.test.tsx`（terminal live replay RED） | FAIL before：运行中 session replay 控制序列被过滤 |
| 2026-07-05 | `npx vitest run tests/app/TerminalPane.test.tsx`（terminal live replay） | PASS：16 tests |
| 2026-07-05 | `npx vitest run tests/app/App.test.tsx tests/app/TerminalPane.test.tsx` | PASS：2 files / 71 tests |
| 2026-07-05 | `npm run workflow:doctor`（terminal live replay） | PASS |
| 2026-07-05 | `npm test`（terminal live replay） | PASS：33 files / 215 tests |
| 2026-07-05 | `npm run typecheck`（terminal live replay） | PASS |
| 2026-07-05 | `npm run build`（terminal live replay） | PASS：仅 Vite chunk size warning |
| 2026-07-05 | `git diff --check`（terminal live replay） | PASS |
| 2026-07-05 | `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run package:mac` | PASS：`release/packages/20260705-223035/AgentDock-darwin-arm64/AgentDock.app` |
| 2026-07-05 | `codesign --verify --deep --strict --verbose=2 release/packages/20260705-223035/AgentDock-darwin-arm64/AgentDock.app` | PASS |
| 2026-07-05 | packaged renderer marker scan（terminal live replay） | PASS：包内 renderer 包含 `preserveHistory && readOnly ? ... : data` 逻辑 |
| 2026-07-05 | `npm run workflow:doctor` | PASS |
| 2026-07-05 | `npm run test:workflow` | PASS：8 passed |
| 2026-07-05 | `npm test` | PASS：30 files / 180 tests |
| 2026-07-05 | `npm run typecheck` | PASS |
| 2026-07-05 | `npm run build` | PASS：仅 Vite chunk size warning |
| 2026-07-05 | `codesign --verify --deep --strict --verbose=2 release/packages/20260705-020727/AgentDock-darwin-arm64/AgentDock.app` | PASS |
| 2026-07-05 | packaged app.asar marker scan | PASS：包含 vault v2 与 custom tooltip marker |
| 2026-07-05 | `git push` | PASS：`main -> origin/main` |
| 2026-07-05 | ccline 内嵌批次 worktree 验证 | PASS：typecheck、vitest、workflow、package、codesign、packaged ccline smoke、diff check 均通过 |
| 2026-07-05 | `npx vitest run tests/app/cclineLocator.test.ts tests/app/sessionService.test.ts tests/app/packageMacScript.test.ts` | PASS：3 files / 15 tests |
| 2026-07-05 | `npm test`（StatusLine 合并后） | PASS：31 files / 187 tests |
| 2026-07-05 | `npm run workflow:doctor` / `npm run test:workflow`（StatusLine 合并后） | PASS：doctor 全绿；pytest 8 passed |
| 2026-07-05 | `npm run typecheck` / `npm run build`（StatusLine 合并后） | PASS：build 仅 Vite chunk size warning |
| 2026-07-05 | `npm run package:mac`（StatusLine 合并后） | PASS：`release/packages/20260705-132413/AgentDock-darwin-arm64/AgentDock.app` |
| 2026-07-05 | packaged ccline smoke（StatusLine 合并后） | PASS：`app.asar.unpacked/.../@cometix/ccline-darwin-arm64/ccline --version` 输出 `ccline 1.1.2` |
| 2026-07-05 | `npx vitest run tests/app/metadataStores.test.ts tests/app/configMigration.test.ts`（CCometixLine 保存修复） | PASS：修复前 RED 命中保存后丢字段，修复后 2 files / 24 tests |
| 2026-07-05 | `npx vitest run tests/app/App.test.tsx tests/app/sessionService.test.ts tests/app/cclineLocator.test.ts tests/app/packageMacScript.test.ts tests/app/metadataStores.test.ts tests/app/configMigration.test.ts` | PASS：6 files / 86 tests |
| 2026-07-05 | `npm test`（CCometixLine 保存修复） | PASS：31 files / 188 tests |
| 2026-07-05 | `npm run workflow:doctor` / `npm run typecheck` / `npm run build`（CCometixLine 保存修复） | PASS：build 仅 Vite chunk size warning |
| 2026-07-05 | `npm run package:mac`（CCometixLine 保存修复） | PASS：`release/packages/20260705-163705/AgentDock-darwin-arm64/AgentDock.app` |
| 2026-07-05 | `codesign --verify --deep --strict --verbose=2 release/packages/20260705-163705/AgentDock-darwin-arm64/AgentDock.app` | PASS |
| 2026-07-05 | packaged ccline smoke / app.asar marker scan（CCometixLine 保存修复） | PASS：`ccline 1.1.2`；包内 main/profileStore 包含 `claudeCclineStatusLineEnabled` |
| 2026-07-05 | `npx vitest run tests/app/metadataStores.test.ts tests/app/sessionService.test.ts tests/app/App.test.tsx tests/app/preloadTypes.test.ts` | PASS：4 files / 70 tests |
| 2026-07-05 | `npx vitest run tests/app/sessionServiceTerminal.test.ts tests/app/sessionService.test.ts` | PASS：2 files / 20 tests |
| 2026-07-05 | `npm run typecheck` | PASS |
| 2026-07-05 | `npm test`（退出态/历史持久化/CCometixLine 默认开启） | PASS：32 files / 199 tests |
| 2026-07-05 | `npm run workflow:doctor` | PASS |
| 2026-07-05 | `npm run build`（退出态/历史持久化/CCometixLine 默认开启） | PASS：仅 Vite chunk size warning |
| 2026-07-05 | `npm run package:mac`（退出态/历史持久化/CCometixLine 默认开启） | PASS：`release/packages/20260705-172808/AgentDock-darwin-arm64/AgentDock.app` |
| 2026-07-05 | `codesign --verify --deep --strict --verbose=2 release/packages/20260705-172808/AgentDock-darwin-arm64/AgentDock.app` | PASS |
| 2026-07-05 | packaged ccline smoke / app.asar marker scan（退出态/历史持久化/CCometixLine 默认开启） | PASS：`ccline 1.1.2`；包内包含 session history markers |
| 2026-07-05 | 本机 `sessions.json` parse 检查 | FAIL before：`Unexpected non-whitespace character after JSON at position 2882` |
| 2026-07-05 | `npx vitest run tests/app/metadataStores.test.ts`（session history 损坏修复） | PASS：8 tests |
| 2026-07-05 | `npx vitest run tests/app/metadataStores.test.ts tests/app/sessionService.test.ts tests/app/App.test.tsx tests/app/preloadTypes.test.ts` | PASS：4 files / 72 tests |
| 2026-07-05 | `npm run typecheck`（session history 损坏修复） | PASS |
| 2026-07-05 | `npm test`（session history 损坏修复） | PASS：32 files / 201 tests |
| 2026-07-05 | `npm run workflow:doctor` / `npm run build`（session history 损坏修复） | PASS：build 仅 Vite chunk size warning |
| 2026-07-05 | `npm run package:mac`（session history 损坏修复） | PASS：`release/packages/20260705-174749/AgentDock-darwin-arm64/AgentDock.app` |
| 2026-07-05 | `codesign --verify --deep --strict --verbose=2 release/packages/20260705-174749/AgentDock-darwin-arm64/AgentDock.app` | PASS |
| 2026-07-05 | packaged ccline smoke / app.asar marker scan（session history 损坏修复） | PASS：`ccline 1.1.2`；包内包含 recovery markers |
| 2026-07-05 | 本机坏 `sessions.json` 恢复 smoke | PASS：`beforeOk: false`、`afterOk: true`、`recoveredSessionCount: 1`、`corruptBackups: 1` |
| 2026-07-04 | `npm run typecheck`（审查修复批次收尾后） | PASS |
| 2026-07-04 | `npx vitest run`（审查修复批次收尾后） | PASS：30 files / 177 tests |
| 2026-07-04 | `npm run test -- tests/app/ptyAdapter.test.ts` RED | PASS：新增 PATH 测试先失败，证明旧实现命中 Homebrew 优先顺序 |
| 2026-07-04 | `npm run test -- tests/app/ptyAdapter.test.ts` | PASS：1 file / 8 tests |
| 2026-07-04 | `npm run test` | PASS：30 files / 159 tests |
| 2026-07-04 | `npm run workflow:doctor` | PASS |
| 2026-07-04 | `npm run typecheck` | PASS |
| 2026-07-04 | `npm run build` | PASS：仅 Vite chunk size warning |
| 2026-07-04 | real `node-pty` Claude PATH smoke | PASS：`command -v claude` 输出 `/Users/peyoba/.local/bin/claude`，版本 `2.1.201 (Claude Code)` |
| 2026-07-04 | `npm run package:mac` | PASS：`release/packages/20260704-193715/AgentDock-darwin-arm64/AgentDock.app` |
| 2026-07-04 | `codesign --verify --deep --strict --verbose=2 release/packages/20260704-193715/AgentDock-darwin-arm64/AgentDock.app` | PASS |
| 2026-07-04 | packaged app.asar PATH logic scan | PASS：包内 `dist/main/adapters/ptyAdapter.js` 包含 `.local`、`.npm-global` 和 `export PATH` |
| 2026-07-04 | Keychain hard-constraint wording scan | PASS：AGENTS、README、PROJECT_PROFILE、DECISIONS、PROJECT_REQUIREMENTS、state 无旧硬约束残留 |
| 2026-07-04 | `npm run workflow:doctor` | PASS |
| 2026-07-04 | `npm run typecheck` | PASS |
| 2026-07-04 | `npm run build` | PASS：仅 Vite chunk size warning |
| 2026-07-04 | `npm run test -- tests/app/TerminalPane.test.tsx` | PASS：1 file / 9 tests |
| 2026-07-04 | `npm run test -- tests/app/layoutPolish.test.ts tests/app/TerminalPane.test.tsx` | PASS：2 files / 14 tests |
| 2026-07-04 | `npm run test:workflow` | PASS：8 passed |
| 2026-07-04 | `codesign --verify --deep --strict --verbose=2 release/packages/20260704-183345/AgentDock-darwin-arm64/AgentDock.app` | PASS |
| 2026-07-04 | `npm run test` | PASS：30 files / 156 tests |
| 2026-07-04 | `npm run workflow:doctor` | PASS |
| 2026-07-04 | `npm run test:workflow` | PASS：8 passed |
| 2026-07-04 | `npm run typecheck` | PASS |
| 2026-07-04 | `npm run build` | PASS：仅 Vite chunk size warning |
| 2026-07-04 | real `node-pty` + `zsh` workspace context smoke | PASS：`agentdock-context-smoke` 写入 `.agentdock/context/shared-context.md`，无 key/token/env secret 标记 |
| 2026-07-04 | `npm run package:mac` | PASS：`release/packages/20260704-173315/AgentDock-darwin-arm64/AgentDock.app` |
| 2026-07-04 | `codesign --verify --deep --strict --verbose=2 release/packages/20260704-173315/AgentDock-darwin-arm64/AgentDock.app` | PASS |
| 2026-07-04 | key/token 模式扫描 | PASS：当前 diff 和未跟踪文件无输出 |
| 2026-07-04 | `npm run test -- tests/app/TerminalPane.test.tsx` | PASS：1 file / 9 tests |
| 2026-07-04 | `npm run test -- tests/app/layoutPolish.test.ts tests/app/TerminalPane.test.tsx` | PASS：2 files / 14 tests |
| 2026-07-04 | `npm run typecheck` | PASS |
| 2026-07-04 | `npm run workflow:doctor` | PASS |
| 2026-07-04 | `npm run build` | PASS：仅 Vite chunk size warning |
| 2026-07-04 | `npm run package:mac` | PASS：`release/packages/20260704-182834/AgentDock-darwin-arm64/AgentDock.app` |
| 2026-07-04 | `codesign --verify --deep --strict --verbose=2 release/packages/20260704-182834/AgentDock-darwin-arm64/AgentDock.app` | PASS |
| 2026-07-04 | `npm run test -- tests/app/sessionService.test.ts` | PASS：5 tests |
| 2026-07-04 | `npm run test -- tests/app/App.test.tsx` | PASS：44 tests |
| 2026-07-04 | `npm run test` | PASS：29 files / 149 tests |
| 2026-07-04 | `npm run workflow:doctor` | PASS |
| 2026-07-04 | `npm run test:workflow` | PASS：8 passed |
| 2026-07-04 | `npm run typecheck` | PASS |
| 2026-07-04 | `npm run build` | PASS：仅 Vite chunk size warning |
| 2026-07-04 | `claude --help` setting sources 参数检查 | PASS：支持 `--setting-sources`、`--mcp-config`、`--strict-mcp-config` |
| 2026-07-04 | `npm run package:mac` | PASS：`release/packages/20260704-142744/AgentDock-darwin-arm64/AgentDock.app` |
| 2026-07-04 | `codesign --verify --deep --strict --verbose=2 release/packages/20260704-142744/AgentDock-darwin-arm64/AgentDock.app` | PASS |
| 2026-07-04 | packaged app.asar scan | PASS：包含 `--setting-sources project,local`、`--strict-mcp-config` |
| 2026-07-04 | `rg -n "<<<<<<<\|=======\|>>>>>>>" . src tests \|\| true` | PASS：无冲突标记 |
| 2026-07-04 | `npm run test -- tests/app/sessionService.test.ts tests/app/App.test.tsx tests/app/preloadTypes.test.ts tests/app/windowSessionRegistry.test.ts tests/app/packageMacScript.test.ts` | PASS：5 files / 54 tests |
| 2026-07-04 | `npm run typecheck` | PASS |
| 2026-07-04 | `npm run test` | PASS：29 files / 149 tests |
| 2026-07-04 | `npm run workflow:doctor` | PASS |
| 2026-07-04 | `npm run test:workflow` | PASS：8 passed |
| 2026-07-04 | `npm run build` | PASS：仅 Vite chunk size warning |
| 2026-07-04 | `npm run package:mac` | PASS：`release/packages/20260704-134324/AgentDock-darwin-arm64/AgentDock.app` |
| 2026-07-04 | `codesign --verify --deep --strict --verbose=2 release/packages/20260704-134324/AgentDock-darwin-arm64/AgentDock.app` | PASS |
| 2026-07-04 | `command -v claude` / `claude --help` MCP 参数检查 | PASS：本机 Claude CLI 存在，且支持 `--mcp-config`、`--strict-mcp-config` |
| 2026-07-04 | packaged multi-window zsh smoke via CDP | PASS：两个窗口各 1 个 session，输出不串窗 |
| 2026-07-04 | `git diff --check` | PASS |
| 2026-07-04 | key/token 模式扫描 | PASS：当前变更和未跟踪文件无命中 |
| 2026-07-04 | `npm run test` | PASS：27 files / 138 tests |
| 2026-07-04 | `npm run workflow:doctor` | PASS |
| 2026-07-04 | `npm run test:workflow` | PASS：8 passed |
| 2026-07-04 | `npm run typecheck` | PASS |
| 2026-07-04 | `npm run build` | PASS：存在 Vite chunk size warning，非失败 |
| 2026-07-04 | `command -v claude` / `claude --help` MCP 参数检查 | PASS：本机 Claude CLI 存在，且支持 `--mcp-config`、`--strict-mcp-config` |
| 2026-07-04 | `git diff --check` | PASS |
| 2026-07-04 | key-like secret scan | PASS：本次变更文件无真实 key 命中 |
| 2026-07-04 | `npm run test` | PASS：29 files / 146 tests |
| 2026-07-04 | `npm run workflow:doctor` | PASS |
| 2026-07-04 | `npm run test:workflow` | PASS：8 passed |
| 2026-07-04 | `npm run typecheck` | PASS |
| 2026-07-04 | `npm run build` | PASS：仅 Vite chunk size warning |
| 2026-07-04 | `npm run package:mac` | PASS：`release/packages/20260704-120943/AgentDock-darwin-arm64/AgentDock.app` |
| 2026-07-04 | `codesign --verify --deep --strict --verbose=2 release/packages/20260704-120943/AgentDock-darwin-arm64/AgentDock.app` | PASS |
| 2026-07-04 | packaged multi-window zsh smoke via CDP | PASS：两个窗口各 1 个 session，输出不串窗 |
| 2026-07-04 | compiled SessionService Claude settings smoke | PASS：模型映射与 Thinking 存在，fake secret 未进入 settings |
| 2026-07-04 | `git diff --check` | PASS |
| 2026-07-04 | key/token 模式扫描 | PASS：当前变更和未跟踪文件无命中 |
| 2026-07-04 | `npm run test && npm run workflow:doctor && npm run test:workflow && npm run typecheck && npm run build` | PASS：27 files / 135 tests；workflow 8 passed；build 仅 Vite chunk size warning |
| 2026-07-04 | `git diff --check` | PASS |
| 2026-07-04 | key-like secret scan | PASS：当前变更和未跟踪文件无命中 |
| 2026-07-04 | `npm run test` | PASS：26 files / 131 tests |
| 2026-07-04 | `npm run workflow:doctor` | PASS |
| 2026-07-04 | `npm run test:workflow` | PASS：8 passed |
| 2026-07-04 | `npm run typecheck` | PASS |
| 2026-07-04 | `npm run build` | PASS：存在 Vite chunk size warning，非失败 |
| 2026-07-04 | `git diff --check` | PASS |
| 2026-07-04 | key-like secret scan | PASS：源码与成品均无命中 |
| 2026-07-04 | `electron-packager` 新目录打包 | PASS：`/private/tmp/agentdock-package-20260704-000803/AgentDock-darwin-arm64/AgentDock.app` |
| 2026-07-04 | local package codesign verify | PASS：`codesign --verify --deep --strict --verbose=2` |
| 2026-07-04 | packaged pseudo model scan | PASS：成品不含 `defaultModel: "opus[1m]"` 或 `model: "opus[1m]"` |
| 2026-07-04 | local profileStore read verification | PASS：AnyRouter Claude profiles 返回真实可选模型，`hasLegacyOpusAlias: false` |
| 2026-07-03 | `npm run test` | PASS：26 files / 130 tests |
| 2026-07-03 | `npm run workflow:doctor` | PASS |
| 2026-07-03 | `npm run test:workflow` | PASS：8 passed |
| 2026-07-03 | `npm run typecheck` | PASS |
| 2026-07-03 | `npm run build` | PASS：存在 Vite chunk size warning，非失败 |
| 2026-07-03 | `git diff --check` | PASS |
| 2026-07-03 | key-like secret scan | PASS：源码与成品均无命中 |
| 2026-07-03 | `electron-packager` 新目录打包 | PASS：`/private/tmp/agentdock-package-20260703-235150/AgentDock-darwin-arm64/AgentDock.app` |
| 2026-07-03 | local package codesign verify | PASS：`codesign --verify --deep --strict --verbose=2` |
| 2026-07-03 | packaged Desktop path scan | PASS：成品 `app.asar` 不含 `/Users/peyoba/Desktop` 或 `Desktop/web/AgentDock` |
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
| 2026-07-02 | `npm run test -- sessionServiceTerminal terminalIpcTypes` | PASS：2 files / 4 tests |
| 2026-07-02 | `npm run build` | PASS |
| 2026-07-02 | `npm run test` | PASS：11 files / 20 tests |
| 2026-07-02 | `npm run workflow:doctor` | PASS |
| 2026-07-02 | `npm run test:workflow` | PASS：8 passed |
| 2026-07-02 | `git diff --check` | PASS |
| 2026-07-02 | API Key input clarity | PASS：配置页显示 `API Key（保存到 macOS 钥匙串）` 密码框和留空保留当前 Key 说明 |
| 2026-07-02 | packaged Codex PATH lookup | PASS：PTY PATH 补齐 `~/.npm-global/bin` 等用户 CLI 路径；成品 App `command -v codex` 输出 `/Users/peyoba/.npm-global/bin/codex` |
| 2026-07-02 | `npm run test` | PASS：17 files / 47 tests |
| 2026-07-02 | `npm run build` | PASS |
| 2026-07-02 | `npm run package:mac` | PASS：重新生成 `release/AgentDock-darwin-arm64/AgentDock.app` |
| 2026-07-02 | packaged API key and Codex PATH smoke | PASS：remote debugging 验证 API Key 输入框和 packaged shell Codex PATH |
| 2026-07-02 | `npm run workflow:doctor` | PASS |
| 2026-07-02 | `npm run test:workflow` | PASS：8 passed |
| 2026-07-02 | `git diff --check` | PASS |
| 2026-07-02 | Phase 2 total verification | PASS：workflow doctor、workflow tests、app tests、build、key-like scan |
| 2026-07-02 | Safe end-to-end SessionService verification | PASS：real Keychain + real PTY + local command; returned payload contains no test secret |
| 2026-07-02 | Renderer launch flow tests | PASS：App launch IPC and safe error behavior covered |
| 2026-07-02 | Session launch failure safety tests | PASS：15 files / 29 tests、build、workflow、diff check |
| 2026-07-02 | `npm run test -- keychainAdapter ptyAdapter` | PASS：2 files / 4 tests |
| 2026-07-02 | `npm run build` | PASS |
| 2026-07-02 | Real Keychain verification | PASS：test service/account write/read/delete; no real API key |
| 2026-07-02 | Real node-pty verification | PASS：local `printf agentdock-pty-ok`; no real API key |
| 2026-07-02 | `npm run test -- keychainAdapter ptyAdapter` | PASS：2 files / 4 tests |
| 2026-07-02 | `npm run build` | PASS |
| 2026-07-02 | `npm run test` | PASS：14 files / 25 tests |
| 2026-07-02 | `npm run workflow:doctor` | PASS |
| 2026-07-02 | `npm run test:workflow` | PASS：8 passed |
| 2026-07-02 | `git diff --check` | PASS |
| 2026-07-02 | `npm run test -- TerminalPane` | PASS：1 file / 1 test |
| 2026-07-02 | `npm run build` | PASS |
| 2026-07-02 | `npm run test` | PASS：12 files / 21 tests |
| 2026-07-02 | `npm run workflow:doctor` | PASS |
| 2026-07-02 | `npm run test:workflow` | PASS：8 passed |
| 2026-07-02 | `git diff --check` | PASS |

| 2026-07-02 | `npm run package:mac` | PASS：生成本地 ad-hoc signed App；原生模块 unpack 检查通过 |
| 2026-07-02 | macOS package validation | PASS：codesign verify、app.asar 内容、node-pty/keytar unpack、Gatekeeper expected reject |

| 2026-07-02 | packaged App white-screen fix | PASS：Vite `base: './'` 修复 file:// 下 `/assets` 绝对路径导致的白屏；packaged DOM 冒烟通过 |
| 2026-07-02 | `npm run test` | PASS：16 files / 31 tests |

| 2026-07-02 | renderer interaction completion | PASS：命令选择、API 类型过滤、配置卡片选择、加号启动、关闭 tab、动态详情已接状态/IPC |
| 2026-07-02 | packaged UI interaction smoke | PASS：成品 App 中点击 Codex 过滤与配置卡片选择生效 |

| 2026-07-02 | System AnyRouter API key test | PARTIAL PASS：`/v1/models` 鉴权成功 16 models；模型调用返回上游 Service Unavailable/配置提示 |
| 2026-07-02 | AgentDock AnyRouter endpoint config | PASS：Claude CLI base URL 修正为 `https://anyrouter.top`，避免 `/v1/v1/messages` |

| 2026-07-02 | API config editing | PASS：可编辑名称、工具类型、Base URL、默认模型、Keychain 引用、Codex Home；保存走 `profiles:save` IPC 并影响 launch profile |
| 2026-07-02 | packaged API config editing smoke | PASS：成品 App 表单存在、保存提示出现、未暴露 secret/env 字段名 |
| 2026-07-02 | API config page plan alignment | PASS：默认终端工作台不再内嵌配置；顶部“接口配置”打开独立配置页；“返回终端工作台”回到主界面 |
| 2026-07-02 | API multi-profile creation | PASS：新增配置生成唯一 profile id 和唯一 Keychain Account，可保存不同 Base URL/API Key |
| 2026-07-02 | Codex Home preparation | PASS：`~/...` 展开为绝对路径，并在启动 Codex 前创建 `CODEX_HOME` 目录 |
| 2026-07-02 | `npm run test` | PASS：17 files / 46 tests |
| 2026-07-02 | `npm run build` | PASS |
| 2026-07-02 | `npm run package:mac` | PASS：重新生成 `release/AgentDock-darwin-arm64/AgentDock.app` |
| 2026-07-02 | packaged API config page smoke | PASS：remote debugging 验证默认主界面、进入独立 API 配置页、返回终端工作台 |
| 2026-07-02 | `npm run workflow:doctor` | PASS |
| 2026-07-02 | `npm run test:workflow` | PASS：8 passed |
| 2026-07-02 | `git diff --check` | PASS |

## 批次进展
| 批次 | 状态 | 产出 |
|------|------|------|
| CCometixLine Embedded Binary | PASS | ccline 1.1.2 随包内嵌（`asar.unpack`）、PATH 已安装版本优先、statusLine 绝对路径 + shell 安全引号；worktree 分支 `worktree-ccline-embed` 已合并到 `main` |
| Claude Lite MCP Launch Mode | PASS | 默认轻量空 MCP 启动、完整 MCP 模式可选；验证记录 `.agent-workflow/verification/2026-07-04-claude-lite-mcp-launch-mode.md`；交付报告 `.agent-workflow/delivery/2026-07-04-claude-lite-mcp-launch-mode-delivery-report.md` |
| Batch A Claude Models / Multi-window / Timestamp Package | PASS | 分支内验证通过；交付报告 `.agent-workflow/delivery/2026-07-04-agentdock-batch-a-delivery-report.md`；合并并行 Claude lite/full MCP 改动后需二次验证 |
| Batch A + Claude Lite MCP Integration | PASS | 主分支合并验证通过；验证记录 `.agent-workflow/verification/2026-07-04-batch-a-claude-lite-integration.md`；交付报告 `.agent-workflow/delivery/2026-07-04-batch-a-claude-lite-integration-delivery-report.md` |
| Batch B Workspace Shared Context | PASS | workspace 本地 `.agentdock/context/`、PTY context env 注入、输出脱敏记录、renderer 查看入口；验证记录 `.agent-workflow/verification/2026-07-04-agentdock-batch-b-workspace-shared-context.md`；交付报告 `.agent-workflow/delivery/2026-07-04-agentdock-batch-b-workspace-shared-context-delivery-report.md` |
| Terminal Scrollbar Drag | PASS | 终端右侧可拖动 scroll thumb；验证记录 `.agent-workflow/verification/2026-07-04-terminal-scrollbar-drag.md`；交付报告 `.agent-workflow/delivery/2026-07-04-terminal-scrollbar-drag-delivery-report.md` |
| Phase 1 Batch 1 | PASS | 测试框架、共享类型、密钥脱敏、Claude/Codex 启动环境生成；验证记录 `.agent-workflow/verification/2026-07-02-phase-1-batch-1.md` |
| Phase 1 Batch 2 | PASS | Keychain/PTY adapter contracts、Profile/Workspace metadata stores、preload IPC 安全边界；验证记录 `.agent-workflow/verification/2026-07-02-phase-1-batch-2.md` |
| Phase 1 Batch 3 | PASS | 终端优先 Renderer、UI 行为测试、内存 session orchestration；验证记录 `.agent-workflow/verification/2026-07-02-phase-1-batch-3.md` |
| Phase 1 MVP Foundation | PASS | 总验证记录 `.agent-workflow/verification/2026-07-02-agentdock-phase-1-mvp-foundation.md` |
| Phase 2 Plan | PASS | SPEC 与计划已创建；真实集成前等待确认 |
| Phase 2 Task 1 | PASS | `SessionService` 支持 fake Keychain/PTTY adapter 注入、构建 env 并 spawn fake PTY；返回/list 只暴露安全 metadata |
| Phase 2 Task 4（fake IPC/control） | PASS | `SessionService` 支持 terminal write/resize/kill/output 订阅；preload whitelist 增加 terminal API；IPC payload 不暴露 secret/env |
| Phase 2 Task 5（xterm binding） | PASS | `TerminalPane` 为 active session 创建 xterm；xterm input/resize 通过 preload IPC 发送；terminal output 按 sessionId 写入 xterm；unmount 清理订阅与 terminal instance |
| Phase 2 Task 2/3（real adapters） | PASS | `createKeytarAdapter` 使用真实 keytar；`createNodePtyAdapter` 使用真实 node-pty 并确保 Unix spawn-helper 可执行；验证记录 `.agent-workflow/verification/2026-07-02-phase-2-real-keychain-pty.md` |
| Phase 2 Real Terminal & Keychain | PASS | 总验证与安全端到端验证记录 `.agent-workflow/verification/2026-07-02-phase-2-real-terminal-keychain.md`；真实 API key / CLI 账号未验证（未授权） |
| Renderer launch flow | PASS | 验证记录 `.agent-workflow/verification/2026-07-02-renderer-launch-flow.md`；启动按钮已接真实 preload IPC |
| Session launch failure safety | PASS | 验证记录 `.agent-workflow/verification/2026-07-02-session-launch-failure-safety.md`；缺 workspace/PTY fail 不泄露 secret/env |
| macOS local package | PASS | 产物 `release/AgentDock-darwin-arm64/AgentDock.app`；验证记录 `.agent-workflow/verification/2026-07-02-macos-local-package.md`；仅本地 ad-hoc 签名，未 notarize |
| Renderer MVP interactions | PASS | 命令栏 select、API 配置筛选/选择、加号启动、关闭会话、动态详情；验证记录 `.agent-workflow/verification/2026-07-02-macos-local-package.md` |
| Real AnyRouter key smoke | PARTIAL PASS | 系统 `ANYROUTER_API_KEY` 已写入 Keychain `AgentDock/claude-anyrouter`；models 鉴权成功；上游模型调用暂不可用；默认 endpoint 修正为 `https://anyrouter.top` |
| API Config Editing MVP | PASS | 接口配置编辑表单、`saveProfile` preload API、主进程 profileStore 保存、launch 读取保存后配置；验证记录 `.agent-workflow/verification/2026-07-02-macos-local-package.md` |
| API Config Page Alignment | PASS | 按计划改为独立配置页面/视图；支持多 profile 新增与独立 Keychain Account；验证记录 `.agent-workflow/verification/2026-07-02-macos-local-package.md` |
| Codex Home Launch Fix | PASS | `CODEX_HOME` 展开 `~` 并自动创建目录，避免 Codex CLI 启动前报路径不存在 |
| API Key Input Clarity | PASS | 配置页明确显示 API Key 密码框，本机加密保存，留空保留当前 Key |
| Packaged Codex PATH Fix | PASS | 打包 App 的 PTY 环境补齐用户 CLI PATH，解决 `zsh:1: command not found: codex` |
| 2026-07-02 | Keychain prompt mitigation | PASS：主进程缓存同一 App 运行期间已读取/写入的 secret，减少重复 macOS 系统密码弹窗；不通过 renderer/IPC 暴露 secret/env |
| 2026-07-02 | `npm run test` | PASS：17 files / 50 tests |
| 2026-07-02 | `npm run build` | PASS |
| 2026-07-02 | `npm run package:mac` | PASS：重新生成 `release/AgentDock-darwin-arm64/AgentDock.app` |
| 2026-07-02 | `npm run workflow:doctor` | PASS |
| 2026-07-02 | `npm run test:workflow` | PASS：8 passed |
| 2026-07-02 | `git diff --check` | PASS |
| 2026-07-02 | macOS window move/resize fix | PASS：自定义标题栏增加 drag/no-drag 区域；BrowserWindow 显式 resizable 且最小尺寸降为 720x480；打包 app.asar 已确认包含修复 |
| 2026-07-02 | `npm run test` | PASS：18 files / 52 tests |
| 2026-07-02 | `npm run build` | PASS |
| 2026-07-02 | `npm run package:mac` | PASS：重新生成 `release/AgentDock-darwin-arm64/AgentDock.app` |
| 2026-07-02 | packaged window chrome smoke | PASS：app.asar 包含 720x480/resizable true 和 app-region drag/no-drag CSS |
| 2026-07-02 | `npm run workflow:doctor` | PASS |
| 2026-07-02 | `npm run test:workflow` | PASS：8 passed |
| 2026-07-02 | `git diff --check` | PASS |
| 2026-07-02 | Workspace path picker | PASS：主界面工作区下拉旁新增“选择路径”；首次目录选择后保存到 `workspaces.json` 并立即选中，下次 `workspaces:list` 可直接选择 |
| 2026-07-02 | `npm run test` | PASS：19 files / 55 tests |
| 2026-07-02 | `npm run build` | PASS |
| 2026-07-02 | `npm run package:mac` | PASS：重新生成 `release/AgentDock-darwin-arm64/AgentDock.app` |
| 2026-07-02 | packaged workspace picker smoke | PASS：app.asar 包含 `workspaces:choose`、目录选择器、preload `chooseWorkspace`、renderer “选择路径”按钮、workspaceStore/workspaceService |
| 2026-07-02 | `npm run workflow:doctor` | PASS |
| 2026-07-02 | `npm run test:workflow` | PASS：8 passed |
| 2026-07-02 | `git diff --check` | PASS |
| 2026-07-02 | API config advanced fields UX | PASS：默认隐藏配置 ID/Keychain/Codex Home；高级设置展开后内部字段只读；Codex Home 仅 Codex 配置显示 |
| 2026-07-02 | `npm run test` | PASS：19 files / 57 tests |
| 2026-07-02 | `npm run build` | PASS |
| 2026-07-02 | `npm run package:mac` | PASS：重新生成 `release/AgentDock-darwin-arm64/AgentDock.app` |
| 2026-07-02 | packaged API advanced fields smoke | PASS：app.asar 包含“显示/隐藏高级设置”、高级说明和 readOnly 逻辑 |
| 2026-07-02 | `npm run workflow:doctor` | PASS |
| 2026-07-02 | `npm run test:workflow` | PASS：8 passed |
| 2026-07-02 | `git diff --check` | PASS |
| 2026-07-02 | Main UI visible redesign | PASS：顶部品牌图标、Quick Launch 深色说明卡 + 白色字段面板、胶囊式会话 tabs、详情高级信息默认隐藏 |
| 2026-07-02 | API config visual polish | PASS：配置卡片不再默认显示 Keychain 引用，文案转为“密钥存储”，保持高级字段默认隐藏/只读 |
| 2026-07-02 | Pre-push security check | PASS：release/dist/node_modules/env/workspaces/profiles 未跟踪；无真实 key/token/private key；测试假 sk 字符串已改为 test 形态 |
| 2026-07-02 | `npm run test` | PASS：20 files / 62 tests |
| 2026-07-02 | `npm run build` | PASS |
| 2026-07-02 | `npm run package:mac` | PASS：重新生成 `release/AgentDock-darwin-arm64/AgentDock.app` |
| 2026-07-02 | `npm run workflow:doctor` | PASS |
| 2026-07-02 | `npm run test:workflow` | PASS：8 passed |
| 2026-07-02 | `git diff --check` | PASS |
| 2026-07-02 | Local encrypted API key vault | PASS：新保存 API Key 写入 `secrets.vault.json` 本机加密 vault，不再直接写 macOS Keychain；Keychain 仅作为旧数据一次性迁移 fallback |
| 2026-07-02 | API key storage UI copy | PASS：配置页改为 `API Key（本机加密保存）` / `API Key 已本机加密保存`，不再默认提示保存到 Keychain |
| 2026-07-02 | `npm run test` | PASS：22 files / 68 tests |
| 2026-07-02 | `npm run build` | PASS |
| 2026-07-02 | `npm run package:mac` | PASS：重新生成 `release/AgentDock-darwin-arm64/AgentDock.app` |
| 2026-07-02 | local package codesign verify | PASS：`codesign --verify --deep --strict --verbose=2` |
| 2026-07-02 | secret scan | PASS：变更文件未发现真实 API key/token/private key；剩余命中为文档占位符 |
| 2026-07-02 | `npm run workflow:doctor` | PASS |
| 2026-07-02 | `npm run test:workflow` | PASS：8 passed |
| 2026-07-02 | `git diff --check` | PASS |
| 2026-07-02 | Terminal-first compact UI | PASS：移除大块 Quick Launch/共享目录伪按钮/顶部重复“新建会话”；启动动作统一为“启动终端”；详情关闭时终端全宽 |
| 2026-07-02 | Claude inherited env conflict fix | PASS：PTY 启动前清理继承的 `ANTHROPIC_API_KEY`/OpenAI/CODEX 环境变量，只保留当前 profile 注入，避免 Claude Auth conflict |
| 2026-07-02 | `npm run test` | PASS：22 files / 71 tests |
| 2026-07-02 | `npm run build` | PASS |
| 2026-07-02 | `npm run package:mac` | PASS：重新生成 `release/AgentDock-darwin-arm64/AgentDock.app` |
| 2026-07-02 | packaged compact UI smoke | PASS：app.asar 不再包含 `新建会话`/`共享目录`/`Quick Launch`，保留 `启动终端` |
| 2026-07-02 | local package codesign verify | PASS：`codesign --verify --deep --strict --verbose=2` |
| 2026-07-02 | secret scan | PASS：未发现真实 API key/token/private key；剩余命中为文档/验证记录占位符 |
| 2026-07-02 | `npm run workflow:doctor` | PASS |
| 2026-07-02 | `npm run test:workflow` | PASS：8 passed |
| 2026-07-02 | macOS titlebar alignment | PASS：BrowserWindow 改为 `titleBarStyle: hidden`，自定义标题栏左侧预留交通灯空间，使窗口控制按钮与 AgentDock 标题同一行 |
| 2026-07-02 | Auto command selection | PASS：命令跟随 API 配置工具类型自动设置；命令下拉只提供 `自动：<tool>` 与 `zsh（本地 Shell）` |
| 2026-07-02 | xterm scrollbar polish | PASS：终端滚动条改为暗色细滚动条并贴终端右边，xterm screen 增加右侧内边距避免内容压住滚动条 |
| 2026-07-02 | `npm run test` | PASS：22 files / 74 tests |
| 2026-07-02 | `npm run package:mac` | PASS：重新生成 `release/AgentDock-darwin-arm64/AgentDock.app` |
| 2026-07-02 | packaged UI smoke | PASS：app.asar 确认 `titleBarStyle: hidden`、包含 `自动：` 与 `xterm-viewport`，不含 `新建会话`/`共享目录` |
| 2026-07-02 | local package codesign verify | PASS：`codesign --verify --deep --strict --verbose=2` |
| 2026-07-02 | secret scan | PASS：未发现真实 API key/token/private key；剩余命中为文档/验证记录占位符 |
| 2026-07-02 | `npm run workflow:doctor` | PASS |
| 2026-07-02 | `npm run test:workflow` | PASS：8 passed |
| 2026-07-02 | No automatic Keychain fallback | PASS：主进程改为直接使用本机加密 `secrets.vault.json`，不再自动读 macOS Keychain fallback，避免本地/adhoc App 反复弹系统密码；缺 key 时要求用户在接口配置中粘贴保存一次 |
| 2026-07-02 | API config model fetch and visible key controls | PASS：配置页支持显式显示/隐藏当前 API Key、拉取模型列表、默认模型下拉、手动添加/删除模型；renderer 默认不读取 secret，fetch models 只返回模型 ID |
| 2026-07-02 | `npm run test` | PASS：23 files / 80 tests |
| 2026-07-02 | `npm run build` | PASS |
| 2026-07-02 | `npm run package:mac` | PASS：重新生成 `release/AgentDock-darwin-arm64/AgentDock.app` |
| 2026-07-02 | local package codesign verify | PASS：`codesign --verify --deep --strict --verbose=2` |
| 2026-07-02 | packaged main entry scan | PASS：app.asar 主入口不含 `createKeytarAdapter` / `createVaultBackedSecretAdapter` / `keychainAdapter` 引用 |
| 2026-07-02 | strict secret scan | PASS：source/tests/docs（排除 mockup assets）未发现真实 API key/token/private key pattern |
| 2026-07-03 | macOS traffic-light titlebar alignment | PASS：`.titlebar-spacer` 压缩为 34px 单行标题栏，隐藏标题栏副标题并缩小右侧按钮 padding，使左上角三色窗口控制按钮与 AgentDock logo/title 中线对齐 |
| 2026-07-03 | `npm run test` | PASS：23 files / 81 tests |
| 2026-07-03 | `npm run build` | PASS |
| 2026-07-03 | `npm run package:mac` | PASS：重新生成 `release/AgentDock-darwin-arm64/AgentDock.app` |
| 2026-07-03 | local package codesign verify | PASS：`codesign --verify --deep --strict --verbose=2` |
| 2026-07-03 | `git diff --check` | PASS |
| 2026-07-03 | Terminal scrollback context retention | PASS：xterm 显式设置 `scrollback: 50_000`，主进程每个 session 的 PTY replay buffer 从 200KB 提升到 5MB，避免新输出/切换 tab 后旧上下文过早丢失 |
| 2026-07-03 | `npm run test` | PASS：23 files / 83 tests |
| 2026-07-03 | `npm run build` | PASS |
| 2026-07-03 | `npm run package:mac` | PASS：重新生成 `release/AgentDock-darwin-arm64/AgentDock.app` |
| 2026-07-03 | local package codesign verify | PASS：`codesign --verify --deep --strict --verbose=2` |
| 2026-07-03 | strict secret scan | PASS：source/tests/docs（排除 mockup assets）未发现真实 API key/token/private key pattern |
| 2026-07-03 | Terminal history preserve mode | PASS：Agent 会话输出进入 xterm 前过滤备用屏幕/清屏/光标重定位 ANSI 控制码，避免 Codex/Claude redraw 覆盖旧上下文；zsh/bash 本地 shell 保留原生控制码 |
| 2026-07-03 | Stable terminal scrollbar gutter | PASS：xterm viewport 显式 `overflow-y: scroll !important` 和 `scrollbar-gutter: stable`，右侧滚动槽稳定预留 |
| 2026-07-03 | `npm run typecheck` | PASS |
| 2026-07-03 | `npm run test` | PASS：23 files / 85 tests |
| 2026-07-03 | `npm run build` | PASS |
| 2026-07-03 | `npm run package:mac` | PASS：重新生成 `release/AgentDock-darwin-arm64/AgentDock.app` |
| 2026-07-03 | local package codesign verify | PASS：`codesign --verify --deep --strict --verbose=2` |
| 2026-07-03 | strict secret scan | PASS：source/tests/docs（排除 mockup assets）未发现真实 API key/token/private key pattern |
| 2026-07-03 | Terminal ANSI filter narrowed | PASS：修复上一版历史保留过滤过度导致 Codex/Claude 启动画面错乱；现在只过滤备用屏幕和清除 scrollback 控制码，保留正常光标/清屏/颜色控制序列 |
| 2026-07-03 | `npm run typecheck` | PASS |
| 2026-07-03 | `npm run test` | PASS：23 files / 85 tests |
| 2026-07-03 | `npm run build` | PASS |
| 2026-07-03 | `npm run package:mac` | PASS：重新生成 `release/AgentDock-darwin-arm64/AgentDock.app` |
| 2026-07-03 | local package codesign verify | PASS：`codesign --verify --deep --strict --verbose=2` |
| 2026-07-03 | strict secret scan | PASS：source/tests/docs（排除 mockup assets）未发现真实 API key/token/private key pattern |
