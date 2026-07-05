# 上下文预算防护与自动总结设计

## 状态

用户已在 2026-07-05 确认设计方向。当前尚未开始实现。

本文件是 `2026-07-05-context-budget-auto-summary-design.md` 的中文版本，语义与英文版保持一致。

## 风险等级

L3。

该功能涉及 LLM 调用、API Key 注入边界、workspace 文件写入、会话历史、终端会话，以及用户可见的续接工作流。实现前必须走标准 L3 流程。

## 问题

AgentDock 目前可以在本地保留终端输出，但本地输出历史不等于模型上下文。长时间运行的 agent 会话仍然容易成本升高、稳定性变差，因为项目规则、skill 文档、命令输出、测试日志和重复终端回放都会快速消耗当前 Claude/Codex 对话上下文。

当前 5MB 会话历史上限只是本地持久化保护。它不能阻止当前 agent 对话携带过多低价值上下文，也没有给用户提供一个干净的“总结并开新会话继续”的流程。

## 目标

- 当会话可能积累过多上下文时提醒用户。
- 允许用户把长会话总结成一个短的本地 handoff。
- 允许用户基于 handoff 开新会话继续，而不是把完整 transcript 注入新会话。
- 在手动流程可靠后，支持可选的自动总结模式。
- 保持终端优先、轻量的产品方向。
- 避免完整 API Key 进入 renderer state、IPC 响应、日志、摘要或 workspace context 文件。

## 非目标

- 不做 API gateway、provider router、fallback service、成本 dashboard 或请求日志。
- 不做向量数据库、语义搜索服务、云同步或团队记忆。
- 不试图修改 Claude/Codex 内部上下文窗口行为。
- 不把完整 transcript 自动注入新会话。
- 默认不做静默模型调用。

## 产品行为

### 上下文预算防护

AgentDock 会为每个 agent 会话显示一个小型上下文压力指示：

- `低`：输出和 workspace context 明显低于警戒阈值。
- `中`：输出正在增长，用户应该考虑稍后总结。
- `高`：推荐总结并在新会话中继续。
- `已满`：本地历史达到保存上限，或总结输入会超过配置上限。

该指示是基于本地字节数和增长速度的估算，不得声称是精确模型 token 数。

主要输入：

- session history buffer 字节数
- workspace transcript 字节数
- `shared-context.md` 字节数
- 最近输出增长速度
- 是否已经达到 5MB 历史上限

初始阈值：

- `低`：pressure score 低于 50。
- `中`：pressure score 为 50 到 79。
- `高`：pressure score 为 80 到 99。
- `已满`：pressure score 为 100，或本地历史达到上限。

第一版 pressure score 应该使用简单的归一化本地尺寸信号取最大值，不做复杂加权模型。实现时可以根据真实会话数据调整常量，但 UI 状态机保持不变。

### 手动总结流程

第一版实现应提供明确的用户操作：

- `总结当前会话`
- `总结并续开`

用户开始总结时，AgentDock 显示所选总结 provider profile、估算输入大小和目标输出文件。除非用户明确停止，原终端继续运行。

默认总结 provider 使用当前会话 profile。后续可以增加设置，让用户为每个 workspace 选择专用 summarizer profile，但 Phase 1 不要求做该设置 UI。

总结生成读取：

- 当前 session 的上一次 summary，如果存在
- 已脱敏 session transcript 的截断尾部
- 最小会话 metadata：profile id、workspace id、command、timestamps、exit status

总结生成写入：

- `.agentdock/context/summaries/<session-id>.md`
- `.agentdock/context/handoffs/<session-id>.md`

handoff 是给下一个会话使用的短文件。完整 transcript 保留为本地历史，不默认注入新会话。

### 续接流程

`总结并续开` 在总结成功后，使用同一个 profile、workspace 和 command 启动新会话。新会话应清晰展示 handoff 路径，并提供可复制的启动提示：

```text
Read the AgentDock handoff first, then continue the task:
<handoff-file-path>
```

第一版不要求把提示自动写入新 CLI 的 stdin。后续如果增加，也必须是用户可见的显式 opt-in 行为，因为不同 agent CLI 的启动时机和 prompt 处理方式不同。

### 可选自动总结

自动总结是一个设置项，默认关闭。

开启后，当会话达到高压力阈值时，AgentDock 可以运行一次 summary job。必须限制重复总结频率，并在 summary job 运行或失败时显示可见状态。

默认配置下不允许静默后台调用模型。

## 摘要内容

summary 和 handoff 使用稳定 Markdown 标题：

```markdown
# AgentDock Session Summary

## Current Goal

## Decisions

## Files And Areas Touched

## Commands And Verification

## Problems And Risks

## Next Steps

## Source
```

`Source` 必须包含原始 transcript 路径、使用的字节范围或 tail 大小、生成时间和 summary provider profile id。不得包含完整环境变量或 secret。

写入前必须验证生成的 Markdown：

- 必须包含规定标题
- 文件大小低于配置的 summary limit
- 明显 secret pattern 已被脱敏
- 输出是纯 Markdown，而不是藏在 Markdown 里的 JSON

如果验证失败，summary job 必须以可见方式失败，终端会话继续不受影响。

## 架构

### Main Process

新增小而明确的模块，不把无关职责塞进现有 store：

- `contextBudgetEstimator`：根据本地尺寸和状态计算压力。
- `sessionSummaryStore`：在 `.agentdock/context/` 下读写 summary 和 handoff 文件。
- `summaryJobService`：编排脱敏、截断输入组装、一次性 summarizer 执行、验证和结果持久化。

summarizer 必须复用现有 profile/secret/PTY 环境边界。实现时必须先验证每个支持 CLI 的真实 one-shot 命令能力，再启用该 provider。不支持的 provider 应返回 unavailable，而不是靠猜测执行。

### Renderer

保持终端优先：

- 在会话详情或标签 metadata 中显示紧凑 pressure badge
- 只有在压力为 `高` 或 `已满` 时显示 warning row
- 操作包括：`总结当前会话`、`总结并续开`、`打开摘要`、`复制续接提示`
- 不新增 dashboard

### IPC And Preload

暴露最小白名单方法：

- 获取 sessions 的 context pressure
- 启动 summary job
- 读取 summary metadata 或内容
- 基于 handoff 续开

IPC 响应不得包含完整 secret、完整 env object 或未脱敏原始 transcript 内容。

## 数据流

1. PTY output 继续追加到 session history 和 workspace transcript。
2. estimator 根据本地文件和 buffer 大小更新 pressure。
3. 用户点击 `总结当前会话` 或 `总结并续开`。
4. Main process 收集 previous summary 和截断后的脱敏 transcript tail。
5. one-shot summarizer 使用所选 profile 和隔离环境运行。
6. 输出经过验证和 secret-like pattern 扫描。
7. summary 与 handoff Markdown 文件写入本地。
8. `shared-context.md` 重建，优先使用 summaries 和少量 recent output tail。
9. 如果用户选择续开，则启动新会话，并展示 handoff path 和 startup prompt。

## 安全要求

- 完整 API Key 绝不能写入 summary input files、summary output files、handoffs、renderer state、IPC payloads、logs 或 test fixtures。
- summary input 发送给 summarizer 前必须先脱敏。
- summary 失败信息不得打印 secret。
- summary job 必须使用和 session launch 相同的 secret adapter 边界。
- Renderer 只能展示 provider id/name 和 masked key state。
- `.agentdock/context/` 下的 workspace 文件继续保持 git-excluded。

## 错误处理

- Summarizer 不可用：显示清晰 unavailable 状态，保持 session 运行。
- Summarizer 非 0 退出：记录 failed job status，不修改已有 summaries。
- 输出验证失败：不写入无效 summary，显示验证原因。
- 文件写入失败：生成结果只在内存中保留到错误上报完成，然后丢弃。
- summary 成功但新 session 启动失败：保留 summary 和 handoff，展示 handoff path 供手动续接。

## 测试要求

单元测试：

- pressure estimator thresholds
- summarizer input 前的 secret redaction
- summary Markdown validation
- summary store path generation 和 git-exclude behavior
- failed summary jobs 不影响 active sessions

IPC/preload 测试：

- whitelisted summary methods 存在
- 响应不包含完整 secret、完整 env object 或 raw transcript content

Renderer 测试：

- 高压力时出现 pressure warning
- 手动总结操作调用 IPC method
- `总结并续开` 只在 summary success 后启动新 session
- 失败状态可见且不阻塞

集成测试：

- fake summarizer 生成 summary 和 handoff 文件
- `shared-context.md` 优先使用 summary content，而不是大段 transcript tail
- continuation session 使用同一个 profile/workspace/command，不复制完整 transcript

L3 真实验证：

- 每个启用 summarizer provider 都要做真实 node-pty/CLI smoke
- 真实 workspace `.agentdock/context/` 文件创建
- 对 summaries、handoffs、shared context 和 logs 做 secret-pattern scan
- `npm run workflow:doctor`
- `npm run typecheck`
- `npm run build`
- 相关测试套件

## 分阶段落地

Phase 1：

- 手动 context pressure indicator
- 手动 summary job
- summary 和 handoff 文件
- 基于 summary 的 continuation action

Phase 2：

- 高压力时 opt-in 自动总结
- rate limiting 和可见 job status

Phase 3：

- 根据真实 Claude/Codex CLI smoke 结果做 provider 专属细化

## 实现默认值

- Summary provider：当前 session profile。
- Phase 1 continuation：只提供可复制 startup prompt，不做自动 stdin injection。
- Phase 1 thresholds：`低` 低于 50，`中` 为 50-79，`高` 为 80-99，`已满` 为 100 或 history limit reached。
