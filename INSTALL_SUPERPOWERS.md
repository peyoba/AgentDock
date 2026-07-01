# Install Superpowers

本文件定义工作流启动时如何检查、安装或启用 Superpowers。

## 1. 目标

在进入 `intake_hook` 前，主 Agent 必须确认 Superpowers 可用。  
如果不可用，必须先尝试安装或启用。  
如果安装失败，且用户未明确允许降级，任务必须进入 `BLOCKED`。

## 2. 检查 Superpowers 是否可用

主 Agent 应优先检查当前环境可用 skill 列表中是否存在以下任一项：

- `superpowers:using-superpowers`
- `superpowers:test-driven-development`
- `superpowers:verification-before-completion`
- `superpowers:writing-plans`

如果至少存在 `superpowers:using-superpowers`，视为 Superpowers 可用。

## 3. Codex 环境

Codex 环境中，主 Agent 必须按以下顺序处理：

1. 查看当前会话可用 skills 列表。
2. 如果存在 `superpowers:using-superpowers`，读取该 skill。
3. 如果不存在，但存在无前缀版本，例如 `using-superpowers`，读取无前缀版本并继续。
4. 如果两者都不存在，检查是否存在 skill/plugin 安装能力。
5. 如果存在安装能力，安装或启用 Superpowers。
6. 安装后重新检查可用 skills。
7. 如果仍不可用，进入 `BLOCKED` 并向用户报告。

## 4. 非 Codex 环境

如果运行环境不是 Codex，主 Agent 必须判断该环境是否支持导入或安装 Superpowers 等价能力：

- 如果支持，先安装或启用。
- 如果不支持，必须向用户说明当前环境无法加载 Superpowers。
- 用户明确允许后，才可以按 `.agent-workflow/SKILLS.md` 的降级规则执行。

## 5. BLOCKED 报告模板

```markdown
# Superpowers Bootstrap Blocked

## 检查结果
Superpowers 不可用。

## 已尝试步骤
- [步骤 1]
- [步骤 2]

## 失败原因
[说明失败原因]

## 可选处理
1. 用户提供安装方式。
2. 切换到支持 Superpowers 的 Agent 环境。
3. 用户明确允许降级，使用角色文档内置检查清单执行。

## 建议
[主 Agent 建议]
```

## 6. 降级限制

以下任务不建议降级：

- 登录、认证、权限。
- 支付、订单、交易。
- 数据库迁移、批量删除。
- 密钥、环境变量、生产配置。
- AI API、外部 API、Webhook。
- 部署、CI/CD、生产发布。

如果用户仍要求降级，主 Agent 必须在交付报告中写明：

- Superpowers 不可用。
- 哪些 skill 使用了角色文档降级。
- 降级带来的风险。
- 哪些验证已补充执行。

## 7. 成功记录模板

```markdown
# Superpowers Bootstrap Result

## 结论
READY

## 可用入口
- `superpowers:using-superpowers`

## 已读取 Skill
- `superpowers:using-superpowers`

## 下一步
进入 `intake_hook`。
```

