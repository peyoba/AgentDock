# AgentDock 清晰会话记录与原始 PTY 分流设计 SPEC

## 文档状态

- 日期：2026-07-24
- 语言：中文（本文件是本项目评审和实施的准据版本）
- 当前阶段：设计已完成分段确认，等待用户审阅书面 SPEC
- 实施状态：未开始；用户批准本 SPEC 前不得修改业务代码
- 风险等级：L3

## 1. 背景

AgentDock 当前已经保存每个 Session 的终端 transcript、摘要和恢复材料，但“终端可回放内容”和“用户可阅读的会话记录”仍然混在一起：

- Claude、Codex、Grok 的 TUI 会反复重绘、显示状态栏和控制序列；直接展示 PTY 历史会产生黑屏、重复、乱码或难以阅读的内容。
- 继续在单一终端文本上叠加正则清洗，无法稳定判断一行内容是用户消息、Agent 回复还是 TUI 噪声。
- 恢复上下文可能包含较长正文。用户只需要知道“记忆已恢复”，不应在清晰历史中看到恢复正文，也不应让恢复正文污染输入框。
- 旧 Session 只有 PTY 文本时，不能把猜测出的角色标记伪装成可信的对话记录。

本功能把“可读记录”和“原始终端”拆成两个明确的数据和交互通道：清晰记录是正式的只读会话资产；原始 PTY 仅用于用户主动打开的高级诊断。

## 2. 目标

1. 为每个 Session 保存独立、可去重、可增量同步的结构化事件流。
2. 默认向用户展示可信的用户消息、Agent 回复、工具调用、工具结果和必要状态。
3. 运行中的 Session 默认保持终端优先；停止、退出或中断的 Session 打开时默认进入清晰记录。
4. 清晰记录只读；需要继续输入时，用户必须显式切换到“交互终端”。
5. 原始 PTY 输出默认隐藏，仅在“高级诊断”中以脱敏、明确标注的方式查看。
6. 恢复时优先使用清晰事件和已有摘要；完整恢复正文不显示在清晰记录中，只显示一句状态。
7. 没有稳定原生记录时明确显示“部分可用/暂不可用/可能滞后”等状态，不从 PTY 猜测对话角色。
8. 保持现有终端、Profile、Workspace、Secret Vault 和多 Session 隔离边界，不引入 API Gateway、自动路由或新的第三方依赖。

## 3. 非目标

- 不把原始 PTY 文本转换成“看起来像真实对话”的伪结构化记录。
- 不实现基于 LLM 的角色分类、自动总结或语义检索。
- 不改造 Claude、Codex、Grok 的上游协议，不解析其完整请求正文或工具 SSE 以外的内部协议。
- 不导出原始 PTY；MVP 只支持清晰记录的纯文本复制和 Markdown 导出。
- 不把清晰记录写入 `sessions.json` 或现有终端 transcript 文件。
- 不把完整恢复正文、API Key、Token、完整环境变量、原始 payload 或原生日志路径返回 Renderer 或写入前端持久化状态。
- 不为旧 Session 自动补造可信事件；旧记录只有在发现可靠原生来源时才可建立清晰记录。
- 不增加成本统计、请求日志、团队同步、云端存储、复杂 Dashboard 或完整 IDE 能力。

## 4. 已确认的方案与取舍

### 4.1 方案比较

| 方案 | 做法 | 主要问题 | 结论 |
|------|------|----------|------|
| 单一 transcript 继续正则清洗 | 在现有 PTY 文本上不断增加规则 | 依赖 TUI 细节，容易误删或误分类；无法证明角色可信 | 不采用 |
| 原生结构化记录 + 清晰记录/PTY 双通道 | 从 CLI 原生记录读取事件，正式记录与原始诊断分开 | 需要为工具维护适配器；部分工具或旧会话可能不可用 | 采用 |
| LLM 重建对话 | 将 PTY 文本交给模型分类/总结 | 增加成本和不确定性，可能泄露私有文本，无法作为可信审计记录 | 不采用 |

### 4.2 核心决策

- 原生结构化记录是唯一可生成“可信角色事件”的来源。
- 适配器读取不到稳定来源时，状态必须降级为 `partial` 或 `unavailable`；不得静默回退到 PTY 角色猜测。
- 清晰记录与原始 PTY 独立保存、独立 IPC、独立 UI 入口。
- 运行中默认交互终端；停止/退出/中断默认清晰记录。
- 清晰记录只读；继续操作必须显式进入交互终端。
- “记忆已恢复”只显示一句短状态；恢复正文只能作为后台恢复材料，不进入清晰记录正文。

## 5. 用户路径

### 5.1 打开 Session

1. 用户从左侧长期会话库选择 Session。
2. 若 Session 绑定活动 PTY 且当前窗口拥有运行权，默认打开“交互终端”。
3. 若 Session 已停止、退出、中断或失败，默认打开“清晰记录”。
4. 若清晰记录正在同步，页面先展示已持久化事件，并显示“可能滞后/正在同步”状态。
5. 若清晰记录不可用，显示原因和“打开高级诊断”入口；不得把原始 PTY 自动当作正式记录。

### 5.2 查看和继续

- 清晰记录页面提供只读时间线、复制和 Markdown 导出。
- 用户点击“交互终端”后，才允许向 PTY 写入、调整终端尺寸或继续会话。
- 用户点击“高级诊断”后，才加载经脱敏的原始 PTY 片段；诊断视图必须明确标注“非正式记录”。
- 运行中的只读观察窗口不能抢占其他窗口的 PTY 所有权。

### 5.3 恢复

1. 恢复流程先读取清晰事件和已有摘要。
2. 有可靠原生恢复能力时，继续使用既有 native resume；否则使用 AgentDock restore context fallback。
3. 恢复正文不写入清晰事件、不显示在普通历史、不进入 Session command 或进程 argv。
4. UI 只显示一条状态，例如 `记忆已恢复：已加载最近会话背景，等待你的下一步指令。`。
5. 没有可用材料时显示 `未找到可恢复记忆`；写入或注入失败时显示 `记忆恢复失败`，并保留可诊断原因（不得包含 Secret）。

## 6. 清晰事件模型

### 6.1 事件类型

正式记录只允许以下事件类别：

| 类型 | 默认展示 | 内容边界 |
|------|----------|----------|
| `user_message` | 是 | 用户明确提交的消息；保留脱敏后的可读正文 |
| `assistant_message` | 是 | Agent 的正式回复；不包含 TUI chrome 或控制序列 |
| `tool_call` | 是 | 工具名称和有界参数摘要；不保存完整请求正文 |
| `tool_result` | 是 | 成功/失败状态和受限输出；过长内容截断并标记 |
| `status` | 是 | 启动、恢复、完成、失败、等待输入等必要生命周期状态 |

以下内容不得写入清晰事件：TUI 重绘、光标移动、备用屏幕切换、`Working`/spinner、重复提示词、恢复正文、原始请求/响应 payload、完整环境变量和 Secret。

### 6.2 事件字段

每条事件至少包含：

```text
eventId       原生事件 ID；没有时由适配器生成稳定哈希
sessionId     AgentDock Session ID
runId         本次启动/恢复批次 ID
sequence      适配器来源内的单调序号（可缺省但必须标明）
occurredAt    事件时间；无法确认时使用读取时间并标记时间来源
kind          user_message / assistant_message / tool_call / tool_result / status
source        claude / codex / grok / agentdock
trust         native / derived-status；禁止用 derived-status 表示角色事件
payload       已脱敏、已限长的结构化内容
truncated     是否发生长度截断
```

Renderer 只接收专用的脱敏 DTO。DTO 不包含原始文件路径、游标内部值、适配器错误堆栈、Secret 或完整 payload。

### 6.3 去重和顺序

- 首选 `source + nativeEventId` 去重；没有原生 ID 时使用适配器定义的稳定内容哈希和来源游标。
- 同一个事件重复读取不得在 JSONL 中追加第二份。
- 事件展示按 `occurredAt`、`sequence`、写入顺序的稳定优先级排序，不依赖文件名排序。
- 乱序事件必须保留来源信息并标记同步状态，不得静默重写成错误的时间线。

## 7. 原生记录适配器

### 7.1 边界

主进程新增 `RecordSourceAdapter` 抽象；Claude、Codex、Grok 各自实现适配器。适配器只允许读取经过校验的 Profile/Home/Session 路径：

- 不接受 Renderer 传入的任意路径。
- 不跟随逃逸 workspace 或受保护目录的符号链接。
- 不读取或返回完整 Secret。
- 不把 CLI 日志解析逻辑塞入 `SessionService`。

建议的最小契约：

```ts
type RecordSourceAdapter = {
  probe(input: RecordSourceProbeInput): Promise<RecordSourceCapability>;
  readIncremental(input: RecordSourceReadInput): Promise<RecordSourceBatch>;
};
```

契约必须支持能力探测、游标、分片读取、适配器错误和明确的可用性状态。具体原生文件格式不写死在共享类型中，由各适配器内部处理。

### 7.2 能力状态

适配器返回以下之一：

- `ready`：来源稳定、事件可读且可继续增量同步。
- `partial`：只能读取部分事件或来源可能缺失；页面必须显示部分可用。
- `unavailable`：没有可靠原生来源、版本不支持或路径不可访问。
- `failed`：读取发生可重试或需人工诊断的错误。

`unavailable` 不等于空会话；UI 必须区分“没有事件”和“没有可靠来源”。

## 8. 同步服务与生命周期

### 8.1 服务职责

`SessionRecordSyncService` 在主进程后台负责：

- 绑定原生 Session ID 与 AgentDock Session ID。
- 保存每个来源的游标、最近批次和去重索引。
- 调用适配器增量读取并写入 `SessionRecordStore`。
- 管理同步状态、重试、退避和最终同步。
- 向 SessionService 提供状态变化回调，但不负责 PTY 生命周期。

### 8.2 触发点

以下事件触发去抖同步：

1. Session 启动并完成原生 ID 绑定。
2. 发现 PTY 输出或原生记录文件发生变化。
3. 用户打开清晰记录。
4. Session 停止、退出、中断或重启前。
5. App/window 退出前的最终 flush。

同步可以短暂滞后，但不得阻塞 PTY 输入、输出或窗口响应。界面必须显示同步新鲜度：

`待同步`、`正在同步`、`已就绪`、`部分可用`、`可能滞后`、`同步失败`、`暂不可用`。

### 8.3 失败处理

- 单批次失败保留游标，不丢弃此前已写入的事件。
- 可重试错误使用有界退避；超过上限后显示 `同步失败`，允许用户手动重试。
- 解析错误只隔离损坏批次，不得用未验证文本继续冒充结构化事件。
- Session 退出时最终同步失败，仍保留清晰记录的最后一致版本并标记可能滞后。

## 9. 持久化边界

### 9.1 独立 JSONL

每个 Session 使用独立的私有 JSONL 事件文件和索引/游标元数据。推荐目录结构如下（最终文件名由实现按现有私有文件系统 helper 规范化）：

```text
<Electron userData>/session-records/<safe-session-id>/events.jsonl
<Electron userData>/session-records/<safe-session-id>/index.json
```

事件文件必须：

- 使用原子创建/替换和私有权限。
- 每行一个可校验 JSON 事件。
- 有单 Session 大小上限、单事件大小上限和总保留策略。
- 写入失败时不破坏上一份完整文件。
- 不在 `sessions.json` 中嵌入事件正文。

现有 `session-transcripts` 继续作为终端回放和高级诊断来源；它与清晰 JSONL 不互相冒充。

### 9.2 旧数据和迁移

- 旧 Session 没有可靠原生记录时，清晰记录状态为 `unavailable` 或 `partial`，不自动从旧 PTY 文本构建角色事件。
- 旧 transcript 可继续用于恢复 fallback 和高级诊断，但不得在普通清晰记录中显示为已验证对话。
- 迁移只能写入事件格式明确、来源可信且经过 Secret 脱敏的内容；迁移失败时保留原文件并标记状态。

## 10. UI 与 IPC

### 10.1 视图结构

清晰记录视图包含：

- Session 标题、工具/Profile/Workspace 脱敏摘要。
- 同步状态和来源可信度。
- 事件时间线，按事件类型使用稳定视觉层级。
- “交互终端”按钮。
- “复制清晰记录”和“导出 Markdown”按钮。
- “高级诊断”入口。

运行中的 Session 默认进入交互终端；非运行 Session 默认进入清晰记录。清晰记录不提供直接输入框或 PTY resize 控件。

高级诊断视图必须：

- 明确标记为 `原始 PTY（诊断，不是正式记录）`。
- 默认只读、按需加载、限长、脱敏。
- 不与清晰记录时间线混排。
- 不提供原始 PTY 导出按钮。

### 10.2 IPC 合同

建议增加独立的最小 IPC：

- `sessionRecords:list`：读取已脱敏事件 DTO 和同步状态。
- `sessionRecords:copyText`：主进程生成清晰记录纯文本，不把原始事件文件路径交给 Renderer。
- `sessionRecords:exportMarkdown`：主进程生成 Markdown 文件并返回用户选择的导出结果。
- `sessionDiagnostics:readPty`：用户明确打开高级诊断后读取限长、脱敏的 PTY 片段。
- `sessionRecords:sync`：用户明确触发一次同步/重试。

所有 IPC 必须按 Session ID 和窗口所有权校验；默认响应不得包含：

- 完整 API Key、Token 或完整环境变量。
- 原始 payload、原始日志路径、私有游标和适配器堆栈。
- 完整恢复正文。

## 11. 恢复与摘要策略

恢复材料优先级：

1. 清晰事件及其摘要。
2. 已有 AgentDock summary/handoff。
3. 清晰事件不可用时，后台使用现有脱敏 transcript tail fallback。

回退到 transcript 只影响恢复材料和高级诊断，不改变清晰记录的可信度状态。恢复正文始终隐藏；UI 只保留一句短状态。现有 `restoreContextStore` 的长度上限、Secret 脱敏和“短恢复提示注入”约束继续有效，并需在新服务接入后保持。

## 12. 安全与隐私要求

- 所有原生事件在入库前经过统一 Secret/敏感赋值脱敏；跨 chunk 的 Secret 不能因分片读取而漏出。
- 记录中只允许最小必要的工具参数和结果摘要；默认截断超长输出。
- 事件文件、索引、临时导出文件使用现有私有目录/私有文件 helper 和原子写入。
- 高级诊断也必须先脱敏；“原始”只表示未经角色整理，不表示可以绕过安全过滤。
- 错误信息、同步状态、复制/导出结果不得包含 Secret。
- 复制和导出默认只包含清晰记录；导出文件不包含原始路径、Secret 或恢复正文。
- Renderer 不保存完整事件原文、完整恢复材料或完整环境变量到持久化状态。
- 任何新增测试 fixture、截图、文档和验证记录不得包含真实 API Key 或 Token。

## 13. 边界情况与用户可见状态

| 情况 | 处理 | UI 状态 |
|------|------|---------|
| 原生来源尚未写入 | 保留空时间线，等待同步 | 待同步 |
| 原生来源只返回部分批次 | 保存可验证部分并标记缺口 | 部分可用/可能滞后 |
| 原生来源不存在或版本不支持 | 不猜测角色，不生成伪事件 | 暂不可用 |
| 单批次 JSON 损坏 | 隔离批次，保留上一致版本 | 同步失败 |
| Session 正在另一窗口运行 | 只读观察，不允许抢占 PTY | 另一窗口运行 |
| 用户复制/导出时仍在同步 | 导出最后一致版本并提示新鲜度 | 可能滞后 |
| 清晰事件为空但有旧 transcript | 仅供恢复 fallback/诊断 | 清晰记录不可用 |
| 恢复材料为空 | 不注入恢复提示 | 未找到可恢复记忆 |
| 恢复写入或注入失败 | 不执行大段 stdin fallback | 记忆恢复失败 |
| 事件/导出超过大小上限 | 截断并标记，不静默丢失 | 已截断 |

## 14. 测试与真实验收

### 14.1 自动化测试

必须覆盖：

- Claude/Codex/Grok 适配器的分片 JSON 读取、游标推进、乱序和 malformed 输入。
- 事件去重、重启后继续同步、重复批次不重复入库。
- 单事件/单 Session 大小上限、原子写入和损坏文件恢复。
- `ready`、`partial`、`unavailable`、`failed`、`stale` 等状态映射。
- Session 启动、PTY 输出、停止、退出、重启和 dispose 的同步触发时机。
- 运行中默认交互终端；停止/退出默认清晰记录；清晰记录只读。
- 复制纯文本、Markdown 导出和高级诊断的 IPC 白名单。
- Renderer 不接收完整 Secret、完整 env、原始路径、恢复正文或未脱敏 payload。
- 旧 Session 无可靠原生来源时不生成角色事件。
- 恢复优先级、状态一句话展示和失败/空材料分支。

### 14.2 L3 真实验证

在代码闸门通过后，必须补充真实记录，至少包括：

1. macOS 上实际 Claude、Codex、Grok 会话的原生记录探测和增量同步。
2. 两个并发 Session 的事件隔离、停止一个不影响另一个。
3. node-pty 输出、中文输入、Ctrl+C、退出前最终同步。
4. 重启 App 后清晰记录仍可读，恢复正文不进入 argv、输入框、普通 transcript 或 Renderer 持久化状态。
5. 真实 Secret scan、文件权限/所有权、导出脱敏检查。
6. Windows x64 真机或 CI runner 的可用性验证；未完成时结论保持 `PARTIAL`。

## 15. 文件边界

### 允许新增或修改（实施阶段）

- `src/shared/agentdockTypes.ts`、`src/shared/preloadTypes.ts`：事件和脱敏 DTO 合同。
- `src/main/recordSources/`：Claude/Codex/Grok 原生适配器及路径校验。
- `src/main/sessionRecordSyncService.ts`：游标、去重、后台同步和状态。
- `src/main/stores/sessionRecordEventStore.ts`：JSONL、索引、原子写入和保留策略。
- `src/main/sessionService.ts`、`src/main/main.ts`：生命周期触发和依赖注入。
- `src/preload/preload.cts`：最小 IPC 白名单。
- `src/renderer/components/` 与 `src/renderer/App.tsx`：清晰记录、交互终端切换和高级诊断入口。
- `tests/app/`：契约、服务、IPC、UI、安全和真实验证辅助测试。
- `.agent-workflow/verification/`、`.agent-workflow/delivery/`：验证记录和交付报告。

### 明确不改

- 不改包管理器、运行时版本、`package.json`、`package-lock.json` 或引入新依赖，除非后续评审另行批准。
- 不改 `.env`、Vault 内容、用户已有 Session 文件或 Workspace 业务文件。
- 不删除现有 transcript、summary、restore context；兼容迁移必须可回滚。
- 不把清晰记录逻辑塞进 Renderer 自己读取文件，也不让 `SessionService` 解析三种 CLI 的原生日志格式。

## 16. 实施批次建议

本 SPEC 获批后，再使用 `writing-plans` 生成精确文件级实施计划。建议分批：

1. **Batch 0：契约与 RED 测试** — 事件 schema、状态枚举、IPC 安全边界、适配器接口。
2. **Batch 1：原生适配器** — 逐个工具完成能力探测、分片读取和路径校验。
3. **Batch 2：私有事件存储与同步** — JSONL、索引、游标、去重、重试和最终 flush。
4. **Batch 3：Session/IPC 接线** — 生命周期触发、Renderer 脱敏 DTO、窗口所有权校验。
5. **Batch 4：清晰记录与高级诊断 UI** — 默认视图、只读操作、复制/导出、状态和降级提示。
6. **Batch 5：恢复整合与 L3 真实验收** — 恢复优先级、PTY/并发/Secret/打包验证。

每个批次遵循项目要求的 TDD 顺序：先写测试并确认合理 RED，再实现最小代码，最后经过验收、质量、安全和风险闸门。

## 17. 风险等级与触发原因

本任务为 **L3**，原因包括：

- 读取和持久化用户私有会话内容。
- 影响 PTY 生命周期、恢复行为和多 Session 并发边界。
- 涉及 Claude/Codex/Grok 原生记录、Profile/Home 路径和环境变量隔离。
- 需要在多个层级执行 Secret 脱敏，并进行真实 node-pty 和打包验证。

实施阶段必须启用 L2 基础角色，并触发安全、风险、集成和真实部署验证；本轮设计阶段不派发实现角色。

## 18. 验收标准

书面 SPEC 的产品验收标准如下：

1. 运行中 Session 默认进入交互终端；停止、退出、中断 Session 默认进入清晰记录。
2. 清晰记录只展示用户消息、Agent 回复、工具调用/结果和必要状态，不展示 TUI 重绘或恢复正文。
3. 原始 PTY 默认隐藏，只有用户主动打开高级诊断后可见，且始终脱敏并标注为非正式记录。
4. 清晰记录独立保存为按 Session 分隔的 JSONL 事件流，支持游标、去重、增量同步和最终 flush。
5. 无稳定原生记录时显示明确不可用/部分可用，不从 PTY 猜测角色。
6. 复制和 Markdown 导出只针对清晰记录，不提供原始 PTY 导出。
7. Renderer/preload/IPC 默认不返回完整 Secret、完整 env、原始 payload、私有路径或恢复正文。
8. 恢复优先使用清晰事件和摘要；fallback 只在后台使用脱敏 transcript，UI 只显示一句恢复状态。
9. 单 Session 失败、并发 Session、窗口所有权、退出前 flush 和旧数据兼容均有自动化测试和真实验证记录。
10. `npm run workflow:doctor`、`npm run typecheck`、`npm run build` 以及涉及工作流时的 `npm run test:workflow` 在实施批次中通过；真实验证未完成的项目必须标记 `PARTIAL`。

## 19. 设计自审结果

- 占位符扫描：无 `TODO`、`TBD` 或未决字段。
- 一致性检查：清晰事件、原始 PTY、transcript、summary 和 restore context 的职责已分开；恢复 fallback 不会改变清晰记录可信度。
- 范围检查：本 SPEC 只覆盖记录分流、同步、展示、诊断和恢复衔接；实现计划将按批次拆分。
- 歧义检查：运行中/非运行默认视图、不可用状态、导出边界、旧 Session 行为和 Secret 边界均已明确。

## 20. 用户审阅门禁

本文件写入后进入 `plan_review_hook`。在用户明确批准书面 SPEC 前：

- 不生成实施计划。
- 不新增或修改业务代码、测试或包配置。
- 不派发开发、测试、验收或质量子任务。
