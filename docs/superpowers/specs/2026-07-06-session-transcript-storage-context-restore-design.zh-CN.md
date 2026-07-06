# AgentDock 会话 Transcript 存储与上下文恢复设计

## 状态

等待用户审阅。本文档尚未进入实现阶段。

本文档是 `2026-07-06-session-transcript-storage-context-restore-design.md` 的中文版本，后续评审和实施以中文版为准。

## 风险等级

L3。

原因：本需求会修改会话历史持久化、PTY 输出存储、上下文摘要输入组装、Renderer 恢复 UI、本地清理行为，以及 secret 脱敏边界。

## 问题

AgentDock 当前把终端回放文本保存在 `sessions.json` 中，并设置了单会话 5 MB 保存上限。这个上限可以保护本地 JSON 文件，但它不是 AI 上下文限制。底部显示 `终端回放保存已达 5MB` 会让用户误以为应该新开 AI 会话，但真实问题只是本地回放存储达到内部保护阈值。

这带来三个产品问题：

- 5 MB 对 Claude/Codex 终端输出偏小。测试日志、构建输出、agent 工具输出很快就可能达到。
- 大段终端输出写在 `sessions.json` 中，会让 metadata 存储变慢、变脆弱。
- 终端回放历史不等于模型上下文。重启 AgentDock 窗口只能恢复 UI transcript；AI CLI 能否接上之前工作，取决于 AgentDock 是否显式把摘要或近期脱敏上下文注入到新的终端会话里。

## 目标

- 移除底部 `5MB` 提示及其 `新开会话` / `存档历史` 操作。
- 保留对人有用的终端回放，但不把它当作 AI 上下文。
- 将大段终端输出从 `sessions.json` 迁移到每个 session 独立的 transcript 文件。
- 历史回放时只加载有边界的 transcript tail。
- AI 续接材料使用 `summary + 最近脱敏 transcript tail`。
- 增加本地清理策略，限制 transcript 存储总量，同时不打断用户当前工作。
- 保持现有 secret 边界：完整 API Key 不得进入 renderer state、IPC 响应、summary 文件、handoff 文件、日志或生成的续接 prompt。

## 非目标

- 不做向量数据库、搜索索引、云同步或 dashboard。
- 不做自动路由、fallback 或 provider 行为变化。
- 不根据本地字节数声称精确模型 token 数。
- 不因为 App 重启就静默调用 Claude/Codex 生成摘要。
- 默认不把完整终端 transcript 写入 workspace 项目目录。

## 产品行为

### 终端回放

终端回放变成本地的人类可读历史能力。当本地存储达到内部阈值时，不应该要求用户新开会话。

恢复历史 session 时，AgentDock 从 transcript 文件读取有边界的 tail，并把这段 tail 回放到 xterm。第一版使用单 session 20 MB tail 上限。如果 transcript 大于 tail 上限，UI 可以在会话详情中低调显示 `已加载最近 20 MB 终端记录`，但不得显示底部 warning bar。

### Session Metadata

`sessions.json` 只保存轻量 metadata：

- session id
- profile id
- workspace id
- command
- title
- status
- timestamps
- resume command
- Claude launch mode
- transcript metadata，例如路径、字节大小、UI replay tail 是否被截断

`sessions.json` 不再保存终端输出正文。

### Transcript 文件

每个 session 的 PTY 输出写入 Electron `userData` 下的独立 transcript 文件，而不是写入 workspace：

```text
<userData>/session-transcripts/<session-id>.log
```

原因：

- 终端输出可能包含私有项目数据或命令输出。
- 原始 transcript 写进 workspace 有被误提交到 git 的风险。
- 现有 summary 和 handoff 文件已经把整理过、脱敏过的续接材料写入 `.agentdock/context/`。

session 运行期间 transcript 文件采用 append-only 写入。store 必须按 session 串行化写入，避免并发写坏文件。

### 清理策略

本地历史受两个限制保护：

- 按 metadata 时间保留最近 50 个 session。
- transcript 总存储量保持在 1 GB 以下。

超过任一限制时，AgentDock 删除最旧的非运行中 session metadata 及其 transcript 文件。运行中的 session 不删除。清理是 best-effort，不得中断活动 PTY 输出。

### 上下文恢复

AgentDock 通过显式续接材料恢复 AI 上下文，而不是通过终端 UI 回放恢复。

对 Claude/Codex agent session，续接材料由以下内容组成：

- source session 最新的有效 AgentDock summary 或 handoff，如存在
- 最近一段脱敏 transcript tail
- 最小 session metadata：profile id、workspace id、command、timestamps、exit/interrupted status

当用户恢复、重启或继续 interrupted agent session 时，AgentDock 在新 PTY 启动成功后注入一段短启动 prompt。这个 prompt 应指示 CLI 根据 AgentDock restore material 继续工作，并且只包含有边界、已脱敏的内容。

如果没有 summary，第一版使用脱敏 transcript tail 作为 fallback。不得静默运行摘要模型调用。UI 仍可提供 `总结并续开`，这个动作会明确使用已配置的 Claude/Codex profile，并消耗本机 API 额度。

### 上下文压力

上下文压力条应基于续接材料大小、summary 状态和 transcript tail 大小，而不是把旧的 5 MB 回放上限直接当作 `已满` 原因。

可见文案应聚焦 AI 上下文：

- `续接材料偏大`
- `建议总结当前会话`
- `总结当前会话`
- `总结并续开`

不得再表达“本地终端回放存储已满”。

## 架构

### Main Process

新增或演进边界清晰的小模块：

- `sessionHistoryStore`：保存 metadata，并编排旧 JSON 结构迁移。
- `sessionTranscriptStore`：追加 PTY 输出、读取有边界 tail、报告字节大小、删除旧 transcript 文件。
- `contextRestore`：基于 summary/handoff 和 transcript tail 构建脱敏 restore prompt。
- `contextBudgetEstimator`：根据 summary 和 transcript-tail 输入估算续接压力，而不是根据本地回放容量估算。

`SessionService` 继续作为编排层：

- PTY 输出时：追加到 live in-memory buffer 和 transcript 文件。
- `readTerminalBuffer`：对持久化 session 返回 transcript tail；对活动 session 返回 live buffer。
- launch/restart/resume：保留 profile、workspace、command 和 Claude launch mode。
- continuation：只在 PTY 成功启动后注入 restore prompt。

### Renderer

移除底部 `SessionHistoryLimitBar`。

工作台仍保留：

- terminal tabs
- terminal replay tail
- exited/interrupted session 的恢复操作
- continuation material 为 high/full 时显示 context pressure bar
- summary 和 continue 操作

会话详情中可以展示低优先级 transcript metadata，但主工作台不得把存储上限 warning 当作工作流阻塞提示。

### IPC And Preload

现有 IPC 方法保持最小白名单。归档相关 UI 路径应移除或弱化。

IPC 响应不得包含原始完整 transcript body。唯一例外是专门的 `readTerminalBuffer` 方法，并且该方法对持久化 transcript 文件只能返回配置好的有边界 tail。

### 迁移

启动时，如果现有 `sessions.json` entry 仍包含 `terminalBuffer`，AgentDock 迁移它们：

1. 为每个 entry 创建 transcript 文件。
2. 将旧 buffer 写入该 transcript 文件。
3. 用 metadata 和 transcript info 替换 JSON entry。
4. 如果 JSON repair 或迁移遇到 malformed content，保留可恢复备份。

迁移必须幂等。重复运行不得重复写入 transcript 内容。

## 安全要求

- 原始 transcript 文件保存在 Electron `userData`。
- Summary input 和 restore prompt 发送给 Claude/Codex 前必须经过 secret-like pattern 脱敏。
- 完整 API Key 不得写入 summary output、handoff 文件、renderer state、日志、IPC metadata 或 restore prompt。
- transcript 迁移、清理或 summary 生成的错误信息不得包含 secret。
- 清理逻辑不得删除 workspace 文件；只删除 AgentDock 自己在 userData 下管理的 transcript 文件及匹配 session metadata。

## 错误处理

- Transcript append 失败：保留 live in-memory terminal buffer；只有持久化持续不可用时才显示不含 secret 的错误。
- Transcript tail 读取失败：保留 session tab，显示可恢复回放错误，并允许 restart/close 操作。
- 单个 session 迁移失败：跳过该 session，保留备份，继续加载其他 session。
- 清理失败：记录脱敏 warning，并在下一次启动或下一次 session save 时重试。
- PTY 启动后 restore prompt 注入失败：保留新终端运行，并显示上下文注入失败。

## 测试要求

单元测试：

- 包含 `terminalBuffer` 的旧 `sessions.json` 会迁移到 transcript 文件。
- `sessions.json` 不再保存大段终端输出。
- transcript append 和 tail read 保持 UTF-8 边界。
- tail replay 限制为 20 MB。
- cleanup 保留最近 50 个 session，并把 transcript 总存储量控制在 1 GB 以下。
- cleanup 不删除 running session。
- context restore prompt 包含 summary/handoff 和脱敏 transcript tail。
- context restore prompt 不包含 secret-like 值。

Renderer 测试：

- 底部 `终端回放保存已达 5MB` bar 不再出现。
- `新开会话` / `存档历史` 不再作为存储上限动作出现。
- high/full continuation material 时，context pressure actions 仍可见。
- 恢复 session 仍能渲染 terminal replay。

集成检查：

- `npm run workflow:doctor`
- `npm run test:workflow`
- `npm test`
- `npm run typecheck`
- `npm run build`

真实验证：

- 启动 Claude session，产生超过旧 5 MB 阈值的输出，重启 AgentDock，确认不再出现底部 5 MB warning。
- 确认恢复后的终端显示最近输出 tail。
- 使用 `总结并续开` 或 resume/restart continuation，确认新 PTY 收到 restore prompt。
- 确认 transcript metadata、summary/handoff 文件、renderer state 和日志中没有完整 API Key。

## 验收标准

- 底部 5 MB warning 和 archive/new-session 存储动作已移除。
- 大段终端输出写入 per-session transcript 文件，而不是 `sessions.json`。
- 旧 session history 能迁移，且不丢失可恢复 metadata。
- UI replay 加载有边界的近期 transcript tail。
- Summary 和 continuation 使用脱敏 summary 加最近 transcript tail。
- 本地 transcript cleanup 能在不打断 running session 的前提下执行 50 session 和 1 GB 总量限制。
- 必要测试和 build 通过。
- 记录真实 Claude/Codex continuation 验证；如果外部 provider 不可用，必须明确写明未验证项。
