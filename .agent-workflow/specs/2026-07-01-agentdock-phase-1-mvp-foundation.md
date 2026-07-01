# AgentDock Phase 1 MVP Foundation SPEC

## 背景

AgentDock 已完成开发前准备：项目骨架、需求/UI/架构文档、工作流模板、GitHub 仓库和基础验证都已就绪。当前需要进入正式开发，但项目涉及 Electron、PTY、API Key、Keychain、环境变量隔离和外部 CLI，属于 L3 高风险任务，必须先明确第一阶段范围和验证方式。

## 目标

第一阶段交付一个安全、可测试的 MVP 基础层：Profile/Workspace/Session 类型、密钥脱敏、Claude/Codex 启动环境生成、Keychain/PTY adapter 合同、preload IPC 边界和终端优先 UI 骨架。

## 非目标

- 不接入真实 `node-pty`。
- 不读写真实 macOS Keychain。
- 不测试真实 Claude/Codex 外部 CLI。
- 不实现连接测试、成本统计、请求日志、API 网关、fallback、复杂 Dashboard、完整 IDE、复杂分屏。

## 用户路径 / 调用路径

1. 用户打开 AgentDock。
2. 顶部看到简洁的新建会话 command bar。
3. 用户可看到 Profile / Workspace / command / 启动模式入口。
4. 中间看到会话标签页和终端主体。
5. 当前会话详情默认收起，需要时展开查看脱敏 endpoint/keychain/workspace 信息。
6. API 配置入口展示按工具类型分组：Claude / Codex / Gemini / OpenCode / 全部。

## 功能要求

- 定义 `ApiProfile`、`Workspace`、`AgentSession`、`LaunchRequest` 等共享类型。
- API Profile 只保存 Keychain 引用，不保存 secret 明文。
- 环境变量预览必须脱敏敏感值。
- Claude 启动环境支持独立 `ANTHROPIC_BASE_URL` 和 key 注入。
- Codex 启动环境支持独立 `CODEX_HOME` 和 key 注入。
- Keychain 与 PTY 通过 adapter interface 封装，第一阶段使用 fail-fast unavailable adapter。
- Renderer 只通过 preload IPC 访问主进程，不启用 Node integration。
- 当前会话详情默认收起。
- API 配置 UI 按工具类型分类。

## 边界情况

- 空输入：空 secret 显示为“未设置”；空 profiles/workspaces 显示空状态。
- 非法输入：无效 profile/workspace id 不创建 session，返回安全错误。
- 重复输入：重复 profile/workspace id 应覆盖或拒绝，具体实现阶段在 store 测试中固定。
- 外部服务失败：第一阶段不访问外部服务；真实 Keychain/PTY 缺失时 fail fast，不伪装成功。

## 技术选择

- 语言/框架：TypeScript + Electron + React + Vite。
- 测试：建议新增 Vitest + jsdom + React Testing Library。
- 包管理：npm。
- 数据库：无；MVP metadata 使用 JSON store。
- 部署：本阶段不做打包发布。

## 文件边界

- 允许修改：
  - `src/shared/**`
  - `src/main/**`
  - `src/preload/**`
  - `src/renderer/**`
  - `tests/app/**`
  - `package.json`
  - `package-lock.json`
  - `vitest.config.ts`
  - `.agent-workflow/state.md`
  - `.agent-workflow/verification/**`
- 禁止修改：
  - `.env`
  - 包管理器类型
  - 与本阶段无关的需求文档和历史 mockup 资产
  - GitHub 远程配置，除非用户明确要求
- 需要先读取：
  - `AGENTS.md`
  - `PROJECT_PROFILE.md`
  - `docs/PROJECT_REQUIREMENTS.md`
  - `DECISIONS.md`
  - `.agent-workflow/state.md`
  - `.agent-workflow/WORKFLOW.md`
  - `.agent-workflow/SKILLS.md`
  - `.agent-workflow/STATE_RULES.md`

## 依赖关系

- 前置任务：用户确认第一阶段计划；用户确认是否允许新增测试 devDependencies。
- 依赖模块：Electron main/preload/renderer 骨架；现有 npm/Vite/TypeScript 配置。
- 可并行任务：
  - domain types/redaction；
  - renderer component split；
  - adapter contract design；
  但因当前需要先建立测试框架，建议第一批串行执行到测试框架通过后再并行。

## 任务拆分判断

- 是否需要拆分：需要。
- 拆分理由：任务属于 L3，涉及安全边界和未来 native adapter；必须按 TDD 分批，避免一次性接入真实 PTY/Keychain。

## 风险等级

L3

## 触发原因

- 涉及 API Key/secret 安全边界。
- 涉及环境变量注入。
- 后续会接入外部 CLI：Claude/Codex。
- 后续会接入 PTY 和 macOS Keychain。
- workflow CLI 评估结果为 L3：`data handling` + `security`。

## 验收标准

- `npm run test` 覆盖 secret 脱敏、launch environment、adapter fail-fast、metadata store、UI 默认收起状态。
- `npm run typecheck` 通过。
- `npm run build` 通过。
- `npm run workflow:doctor` 通过。
- `npm run test:workflow` 通过。
- 仓库中没有真实 API Key 或 key-like fixture。
- Renderer 不直接接触完整 secret，只展示脱敏预览。
- Phase 1 明确记录真实 PTY/Keychain 验证延期到 Phase 2。

## 验收证据

- 测试命令：
  - `npm run test`
  - `npm run test:workflow`
- 构建 / Lint / Typecheck：
  - `npm run workflow:doctor`
  - `npm run typecheck`
  - `npm run build`
- 人工或真实环境验证：
  - 第一阶段仅做 Electron UI 手动打开检查；真实 PTY/Keychain 验证在第二阶段。
- 未验证项：
  - 真实 `node-pty` 启动。
  - 真实 macOS Keychain 读写。
  - 真实 Claude/Codex 会话隔离。

