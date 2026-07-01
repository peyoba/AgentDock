# 9+1 工程角色开发工作流

本文件是项目内 Agent 开发执行协议。它不是说明文档，而是主 Agent 和子 Agent 必须遵循的运行规则。

## 1. 角色模型

9+1 是角色池，不是固定人数。编号代表质量闸门，不代表每个任务都要派满所有 Agent。

| 层级 | 角色组合 | 启用场景 |
|------|----------|----------|
| 核心二人组 | ②开发 + ③验收 | L1 轻量任务 |
| 标准四人组 | ①测试 + ②开发 + ③验收 + ④质量 | L2 标准任务 |
| 高风险扩展组 | ⑤安全 + ⑩风险 + ⑥性能 + ⑦文档 | L3 按触发条件启用 |
| 批次交付组 | ⑧集成 + ⑨部署 | 一批任务结束后启用 |

## 2. 任务分级

| 等级 | 适用任务 | 必须流程 |
|------|----------|----------|
| L1 | 文案、样式、配置小修、无业务风险的小 bug | ②开发 -> ③验收 |
| L2 | 普通功能、普通 bug、模块内重构 | ①测试 -> ②开发 -> ③验收 -> ④质量 |
| L3 | 登录、权限、支付、Webhook、数据库、AI Service、环境变量、部署、安全边界 | L2 + 条件触发扩展角色 + 真实验证 |

满足任一条件，至少为 L3：

- 修改认证、授权、管理员权限、Token、Session、密码、支付或订单状态。
- 修改数据库 schema、迁移脚本、删除逻辑、批量更新逻辑。
- 新增或修改环境变量、密钥、API Key、Webhook、第三方回调。
- 调用 LLM、搜索 API、爬虫、外部服务，或修改 prompt。
- 影响生产部署、构建产物、CI/CD、Docker、云服务配置。

## 3. Hook 协议

每个 hook 结束后，主 Agent 必须按 `.agent-workflow/STATE_RULES.md` 更新 `.agent-workflow/state.md`。

| Hook | 触发时机 | 必须动作 | 不通过时 |
|------|----------|----------|----------|
| `superpowers_bootstrap_hook` | 工作流启动后、intake 前 | 检查 Superpowers；没有则先安装或启用 | 安装失败且用户未允许降级时 BLOCKED |
| `intake_hook` | 用户提出需求后 | 澄清目标、用户、场景、输入输出、验收标准 | 追问用户 |
| `risk_classification_hook` | 拆任务前 | 判定 L1/L2/L3，列出触发原因 | 升级流程 |
| `plan_review_hook` | SPEC/任务清单完成后 | 查隐含假设、过度工程、欠缺工程 | 回到 intake |
| `dispatch_hook` | 派发子 Agent 前 | 生成任务卡，限制输入、文件、禁止项和完成标准 | 不派发 |
| `red_hook` | ①测试完成后 | 确认测试失败且失败原因合理 | 打回①测试 |
| `green_hook` | ②开发完成后 | 确认相关测试通过 | 打回②开发 |
| `acceptance_hook` | ③验收完成后 | 对照 SPEC 逐条核验 | 打回②开发 |
| `quality_gate_hook` | L2/L3 | 查复杂度、命名、职责、重复代码 | 打回②开发 |
| `security_gate_hook` | 安全触发 | 查密钥、注入、越权、敏感数据 | 阻塞交付 |
| `risk_gate_hook` | L3 触发 | 查业务风险、上线风险、外部依赖风险 | 阻塞交付 |
| `performance_gate_hook` | 性能触发 | 查 N+1、大循环、缓存、连接、索引 | 打回或有条件通过 |
| `integration_hook` | 一批任务结束 | 全量测试、真实验证、冲突检查 | 阻塞交付 |
| `delivery_hook` | 最终交付前 | 输出交付报告 | 不允许宣布完成 |

## 4. 角色协议

每个角色都有独立说明文档。派发子 Agent 前，主 Agent 必须读取对应角色文档，并把角色文档路径写入任务卡。

Skill 加载必须遵循 `.agent-workflow/SKILLS.md`。角色表中的 `必加载 skill` 是能力要求，主 Agent 必须先执行 `superpowers_bootstrap_hook`，优先安装或启用 Superpowers，再解析这些 skill 在当前环境中的来源；无法加载时，必须写明回退方案或阻塞原因。

| 角色 | 启用时机 | 必加载 skill | 职责 | 产出 |
|------|----------|--------------|------|------|
| 主 Agent | 全程 | `brainstorming`, `writing-plans`, `subagent-driven-development`, `dispatching-parallel-agents` | 需求澄清、分级、派发、审阅、打回、汇报 | `agents/00-main-agent.md` |
| ①测试工程师 | L2/L3 | `test-driven-development`, `testing-anti-patterns` | 只根据 SPEC 写失败测试 | `agents/01-test-engineer.md` |
| ②开发工程师 | 所有任务 | `test-driven-development`, `systematic-debugging` | 最小实现，让测试通过 | `agents/02-developer.md` |
| ③验收工程师 | 所有任务 | `verification-before-completion` | 按 SPEC 核验是否做对 | `agents/03-acceptance-engineer.md` |
| ④质量工程师 | L2/L3 | `requesting-code-review`, `receiving-code-review` | 查复杂度、命名、职责、重复代码 | `agents/04-quality-engineer.md` |
| ⑤安全工程师 | 安全触发 | `codex-security:security-diff-scan` | 查密钥、注入、越权、敏感数据 | `agents/05-security-engineer.md` |
| ⑩风险审查官 | L3 触发 | `codex-security:threat-model` 或自定义风险审查 | 查业务风险、上线风险、外部依赖风险 | `agents/10-risk-reviewer.md` |
| ⑥性能工程师 | 性能触发 | `root-cause-tracing` 或自定义性能检查 | 查 N+1、大循环、缓存、连接、索引 | `agents/06-performance-engineer.md` |
| ⑦文档工程师 | 文档触发 | `writing-skills` | 更新 README/API/环境变量/运行说明 | `agents/07-docs-engineer.md` |
| ⑧集成工程师 | 批次结束 | `executing-plans`, `verification-before-completion` | 全量测试、真实验证、冲突检查 | `agents/08-integration-engineer.md` |
| ⑨部署工程师 | 部署触发 | `finishing-a-development-branch` | 构建、部署、回滚、发布检查 | `agents/09-deploy-engineer.md` |

## 5. 子 Agent 派发规则

派发前必须创建任务卡：

- 使用 `templates/task-card.md`。
- 必须引用对应 `.agent-workflow/agents/*.md` 角色说明。
- 必须按 `.agent-workflow/SKILLS.md` 填写 Skill 加载说明。
- 明确角色、任务等级、输入、允许触碰文件、禁止事项、完成标准。
- 一个子 Agent 默认只做一个清楚目标。
- 允许一个任务改多个文件，但必须在任务卡中列明。

子 Agent 完成后必须交接：

- 使用 `templates/handoff.md`。
- 结论只能是 `PASS / FAIL / BLOCKED`。
- 必须包含验证命令和结果。
- 有风险必须写明，不允许只写“完成”。

## 6. 状态管理

主 Agent 必须维护 `.agent-workflow/state.md`，并遵守 `.agent-workflow/STATE_RULES.md`。

每次阶段变化、打回、阻塞、验证通过后，都要更新：

- 当前任务。
- 风险等级。
- 当前 Hook。
- 已派发角色及状态。
- 阻塞点。
- 下一步。

## 6.1 项目适配

主 Agent 必须优先读取根目录 `PROJECT_PROFILE.md` 来确定：

- 包管理器。
- 测试命令。
- Lint/typecheck/build 命令。
- 环境变量来源。
- 部署方式。

如果 `PROJECT_PROFILE.md` 信息缺失，主 Agent 应先从项目文件推断；推断失败时询问用户，不得直接猜测关键命令。

## 7. 打回规则

| 打回来源 | 打回对象 | 最多次数 |
|----------|----------|----------|
| ③验收 | ②开发 | 2 次 |
| ④质量 | ②开发 | 2 次 |
| ⑤安全 | ②开发 | 2 次 |
| ⑩风险 | ②开发 | 2 次 |
| ⑥性能 | ②开发 | 2 次 |

超过 2 次打回，主 Agent 必须停下来问用户。

## 8. 真实验证规则

L3 任务必须有真实验证记录，使用 `templates/verification.md`。

Mock 测试不能替代真实验证。涉及外部 API、数据库、LLM、浏览器、部署的任务，必须记录真实依赖、验证步骤、实际结果和结论。

## 9. 交付规则

最终交付前必须执行 `delivery_hook`：

- 使用 `templates/delivery-report.md`。
- 报告任务等级、执行过的角色、测试结果、真实验证、风险结论。
- 未验证不得宣布完成。
