# AgentDock 长期会话库与终端优先布局设计

## 状态

等待用户审阅。本文档尚未进入实现阶段。

本文档定义 AgentDock 下一阶段的会话模型、主界面信息架构和恢复语义。后续实施计划、测试拆分和代码修改必须以本文档的用户确认版本为准。

## 风险等级

L3。

原因：本设计后续会影响会话持久化、PTY 生命周期、Claude/Codex 恢复语义、Renderer 主界面、文件系统读取、IPC 边界和 secret 脱敏边界。

## 背景

当前 AgentDock 已经支持终端历史持久化、summary/handoff、restore context 和退出态恢复操作，但用户实际体验仍然不稳定：

- App 重启后标签可能还在，但关闭标签后用户难以确认历史是否仍然存在。
- UI 把“终端标签”“会话历史”“运行中的 PTY 进程”混在一起，导致关闭、恢复、重启、删除这些动作语义不清。
- 恢复效果依赖 summary 或 restore prompt fallback，用户很难判断是原生 CLI resume、AgentDock 摘要恢复，还是普通重新启动。
- 当前右侧详情面板对恢复问题帮助有限；用户更需要看到项目文件树、文件变化状态和当前会话状态。

用户确认的方向是：参考 Codex 一类长期会话记录体验，把会话记录做成长期资产，放在左侧会话库中；中间继续保持终端优先；右侧只做可收起的只读项目面板，不把 AgentDock 做成完整 IDE。

## 核心判断

AgentDock 的主模型应从“一个标签等于一个会话”调整为三层模型：

```text
Session Record（长期会话记录）
Open View（当前窗口打开的视图）
PTY Process（当前运行中的终端进程）
```

关闭视图只关闭当前窗口里的打开状态，不删除 Session Record。停止进程只终止 PTY，不删除 Session Record。删除记录必须是用户显式危险操作。

这条边界是本次改版的核心。只要仍把标签关闭当成会话删除，恢复体验就会继续混乱。

## 目标

1. 建立长期 Session Record：App 重启、窗口关闭、视图关闭后，会话记录和可恢复历史仍保留。
2. 将现有顶部标签模型改为左侧会话库：按 Workspace/project 分组，支持快速扫描和继续会话。
3. 保持终端优先：默认右侧项目面板收起，终端获得最大宽度；右侧展开后终端仍满足最小可用列数。
4. 明确操作语义：关闭视图、停止进程、继续会话、归档记录、删除记录分别表达不同生命周期动作。
5. 右侧项目面板提供只读文件树，展示当前项目文件和文件状态，不提供代码编辑器。
6. 文件树能标记当前 git 状态，以及本会话期间变化过的文件，但不能过度声称这些变化一定来自 agent。
7. 恢复优先使用 Claude/Codex 原生 resume 能力；没有原生 resume 信息时，才使用 AgentDock restore context fallback。
8. UI 明确展示恢复方式和恢复摘要，但不在顶部常驻大提示，不污染终端输入区。

## 非目标

- 不做完整 IDE。
- 不做 AgentDock 内置代码编辑器。
- 不做代码 diff 查看器。
- 不做复杂分屏工作台。
- 不做云同步、团队同步或跨机器会话同步。
- 不做向量数据库、全文搜索或完整 memory dashboard。
- 不把完整 transcript 默认展示在右侧面板。
- 不把 API Key、token、完整环境变量或完整 restore context 暴露给 Renderer。

## 产品模型

### Session Record

Session Record 是长期会话记录，是左侧会话库展示的基本对象。

每条记录至少包含：

- `sessionId`
- 标题
- 工具类型：Claude / Codex / zsh
- profile id 和脱敏 profile 名称
- workspace id、workspace 名称和路径
- command
- 运行状态：running / stopped / exited / interrupted / failed
- 归档标记：archived
- 创建时间、最后活动时间、最后恢复时间
- transcript 引用
- summary/handoff/restore context 引用
- 原生 CLI resume 信息，如 Claude/Codex session id 或 thread id
- 本会话期间变化文件索引

Session Record 不包含完整 API Key，不包含完整环境变量对象，不包含完整原始 transcript 正文。

### Open View

Open View 是某个窗口里当前打开的会话视图。它类似传统 tab，但不再等同于会话本身。

Open View 可以包含：

- 当前选中的 session id
- 侧栏展开状态
- 右侧面板展开状态
- 右侧面板宽度
- 文件树下方信息区高度
- 当前选中文件路径

关闭 Open View 不删除 Session Record，也不删除 transcript、summary 或 restore context。

### PTY Process

PTY Process 是当前正在运行的 `node-pty` 进程。

一个 Session Record 在同一时刻最多绑定一个活动 PTY Process。PTY 退出后，Session Record 仍存在，状态变为 exited、interrupted 或 failed。

停止操作只作用于 PTY Process。用户主动停止后，Session Record 状态变为 stopped；这和自然退出的 exited、App 重启或窗口销毁导致的 interrupted 分开。删除记录时如果 PTY 仍在运行，UI 必须先要求用户停止或在确认弹窗中明确说明会同时停止该进程。

### 多窗口并发语义

同一个 Session Record 可以被多个窗口看到，但同一时刻只能有一个可输入的运行所有者窗口。

规则：

- 如果窗口 A 已经让记录 X 绑定 running PTY，窗口 B 打开记录 X 时只能进入只读观察状态。
- 只读观察状态可以显示已持久化的终端历史、会话 metadata 和 `正在另一窗口运行` 状态。
- 只读观察状态不能向 PTY 写入输入，不能 resize PTY，不能隐式启动第二个 PTY。
- 如果可以定位 owner window，UI 可提供 `切换到运行窗口`；如果不能定位，只显示说明。
- 窗口 B 点击 `继续会话` 时必须失败并提示 `该会话正在另一窗口运行`，不得抢占。
- 只有 owner window 关闭或 PTY 退出后，其他窗口才能继续该 Session Record。

这样避免多窗口同时写同一个 Claude/Codex TUI，保留当前多窗口隔离策略，也避免同一长期记录产生两个互相竞争的 PTY。

## 主界面信息架构

```text
┌────────────────────────────────────────────────────────────────────┐
│ macOS titlebar / app chrome                                        │
├───────────────┬──────────────────────────────────────┬─────────────┤
│ 左侧会话库     │ 中间终端工作区                         │ 右侧项目面板 │
│ Session Lib   │ Terminal-first workspace              │ Project     │
└───────────────┴──────────────────────────────────────┴─────────────┘
```

### 左侧会话库

左侧会话库常驻，替代顶部会话标签。

内容结构：

- 顶部：AgentDock 标识、全局 `新会话` 按钮、搜索或过滤入口。
- 分组：按 Workspace/project 折叠分组。
- 会话行：标题、工具图标、状态点、profile 简写、相对时间。
- Hover 或右键菜单：更多操作。

搜索第一版只做本地轻量过滤：

- 匹配会话标题。
- 匹配 workspace 名称。
- 匹配 profile 名称。
- 支持前缀或包含匹配即可。
- 不搜索 transcript 正文，不做全文索引，不做语义搜索。

状态点建议：

- 绿色：running
- 蓝灰：stopped
- 灰色：exited
- 橙色：interrupted
- 红色：failed
- 归档记录：在归档过滤中使用空心或低对比状态点，不作为独立运行状态。

会话行菜单包含：

- `打开视图`：在当前窗口打开这条记录。
- `关闭视图`：只关闭当前打开状态，保留历史。仅对已打开记录显示。
- `继续会话`：按恢复策略启动新的 PTY。
- `停止`：仅 running 状态显示。
- `重命名`
- `归档`
- `删除记录`：危险操作，必须二次确认。

归档记录默认从左侧普通列表隐藏，通过 `全部记录` 或归档过滤入口重新显示。

左侧 `新会话` 是唯一常驻新会话入口。中间顶部不再放第二个 `新会话` 按钮。

### 中间终端工作区

中间区域继续是 AgentDock 主角。

中间顶部只服务当前会话：

- 当前会话标题
- 工具/profile/workspace 简写
- 状态 chip
- running 状态下显示小号红色停止图标，tooltip 为 `停止当前会话`
- `...` 更多菜单

启动命令栏保留在终端工作区内，作为创建或启动 session 的入口：

```text
Profile / Workspace / Command / Launch mode / 启动
```

`启动` 只出现在命令栏，不和当前会话标题挤在同一行最顶部。

中间不再显示传统横向标签栏。当前打开记录由左侧会话库选中态表达。

### 右侧项目面板

右侧项目面板默认收起为窄 rail。用户需要查看文件树、选中文件状态、恢复摘要或当前会话详情时再展开。

默认收起的原因：

- AgentDock 是终端优先工具。
- 文件树不是主 workflow 的高频操作。
- Claude/Codex TUI 对 100 到 120 列宽很敏感，不能常驻挤压终端。

展开后右侧面板的默认内容是只读文件树，不使用 `会话 / 文件 / 恢复` 顶部 Tab。

右侧面板顶部包含：

- Workspace/project 名称
- 当前路径定位输入或路径 chip
- `只读` 徽标
- 收起按钮

`只读` 徽标 tooltip 必须明确：`项目面板只用于查看文件和状态，AgentDock 不在这里编辑代码。`

## 布局硬约束

### 终端列数

布局必须以终端列数为核心约束：

- 右侧收起时，终端目标宽度约为 120 列或以上。
- 右侧展开时，终端可用宽度不得低于 100 列。
- 窗口变窄时，收缩优先级是：先收右侧项目面板，再压缩左侧会话库，最后才压缩终端。

实现时不应只写固定百分比。应根据 xterm 实际字符宽度或保守字符宽度估算终端最小像素宽度：

```text
terminalMinWidth = terminalCharWidth * 100 + terminalChromePadding
rightPanelMaxWidth = availableWidth - leftSidebarWidth - terminalMinWidth
```

如果右侧展开会让终端低于 100 列，右侧必须自动收起或变成 overlay。

### 推荐宽度

- 左侧会话库：默认 260 到 300 px，最小 220 px。
- 右侧项目面板：默认 340 到 380 px。
- 右侧项目面板最大宽度必须受终端 100 列硬约束限制。
- 右侧 rail：只保留图标，不使用高对比红色数字。

如果 rail 需要显示数字，数字含义限定为 `本会话期间变化文件数`，使用低对比蓝灰色徽标。默认可以不显示数字，避免误解为错误或未读。

### 响应式行为

- 宽屏：左侧会话库 + 中间终端 + 可选右侧项目面板。
- 中等宽度：右侧默认收起，左侧保持。
- 窄屏：右侧只能 overlay 展开，左侧可临时收起，终端保持主区域。

右侧面板展开状态可按 workspace 或窗口持久化，但新 workspace 和首次启动默认收起。

## 右侧只读文件树

### 文件树职责

文件树只做观察和定位：

- 展示当前 workspace 文件结构。
- 展示 git 状态。
- 展示本会话期间变化标记。
- 支持复制路径。
- 支持在 Finder 中显示。
- 支持按路径快速定位。

文件树不做：

- 内置编辑器。
- 内置 diff。
- 批量文件操作。
- 删除、移动、重命名文件。
- 直接修改 workspace 文件内容。

### 加载策略

文件树必须懒加载，不能一次性扫描大仓库。

默认不深入展示以下重目录：

- `.git`
- `node_modules`
- `dist`
- `build`
- `release`
- `coverage`
- `.next`
- `.turbo`

这些目录可以显示为折叠节点，但展开时应有明确加载边界，避免 UI 卡死。

文件系统读取必须限制在 workspace path 内。任何通过 `..`、符号链接或异常路径逃逸 workspace 的读取请求都必须拒绝。

### 文件状态标记

文件树可显示两类状态。

第一类是 git 状态：

- `M`：modified
- `A`：added
- `D`：deleted
- `R`：renamed
- `?`：untracked

第二类是本会话期间变化标记：

- 使用低对比蓝点。
- tooltip 文案为：`本会话期间发生变化`。
- 不写成 `agent 已编辑`，因为外部编辑器或用户命令也可能在同一时间修改文件。

本会话期间变化的第一版来源：

1. PTY 启动或继续时记录 workspace git status baseline。
2. 会话运行中和退出后刷新当前 git status。
3. 对比 baseline 和当前状态，得到本会话期间变化文件列表。
4. 非 git workspace 可 fallback 到启动时间后的文件 mtime 变化，但 UI 文案必须保持为 `本会话期间变化`。

不得通过脆弱的 TUI 文本解析来声称精确 agent edit 归因。

### 下方信息区

文件树下方有一个可拖动的横向分隔条。上方是文件树，下方是信息区。

默认比例：

- 文件树约占右侧面板 70% 到 80%。
- 下方信息区约占 20% 到 30%。
- 文件树最小高度不能低于右侧面板的 55%。
- 下方信息区最小高度约 120 px。

下方信息区使用折叠段，而不是顶部 Tab：

- `选中文件`：默认展开。
- `当前会话`：默认折叠。
- `恢复摘要`：默认折叠。

`选中文件` 的职责是解释用户当前在文件树中点中的文件：

- 文件名和相对路径
- git 状态
- 是否本会话期间变化
- diff stat，如 `+148 / -37`，仅在可安全快速获取时显示
- 复制路径
- 在 Finder 中显示

第一版不展示代码内容，不展示完整 diff。

## 恢复语义

### 恢复优先级

继续会话时按以下顺序恢复：

1. 原生 CLI resume：如果 Session Record 保存了 Claude/Codex 可用的原生 session id、thread id 或 resume command，优先使用原生恢复。
2. AgentDock restore context：如果没有原生 resume 信息，使用已有 summary/handoff/recent transcript tail 生成 restore context 文件，并通过短指令引导 agent 读取。
3. 普通重新启动：没有任何可恢复材料时，只按原 profile、workspace 和 command 启动新 PTY，并显示 `未找到可恢复上下文`。

UI 不应把 fallback 恢复伪装成原生 resume。

### Resume ID 获取策略

原生 resume 不能只靠解析 TUI 文本。实施前必须先做真机探针，确认当前 Claude/Codex CLI 版本能否稳定获取并复用 resume id。

已知策略先按工具分开处理：

- Claude：当前 `claude --help` 暴露 `--session-id <uuid>` 和 `--resume [value]`。优先策略是由 AgentDock 在首次启动 Claude Session Record 时生成 UUID，并把它通过 `--session-id` 传给 Claude；Session Record 保存同一个 UUID，后续继续时使用 `claude --resume <uuid>`。这一路径必须通过真机探针验证：启动、写入一轮最小对话、退出、resume 同一 UUID 后上下文可用。
- Codex：当前 `codex resume [SESSION_ID]` 和 `codex exec resume [SESSION_ID]` 支持按 id 恢复，但 `codex --help` 未暴露等价的启动时指定 session id 参数。Codex 第一版不得声称已稳定 native resume，必须先探针验证是否能从 `CODEX_HOME` 的持久化记录、`codex resume --last` 的选择逻辑或 JSON/事件输出中稳定得到 session id。
- 禁止策略：不得把普通 TUI 文本输出解析作为唯一 id 来源；不得根据 workspace 和时间窗口猜测到多个候选时静默选择；不得把 `--last` 当作长期精确恢复，除非探针证明它在独立 `CODEX_HOME` 和 workspace 过滤下稳定指向目标 Session Record。

探针结论会写回 SPEC 或实施计划：

- `nativeResume=verified`：该工具可使用原生 resume 作为优先路径。
- `nativeResume=unavailable`：该工具明确降级为 AgentDock restore context。
- `nativeResume=partial`：UI 必须显示 `原生恢复不可用，已使用 AgentDock 恢复材料`，并保留手动 fallback。

因此，原生 resume 是最高优先级，但不是无条件承诺。不可验证时必须显式降级，不能静默退化。

### 恢复摘要

`恢复摘要` 是右侧下方折叠段，不是顶部常驻提示。

内容包括：

- 本次恢复方式：原生 resume / AgentDock restore context / 普通重新启动。
- 一句话摘要。
- 来源类型：summary、handoff、recent transcript tail 或 CLI native id。
- 生成时间。
- 安全状态：已脱敏 / 无恢复材料 / 恢复失败。

默认只显示一句话，不展开完整 restore context。可提供 `查看来源文件`，但默认不读取或展示完整正文。

### 关闭、停止、删除

操作语义必须稳定：

- `关闭视图`：关闭当前窗口里的打开状态，Session Record 保留。
- `停止当前会话`：停止 PTY，Session Record 保留。
- `继续会话`：为 Session Record 启动或恢复 PTY。
- `归档`：从默认会话列表中隐藏，搜索或归档过滤中可见。
- `删除记录`：删除 Session Record 及 AgentDock 管理的 transcript/summary/restore metadata；不删除 workspace 文件。

删除记录必须二次确认。确认文案必须说明不会删除项目文件，但会删除 AgentDock 保存的这条会话历史。

## 数据与存储设计

第一版应优先演进现有 store，不直接引入 SQLite，也不要新建一套平行会话体系。

推荐本地结构：

```text
<userData>/sessions.json
<userData>/session-transcripts/<session-id>.log
<userData>/session-restore/<session-id>/
<userData>/session-file-index/<session-id>.json
```

`sessions.json` 保存轻量 Session Record metadata。transcript、restore context 和文件变化索引用独立文件保存。

现有模块演进边界：

- `sessionHistoryStore`：继续作为 Session Record metadata 的权威存储，增加 open view 分离后的生命周期字段、归档字段、native resume metadata 和 active runtime owner metadata。
- `sessionTranscriptStore`：继续保存 per-session terminal transcript，不新建第二个 transcript 目录。
- `restoreContextStore`：继续负责 AgentDock restore context 文件生成，native resume 不可用时复用它做 fallback。
- `sessionSummaryStore` / `summaryJobService`：继续负责 summary/handoff，不把 summary 存进新的文件体系。
- 新增 `sessionFileIndexStore` 时只保存文件状态索引和 baseline，不保存文件正文。

Open View 状态可以保存在独立 window/workbench state 中，避免把 UI 打开状态和 Session Record 生命周期混在一起。

迁移要求：

- 旧标签式 session history 必须迁移为 Session Record。
- 旧 running session 在 App 重启后标记为 interrupted。
- 旧 terminal buffer 继续按已有 transcript 迁移策略处理。
- 迁移幂等，重复启动不得重复写 transcript 或重复创建记录。
- 迁移失败时保留原文件备份，不得静默丢记录。

## IPC 与安全边界

Renderer 只能拿到最小必要数据：

- session metadata
- workspace 相对路径文件树
- git/file status
- 脱敏恢复状态和一句话摘要

Renderer 不得拿到：

- 完整 API Key
- 完整环境变量对象
- 完整 restore context 正文
- 未脱敏 summary 输入
- workspace 外路径文件列表

文件树 IPC 必须校验：

- workspace id 存在。
- 请求路径解析后仍在 workspace 根目录内。
- 符号链接不会逃逸 workspace。
- 返回数据只包含展示所需字段。
- 错误信息不包含 secret。

删除 Session Record 的 IPC 必须只删除 AgentDock 管理目录下的文件，不能删除 workspace 内项目文件。

## 错误处理

- Session Record 读取失败：保留左侧会话库，显示安全错误和恢复建议，不清空所有历史。
- 单条记录损坏：跳过该条并保留备份，其他记录继续显示。
- 文件树读取失败：右侧显示 `无法读取文件树`，中间终端不受影响。
- git 状态读取失败：文件树仍显示目录结构，只隐藏 git badge。
- 本会话文件变化索引失败：不显示蓝点，不影响会话运行。
- 原生 resume 失败：记录失败原因，允许用户选择 fallback restore context 或普通重新启动。
- restore context 生成失败：不注入大段 stdin fallback，显示 `恢复摘要不可用`。

## 实施阶段建议

实施前应先处理当前恢复相关未提交改动，形成清晰基线。该批次会修改 `App.tsx`、`styles.css`、`sessionService.ts`、session store 和 preload/IPC，和现有恢复改动高度重叠。

推荐拆成 Batch 0 + 六个实现批次：

0. 基线整理批次：提交或整理当前恢复相关未提交 diff，保证后续 UI/session 重构不踩在混杂工作区上。
1. 原生 resume 可行性探针批次：真机验证 Claude `--session-id` / `--resume`、Codex `resume` / `exec resume` 的 id 捕获和复用能力，输出验证记录。该批次不改主 UI。
2. 会话模型批次：Session Record / Open View / PTY Process 生命周期拆分，迁移、关闭/删除语义和多窗口 owner 规则。
3. 左侧会话库批次：项目分组、状态点、搜索轻量过滤、右键或 `...` 菜单、单一新会话入口、归档过滤入口。
4. 终端优先布局批次：去掉顶部标签重复表达，右侧默认收起，终端 100/120 列硬约束。
5. 只读项目面板批次：文件树、git 状态、本会话期间变化标记、下方可拖动信息区。
6. 恢复语义批次：根据 Batch 1 结论启用 verified native resume；不可用时使用 AgentDock restore context fallback，并在恢复摘要中明确标识。

每个批次都必须按 TDD 写测试，再写实现。

## 测试要求

### 单元测试

- 关闭 Open View 不删除 Session Record。
- 删除 Session Record 会删除 AgentDock 管理的 session metadata/transcript/restore 文件，但不删除 workspace 文件。
- running PTY 停止后 Session Record 仍保留。
- App 重启后旧 running 记录标记为 interrupted。
- Claude `--session-id` 探针 verified 后，首次启动写入并保存 native session id。
- 原生 resume 信息 verified 且存在时优先生成 native resume 启动参数。
- 原生 resume 不可用、partial 或缺失时才生成 AgentDock restore context fallback。
- 同一 Session Record 已有 running owner window 时，另一个窗口不能继续或写入 PTY。
- 文件树路径请求不能逃逸 workspace。
- 文件树不会返回完整文件正文。
- git status badge 和本会话期间变化标记来源分离。
- 非 git workspace 的变化标记文案不声称 agent edit。

### Renderer 测试

- 左侧会话库按 workspace 分组展示。
- 左侧顶部存在唯一 `新会话` 入口。
- 左侧搜索只过滤标题、workspace 和 profile，不触发 transcript 搜索。
- 归档记录默认隐藏，并可通过全部记录或归档过滤入口显示。
- 中间顶部不再出现第二个 `新会话`。
- running 状态显示停止图标和 tooltip。
- 另一窗口正在运行的记录显示只读观察状态。
- 右侧项目面板默认收起为 rail。
- 右侧展开后默认展示文件树。
- `会话 / 文件 / 恢复` 顶部 Tab 不再出现。
- 下方信息区默认只展开 `选中文件`。
- `当前会话` 和 `恢复摘要` 默认折叠。
- 文件树状态 badge 和本会话期间变化蓝点可见且不抢占终端。

### 布局测试

- 默认右侧收起时终端列数目标不低于 120。
- 右侧展开时终端列数不低于 100。
- 窗口变窄时右侧先自动收起。
- 右侧面板宽度不能突破终端最小列数约束。
- 文件树下方横向分隔条可拖动，且不会把文件树压到不可用高度。

### 安全测试

- session list IPC 不返回完整 API Key。
- session list IPC 不返回完整环境变量对象。
- restore summary IPC 不返回完整 restore context。
- 文件树 IPC 不允许读取 workspace 外目录。
- 删除记录 IPC 不删除 workspace 文件。
- 错误信息不包含 secret-like 值。

## 真实验证要求

该功能进入实现后，交付前至少完成：

```bash
npm run workflow:doctor
npm run test:workflow
npm test
npm run typecheck
npm run build
```

真实验证还必须覆盖：

1. 启动 Claude 或 Codex 会话，关闭视图，确认左侧会话库仍保留记录。
2. 重启 AgentDock，确认会话库、终端历史和 interrupted 状态仍存在。
3. Claude：验证 AgentDock 生成 UUID、启动时传入 `--session-id`、后续 `--resume <uuid>` 可恢复同一上下文；如果 CLI 版本不支持，记录 `nativeResume=unavailable`。
4. Codex：验证能否稳定捕获 session id 并通过 `codex resume <id>` 或 `codex exec resume <id>` 恢复；如果不能稳定捕获，记录 `nativeResume=unavailable` 或 `partial`，并使用 AgentDock restore context fallback。
5. 对无原生 resume 信息的会话执行继续，确认使用 AgentDock restore context fallback 且终端输入区不显示大段上下文。
6. 多窗口打开同一 running Session Record，确认第二窗口不能写入或启动第二个 PTY。
7. 展开右侧项目面板，确认终端仍至少 100 列。
8. 修改 workspace 文件，确认 git badge 和本会话期间变化标记显示正确。
9. 尝试通过文件树读取 workspace 外路径，确认被拒绝。
10. secret-like scan 确认相关 metadata、IPC 响应、summary/restore 输出和日志不包含完整 API Key。

如果外部 Claude/Codex provider 不可用，必须明确记录 native resume 未验证项，不能用 mock 结果替代真实验证结论。

## 验收标准

- 左侧会话库成为会话记录主入口，并按 workspace 分组。
- 左侧搜索只做标题、workspace 和 profile 的轻量本地过滤。
- Session Record、Open View、PTY Process 生命周期分离。
- 关闭视图不会删除会话历史。
- 删除记录必须通过显式危险操作和二次确认。
- 同一 Session Record 的 running PTY 同时只能被一个 owner window 控制。
- 中间区域保持终端优先，右侧默认收起。
- 右侧展开后终端仍满足 100 列最小约束。
- 右侧项目面板是只读文件树，不提供编辑器。
- 文件树能展示 git 状态和本会话期间变化标记，且文案不夸大归因。
- 下方信息区可拖动，默认只展开选中文件。
- 恢复优先使用已验证的原生 CLI resume；未验证或不可用时使用 AgentDock restore context fallback，并有明确 UI 标识。
- 恢复摘要默认折叠，不在顶部常驻显示。
- 所有 IPC 和本地存储继续满足 secret 安全边界。
- 测试、类型检查、构建和真实验证记录齐全。
