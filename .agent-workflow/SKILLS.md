# Skill 加载协议

本文件定义子 Agent 如何理解和加载角色文档中的 `必加载 Skill`。

## 1. 基本原则

角色文档中的 skill 名称是“能力要求”，不是固定文件路径。不同 Agent 运行环境的 skill 存放位置不同，主 Agent 必须在派发前完成 skill 解析。

## 2. Superpowers 前置安装规则

本工作流默认优先使用 Superpowers 技能体系。启动开发前，主 Agent 必须先执行 `superpowers_bootstrap_hook`。

### 2.1 superpowers_bootstrap_hook

主 Agent 必须按顺序执行：

1. 检查当前环境是否存在 Superpowers 技能，例如：
   - `superpowers:using-superpowers`
   - `superpowers:test-driven-development`
   - `superpowers:verification-before-completion`
2. 如果 Superpowers 已可用，读取 `superpowers:using-superpowers` 或等价入口 skill。
3. 如果 Superpowers 不可用，先安装或启用 Superpowers。
4. 安装或启用完成后，重新检查 Superpowers 是否可用。
5. 只有 Superpowers 可用或用户明确允许降级时，才允许进入 `intake_hook`。

### 2.2 安装策略

不同运行环境安装方式不同，主 Agent 必须优先使用当前环境支持的官方安装方式：

- 如果环境提供 skill/plugin 安装器，优先使用安装器安装 Superpowers。
- 如果项目已有 Superpowers 安装脚本或说明，按项目说明执行。
- 如果无法判断安装方式，主 Agent 必须停下来问用户，不能假装已安装。

### 2.3 安装失败处理

如果 Superpowers 安装失败：

- L2/L3 任务默认进入 `BLOCKED`。
- 主 Agent 必须报告失败原因和已尝试步骤。
- 只有用户明确允许时，才可以使用角色文档检查清单降级执行。
- L3 安全、风险、真实验证相关任务不建议降级，除非有人工复核。

## 3. 主 Agent 派发前必须做的事

对每个子 Agent 任务，主 Agent 必须：

1. 读取 `.agent-workflow/agents/<role>.md`。
2. 找到该角色的 `必加载 Skill` 列表。
3. 优先在 Superpowers skills 中按名称匹配。
4. 如果没有 Superpowers 匹配项，再在当前运行环境的其他可用 skills 中匹配。
5. 把匹配结果写入任务卡的 `Skill 加载说明`。
6. 如果某个 skill 不可用，写明安装尝试、回退方案或阻塞原因。

## 4. Codex 环境加载规则

如果运行环境支持 Codex skills：

1. 优先检查是否存在 `superpowers:*` 技能。
2. 如果不存在，先安装或启用 Superpowers。
3. Superpowers 可用后，优先匹配 `superpowers:<skill>`。
4. 如果没有 `superpowers:<skill>`，再匹配无前缀同名 skill，例如 `test-driven-development`。
5. 如果存在插件前缀版本，优先使用更具体的版本，例如 `codex-security:security-diff-scan`。
6. 子 Agent 执行前必须读取对应 `SKILL.md`。
7. 如果 `SKILL.md` 引用相对路径，必须按该 `SKILL.md` 所在目录解析。
8. 如果 skill 不存在，子 Agent 不能假装已加载，必须在 handoff 中声明 `SKILL_UNAVAILABLE`。

## 5. 非 Codex 环境加载规则

如果运行环境不支持独立 skill 系统，例如某些 Claude/Cursor/自定义 Agent 环境：

1. 优先检查该环境是否支持安装 Superpowers 或导入等价技能包。
2. 如果支持，先安装或启用 Superpowers。
3. 如果不支持，把 skill 名称视为能力标签。
4. 使用对应 `.agent-workflow/agents/<role>.md` 中的检查清单作为降级执行标准。
5. 在任务卡中写明：`Skill 加载方式：Superpowers 不可用，使用角色文档内置协议`。
6. 如果任务风险为 L3，缺少安全、风险、验证相关 skill 时，必须在交付报告中说明。

## 6. Skill 解析状态

任务卡必须记录每个 skill 的解析状态：

| 状态 | 含义 |
|------|------|
| `SUPERPOWERS_INSTALLED` | 本次启动时已安装或启用 Superpowers |
| `LOADED` | 已在运行环境中找到并读取 skill |
| `AVAILABLE_NOT_READ` | 找到但尚未读取，不允许开始执行 |
| `UNAVAILABLE_FALLBACK_USED` | 未找到，使用角色文档检查清单降级执行 |
| `BLOCKED` | 缺少该 skill 会导致任务不可安全执行 |

## 7. 默认 Skill 映射

| 能力 | 优先加载 | 次选 | 不可用时 |
|------|----------|------|----------|
| 需求澄清 | `superpowers:brainstorming` | `brainstorming` | 使用 `00-main-agent.md` 的 intake 步骤 |
| 计划编写 | `superpowers:writing-plans` | `writing-plans` | 使用 `templates/spec.md` 和任务拆分规则 |
| 子 Agent 派发 | `superpowers:subagent-driven-development` | `subagent-driven-development` | 使用 `dispatch_hook` 和任务卡模板 |
| 并行调度 | `superpowers:dispatching-parallel-agents` | `dispatching-parallel-agents` | 手动按依赖关系串并行派发 |
| TDD | `superpowers:test-driven-development` | `test-driven-development` | 使用 `01-test-engineer.md` 和 `02-developer.md` |
| 测试反模式 | `testing-anti-patterns` | 无 | 使用 `01-test-engineer.md` 的禁止事项 |
| 系统调试 | `superpowers:systematic-debugging` | `systematic-debugging` | 使用 root-cause 分析：现象、复现、假设、验证 |
| 完成前验证 | `superpowers:verification-before-completion` | `verification-before-completion` | 必须运行验证命令并记录输出 |
| 代码审查 | `superpowers:requesting-code-review` | `requesting-code-review` | 使用 `04-quality-engineer.md` 检查清单 |
| 审查反馈处理 | `superpowers:receiving-code-review` | `receiving-code-review` | 明确接受/拒绝/修改原因 |
| 安全扫描 | `codex-security:security-diff-scan` | 无 | 使用 `05-security-engineer.md`；L3 时建议阻塞并请求人工复核 |
| 威胁建模 | `codex-security:threat-model` | 无 | 使用 `10-risk-reviewer.md` 审查问题 |
| 根因追踪 | `root-cause-tracing` | 无 | 使用现象 -> 复现 -> 假设 -> 验证链路 |
| 文档更新 | `writing-skills` | 无 | 使用 `07-docs-engineer.md` 文档要求 |
| 计划执行 | `superpowers:executing-plans` | `executing-plans` | 按任务卡逐项执行并记录 handoff |
| 分支收尾 | `superpowers:finishing-a-development-branch` | `finishing-a-development-branch` | 使用 `09-deploy-engineer.md` 和交付报告模板 |

## 8. 任务卡写法示例

```markdown
## 必加载 Skill
- `test-driven-development`
- `testing-anti-patterns`

## Skill 加载说明
| Skill | 状态 | 来源 | 说明 |
|-------|------|------|------|
| `test-driven-development` | LOADED | `superpowers:test-driven-development` | 已读取 SKILL.md |
| `testing-anti-patterns` | UNAVAILABLE_FALLBACK_USED | `.agent-workflow/agents/01-test-engineer.md` | 使用角色文档禁止事项降级执行 |
```

## 9. 阻塞规则

以下情况必须 BLOCKED，不能继续执行：

- Superpowers 不可用，安装失败，且用户未允许降级。
- L3 安全任务缺少安全 skill，且没有人工安全复核。
- L3 风险任务缺少风险审查能力，且无法完成真实验证。
- 子 Agent 声称加载了 skill，但无法说明来源或读取结果。
- 验证类 skill 不可用，且没有执行任何替代验证命令。
