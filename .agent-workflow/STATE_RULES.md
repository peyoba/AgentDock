# State Rules

本文件定义 `.agent-workflow/state.md` 的维护规则。状态文件是多 Agent 协作的单一运行事实来源。

## 1. 基本原则

- 每个 hook 结束后，主 Agent 必须更新 `.agent-workflow/state.md`。
- 每次派发子 Agent 前，主 Agent 必须记录派发角色、任务卡路径和当前状态。
- 每次收到 handoff 后，主 Agent 必须记录角色结论和下一步。
- 出现 `BLOCKED` 时，不能继续派发后续角色，除非用户明确解除阻塞。

## 2. 状态枚举

| 状态 | 含义 |
|------|------|
| `READY` | 已准备，等待执行 |
| `RUNNING` | 正在执行 |
| `PASS` | 当前角色或 hook 通过 |
| `FAIL` | 当前角色或 hook 未通过，可打回 |
| `BLOCKED` | 无法继续，需要用户或外部条件 |
| `SKIPPED` | 按规则跳过，必须说明原因 |

## 3. Hook 状态

`当前 Hook` 只能使用以下值：

- `superpowers_bootstrap_hook`
- `intake_hook`
- `risk_classification_hook`
- `plan_review_hook`
- `dispatch_hook`
- `red_hook`
- `green_hook`
- `acceptance_hook`
- `quality_gate_hook`
- `security_gate_hook`
- `risk_gate_hook`
- `performance_gate_hook`
- `integration_hook`
- `delivery_hook`
- `emergency_fix_hook`

## 4. 必填字段

`.agent-workflow/state.md` 必须包含：

- 当前任务
- 风险等级
- 当前 Hook
- 当前阶段
- 已派发角色
- 阻塞点
- 用户待确认
- 下一步
- 决策记录

## 5. 更新时机

主 Agent 必须在以下时机更新 state：

| 时机 | 必须更新内容 |
|------|--------------|
| 工作流启动 | 当前 Hook、当前阶段、Superpowers 状态 |
| 完成 intake | 任务目标、待确认问题 |
| 完成分级 | 风险等级、触发原因 |
| 完成 SPEC | SPEC 路径、用户待确认 |
| 派发子 Agent | 角色、任务卡路径、状态 `RUNNING` |
| 收到 handoff | 角色状态、产出路径、下一步 |
| 打回 | 打回来源、打回对象、次数、原因 |
| BLOCKED | 阻塞点、需要用户做什么 |
| 交付前 | 测试结果、验证结果、风险结论 |
| 交付后 | 交付状态、报告路径 |

## 6. 打回计数

每个角色对同一任务的打回最多 2 次。

state 中必须记录：

```markdown
## 打回记录
| 时间 | 来源角色 | 打回对象 | 次数 | 原因 |
|------|----------|----------|------|------|
```

超过 2 次时：

1. 当前任务进入 `BLOCKED`。
2. 主 Agent 停止继续派发。
3. 主 Agent 向用户说明原因并请求决策。

## 7. BLOCKED 处理

出现以下情况必须进入 `BLOCKED`：

- Superpowers 安装失败，用户未允许降级。
- SPEC 不清且无法从上下文推断。
- 测试命令、构建命令或包管理器无法确定。
- L3 任务缺少安全/风险/真实验证能力。
- 同一问题超过 2 次打回。
- 用户决策必需但尚未提供。

## 8. state 更新模板

```markdown
# Agent Workflow State

## 当前任务
[任务名]

## 风险等级
L1 / L2 / L3

## 当前 Hook
[hook 名称]

## 当前阶段
[intake / plan / red / green / acceptance / quality / security / risk / performance / integration / delivery / blocked]

## 已派发角色
| 角色 | 状态 | 任务卡 | 产出 |
|------|------|--------|------|

## 打回记录
| 时间 | 来源角色 | 打回对象 | 次数 | 原因 |
|------|----------|----------|------|------|

## 阻塞点
[没有则写“无”]

## 用户待确认
[没有则写“无”]

## 下一步
[明确下一个 hook 或角色]

## 决策记录
| 时间 | 决策 | 理由 |
|------|------|------|
```

## 9. 禁止事项

- 禁止状态文件长期停留在旧 hook。
- 禁止角色已经完成但 state 仍显示 `RUNNING`。
- 禁止出现 `BLOCKED` 后继续派发后续角色。
- 禁止交付报告和 state 结论不一致。

