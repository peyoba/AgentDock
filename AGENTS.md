# AgentDock Project-Specific Instructions

本项目是 AgentDock 代理坞：Claude/Codex 多配置内嵌终端工作台。以下规则优先于通用模板中不够具体的部分。

## 必读项目文档

开发任何功能前必须读取：

1. `docs/PROJECT_REQUIREMENTS.md` — 当前需求、UI、验收标准。
2. `PROJECT_PROFILE.md` — 技术栈、命令、环境变量、风险边界。
3. `DECISIONS.md` — 已确认产品/技术决策。
4. `.agent-workflow/state.md` — 当前工作流状态。
5. `docs/requirements/06-技术架构方案.md` — 架构背景。
6. `docs/requirements/05-UI效果图.md` — UI 方向与效果图索引。

## 产品边界

AgentDock 是“终端优先的内嵌终端工作台”，不是 API 网关后台，也不是完整 IDE。

MVP 必须坚持：

- 多个 Claude/Codex 会话并发运行。
- 每个会话独立 endpoint/API key。
- Codex 每 Profile 独立 `CODEX_HOME`。
- API Profile 与 Workspace 解耦。
- 当前会话详情默认收起。
- API 配置按工具类型分类，参考 CC Switch。

MVP 不做：

- 成本统计、请求日志、复杂 Dashboard。
- 自动路由、fallback、API gateway。
- 完整 IDE、代码 diff、复杂分屏。

## 安全硬约束

- 禁止把完整 API Key 写入代码、测试、文档、日志、截图或前端持久化状态。用户明确点击查看单个已保存 Profile 时，允许通过受限专用 IPC 临时显示该 API Key，但不得广播、记录或持久化。
- API Key 只能进入本机加密 vault；仓库中只保存引用信息或脱敏显示。旧 Keychain 数据仅用于迁移/适配。
- 复制环境变量时默认隐藏 key。
- 错误信息不得包含 secret。

## 技术约束

- 包管理器固定为 npm。
- 技术栈固定为 Electron + React + TypeScript。
- 终端渲染使用 xterm.js。
- PTY 层通过 adapter 封装，真实实现使用 node-pty。
- 密钥存储层通过 adapter 封装，当前新保存 key 使用本机加密 vault，旧 Keychain adapter 仅用于迁移/适配。
- 不得随意引入状态管理库、UI 组件库或打包工具；需要先说明理由并获得确认。

## 验证要求

完成任何开发前至少运行相关命令：

```bash
npm run workflow:doctor
npm run typecheck
npm run build
```

涉及工作流 CLI 时运行：

```bash
npm run test:workflow
```

涉及终端/密钥存储/环境变量的功能，必须补充真实验证记录。

---

# Agent Instructions

本文件约束所有参与本项目的代码代理和人工协作者。任何代码改动前，必须先读取项目上下文和 Agent 工作流文件。

## 0. 必读文件与优先级

开始任何开发前，主 Agent 必须读取：

1. `PROJECT_PROFILE.md`：项目技术栈、命令、环境变量和部署信息。
2. `DECISIONS.md`：已确认决策、已拒绝建议、待确认问题。
3. `.agent-workflow/WORKFLOW.md`：9+1 工程角色工作流。
4. `.agent-workflow/SKILLS.md`：Superpowers 和 skill 加载协议。
5. `.agent-workflow/STATE_RULES.md`：状态文件维护规则。
6. `.agent-workflow/state.md`：当前工作流状态。
7. `.agent-workflow/agents/00-main-agent.md`：主 Agent 职责。
8. `README.md`：项目结构、运行方式和开发命令。
9. 当前主 SPEC/PRD/架构方案：路径由 `PROJECT_PROFILE.md` 或用户指定。

如果用户最新指令、SPEC、架构方案、项目状态和本文件冲突，优先级为：

1. 用户最新明确指令。
2. 当前主 SPEC/PRD。
3. 当前主技术架构方案。
4. `DECISIONS.md` 和 `.agent-workflow/state.md`。
5. `PROJECT_PROFILE.md`。
6. 本文件。

## 1. 工作流入口

开始任何开发前，主 Agent 必须：

1. 执行 `superpowers_bootstrap_hook`：检查 Superpowers；没有就先安装或启用 Superpowers。
2. Superpowers 可用后，从 `intake_hook` 开始。
3. 输出需求澄清、风险等级判断和下一步确认项。
4. 用户确认 SPEC 和任务清单前，不得写代码。

常用启动语句：

```text
请读取 AGENTS.md，并按 .agent-workflow/WORKFLOW.md 启动开发。

项目/功能目标：
[填写目标]

技术约束：
[填写语言、框架、数据库、部署要求；没有就写“由你建议”]

优先级：
[MVP / 完整版 / 修 bug / 重构]

风险要求：
[是否涉及登录、支付、数据库、AI API、环境变量、部署]

请先执行 superpowers_bootstrap_hook，再从 intake_hook 开始。
在我确认 SPEC 和任务清单前，不要进入开发。
```

## 1.1 SPEC / 设计文档语言要求

- 本项目所有新的 SPEC、PRD、设计文档、实施计划和交付报告，默认必须使用中文编写。
- 如果因外部模板、skill 流程或历史原因先生成了英文文档，必须在同一目录同步生成 `.zh-CN.md` 中文版，并在后续评审和实施中以中文版为准。
- 面向用户确认的任务清单、验收标准、风险说明和验证记录必须使用中文。
- 英文只能作为补充版本，不得作为本项目唯一的 SPEC 或设计文档。

## 2. 项目边界

当前项目边界必须写在 `PROJECT_PROFILE.md` 或当前主 SPEC 中。

主 Agent 在开发前必须确认：

- 当前项目是什么。
- 当前阶段目标是什么。
- 当前阶段明确不做什么。
- 哪些能力需要先更新 SPEC 才能实现。
- 哪些路径属于 L3 高风险任务。

如果有人要求加入当前边界之外的能力，必须先更新 SPEC/PRD 并重新评审。

## 3. Superpowers 与子 Agent 工作流

必须优先使用适用的 Superpowers 技能，而不是凭感觉直接写代码。

### 3.1 开始任何开发前

- 先读相关 SPEC/PRD、项目状态、`PROJECT_PROFILE.md`、`DECISIONS.md` 和当前文件结构。
- 如果是新功能、行为变化或架构调整，先使用 `superpowers:brainstorming` 澄清方案。
- 如果已有明确 spec，先使用 `superpowers:writing-plans` 写实施计划。
- 执行计划时使用 `superpowers:executing-plans` 或 `superpowers:subagent-driven-development`。
- 涉及多个独立任务时，使用 `superpowers:dispatching-parallel-agents`。
- 开始代码前确认是否需要隔离工作区；如果是 git 仓库，优先使用 `superpowers:using-git-worktrees`。

### 3.2 实现任何功能或 bugfix 前

必须使用 `superpowers:test-driven-development`。

标准顺序：

1. 先根据 SPEC 写测试。
2. 运行测试，确认失败原因是功能缺失，不是测试写错。
3. 写最小实现。
4. 重跑测试，确认通过。
5. 只在绿色状态下重构。

### 3.3 完成前

必须使用 `superpowers:verification-before-completion`。

不能说“完成了”“好了”“能用了”，除非刚刚运行过能证明该结论的命令，并读过输出。

## 4. 9+1 工程角色规则

- 主 Agent 是协调者，不是执行者。
- 子 Agent 按角色执行：测试、开发、验收、质量、安全、风险、性能、文档、集成、部署。
- 所有任务必须按 L1/L2/L3 分级。
- L1 走核心二人组：②开发 -> ③验收。
- L2 走标准四人组：①测试 -> ②开发 -> ③验收 -> ④质量。
- L3 按触发条件启用：⑤安全、⑩风险、⑥性能、⑦文档、⑧集成、⑨部署。
- 派发子 Agent 前必须读取对应 `.agent-workflow/agents/*.md` 角色说明。
- 派发子 Agent 前必须按 `.agent-workflow/SKILLS.md` 解析 skill 来源；优先使用 Superpowers skill。
- 每个子 Agent 任务必须使用 `.agent-workflow/templates/task-card.md` 生成任务卡。
- 每个角色完成后必须使用 `.agent-workflow/templates/handoff.md` 交接。
- 每个 hook 结束后必须按 `.agent-workflow/STATE_RULES.md` 更新 `.agent-workflow/state.md`。
- 最终交付前必须使用 `.agent-workflow/templates/delivery-report.md` 输出交付报告。

## 5. 文件编辑协议

代码代理改文件前必须先说明：

- 将修改哪些文件。
- 每个文件为什么要改。
- 是否会引入依赖。
- 是否会改包管理配置、锁文件、`.gitignore`、`.env` 或项目配置。
- 如何验证。

除非用户明确授权，禁止：

- 删除用户已有文件。
- 覆盖用户未确认的改动。
- 改 `.env`。
- 改包管理器、语言版本或运行时版本。
- 引入新依赖。
- 执行破坏性命令。

手工编辑文件必须使用可审查的 patch 方式。不要用 shell 重定向、`cat > file` 或脚本偷偷批量改文件。

## 6. 编程心法

### 6.1 YAGNI

用不到不要做。

- 用最简单的实现满足当前需求。
- 不要为未来可能的扩展提前设计抽象层。
- 不留 TODO 或未来扩展位。
- 1 种实现就别造工厂模式。
- 当前阶段没有的功能，不要在数据模型里提前占字段。

### 6.2 KISS

保持简单。

- 能用普通函数解决的，不要用类。
- 能用 `if` / `else` 解决的，不要用 Strategy 模式。
- 优先可读性，不优先“看起来专业”。
- 5 行能写完的，不要用 50 行。
- 不写为了展示架构能力的代码。

### 6.3 命名是设计

- 变量名和函数名要精确说明它装的是什么、做什么。
- 不要用 `data`、`temp`、`helper`、`util`、`manager` 这种通用名。
- 函数名里不要用 `do`、`process`、`handle` 这种空动词。
- 如果需要注释解释命名，先改名字。
- 文件名要表达职责，不要把多个职责塞进一个“工具文件”。

### 6.4 Fail Fast

快速失败。

- 不要 catch 你不知道怎么处理的异常。
- 在数据边界校验输入：CLI 输入、LLM 输出、HTTP 响应、文件解析结果、静态 JSON、数据库输出。
- 出错立即抛具体异常。
- 报错信息要包含“是什么值导致的”。
- 绝不允许 silent fail。
- 绝不允许 `try: ... except Exception: print(e)` 后继续装作成功。

## 7. Forbidden

### 7.1 依赖 / 环境

- 禁止绕过当前项目环境执行命令。
- 禁止随意引入新依赖；引入前必须说明必要性并获得确认。
- 禁止改包管理配置、锁文件、`.gitignore`、`.env` 或项目配置不告诉用户。
- 禁止把第三方库当成万能解法；能用标准库和现有依赖清楚解决的，不加依赖。
- 项目命令、包管理器、语言版本和测试命令以 `PROJECT_PROFILE.md` 为准。

### 7.2 AI 应用 / LLM

- 禁止把 OpenAI、Anthropic、Ark 或任何 API Key 写在代码、测试、报告或前端里。
- AI Key 必须来自环境变量或用户本地安全配置。
- 禁止生成“假成功”的兜底数据。
- 禁止让 LLM 直接凭知识编造事实、来源、评分或业务结论。
- 禁止把 LLM 输出当作可信结构化数据；必须做解析、字段校验、范围校验和来源标注。
- 新增或大改 prompt 时，应放在明确目录并版本化管理，不要把长 prompt 硬编码在流程函数里。

### 7.3 数据源 / 抓取 / 合规

- 禁止绕过登录、验证码、付费墙或反爬限制。
- 禁止预爬或镜像第三方商业数据库，除非用户明确授权且合规。
- 外部来源不可访问时，输出待复核状态和链接，不伪造结果。
- 不要把下载的临时文件长期保存进仓库。
- 禁止把用户私有数据写入公共缓存。

### 7.4 代码风格 / AI 协作

- 单文件默认不超过 200 行；超过前先评估是否能按职责拆分。
- 禁止留 TODO 注释。该做就做，不做就不要留位。
- 禁止 `try: ... except Exception: print(e)`。
- 禁止没有验证就宣称完成。
- 禁止 commit 不带语义化 message。
- 每个 commit message 必须能看懂“为什么改”。

### 7.5 数据 / 安全

- 禁止 `DELETE` 不带 `WHERE`。优先软删除。
- 禁止用户密码明文存数据库，必须使用项目认可的安全哈希方案。
- 禁止前端默认展示完整 token、API Key 或敏感凭证；仅允许用户明确触发的单 Profile API Key 临时查看流程。
- 禁止把用户私有文本写入全局缓存。
- 禁止将未验证数据标记成 verified。

## 8. TDD 要求

TDD 全称 Test-Driven Development，即测试驱动开发。

### 8.1 单元测试分工

理想情况下，两个 AI 分开：

- 测试 AI：只看 SPEC，写测试，不看实现。
- 实现 AI：只看 SPEC 和测试，写最小实现，不能改测试。

如果只有一个 Agent，也要模拟这个隔离：

1. 先只读 SPEC，写测试。
2. 运行测试并确认失败。
3. 再写实现。
4. 不为了让测试好过而削弱测试。

### 8.2 标准循环

1. Agent 生成测试。
2. 跑测试，确认失败。
3. Agent 写最小实现。
4. 跑测试，分析失败日志。
5. 修实现。
6. 重跑测试，直到通过。
7. 给用户最终 diff 和验证结果。

### 8.3 测试覆盖范围

每个新核心函数或用户可见行为至少覆盖：

- 正常路径。
- 边界值。
- 异常输入。
- 空值或缺字段。
- 权限或安全路径，若适用。
- 外部服务失败，若适用。

## 9. 验证与交付

每个阶段结束必须给出：

- 修改文件清单。
- 关键实现说明。
- 执行过的验证命令。
- 命令结果。
- 未验证或无法验证的部分。
- 下一步建议。

如果无法运行测试或缺少环境，不要说“应该可以”。必须明确说：

- 缺什么环境。
- 哪个要求还没验证。
- 替代验证做了什么。

L3 任务必须有真实验证记录，不能只看 mock 测试。

## 10. 项目特殊规则占位

以下内容应在 `PROJECT_PROFILE.md`、`DECISIONS.md` 或当前主 SPEC 中维护：

### 10.1 架构边界

- 入口文件职责：
- 编排层职责：
- 业务模块边界：
- 外部服务封装位置：
- 数据模型或 schema 位置：

### 10.2 数据和可信度

- 哪些数据源可信：
- 哪些数据源仅供参考：
- verified / partial / unknown 等状态如何定义：
- 结果为空时如何解释：

### 10.3 外部服务策略

- 外部 API 超时：
- 重试规则：
- 降级规则：
- 日志记录规则：
- 成本或限流约束：

### 10.4 输出和报告

- 用户可见输出目录：
- 报告格式：
- 必须展示的来源、风险和验证状态：
- 禁止出现的营销话术或伪确定表达：
