# AgentDock Batch A SPEC — Claude 模型映射、多窗口与安全打包

## 背景

AgentDock 已具备 Claude/Codex 多配置内嵌终端的 MVP 主干：Profile/Workspace 解耦、真实 PTY、API Key 本机安全保存、终端标签页、Claude AnyRouter 高级配置和默认模型迁移已经落地。下一批要解决三个直接影响日常使用的问题：

1. Claude CLI `/model` 菜单对应的模型映射需要可视化配置，参考 CC Switch 的模型映射区域。
2. AgentDock 需要支持同时打开多个窗口，每个窗口可以独立运行自己的终端会话。
3. macOS 打包不能再默认覆盖当前 `release/AgentDock-darwin-arm64/AgentDock.app`，避免影响正在运行的窗口或 App。

本 SPEC 只定义 Batch A，不包含工作区共享上下文保存。共享上下文会单独设计。

## 目标

- 在 Claude Profile 中增加明确的模型映射配置，让用户能配置主模型、Haiku、Sonnet、Opus 和默认启动选项。
- 启动 Claude 会话时，把模型映射写入 Claude settings/env，使 CLI `/model` 菜单使用用户配置的模型族别映射。
- `thinking` 作为 Claude 高级开关，不作为模型字段。
- 支持多个 AgentDock 窗口并发打开；Profile/Workspace 共享，终端 Session 按窗口隔离。
- 修改 macOS 打包流程，默认输出到新的时间戳目录，不覆盖正在运行或已有的 App 包。

## 非目标

- 不做 Codex 复杂模型映射。Codex 继续保留现有 `defaultModel`。
- 不自动解析 Claude/Codex CLI 输出，也不反向同步 CLI 当前模型状态。
- 本批不提供发送 slash command 的快捷入口，不自动驱动 `/model` 交互菜单。
- 不做工作区共享上下文、终端完整日志保存或跨 agent 摘要文件。
- 不做 API gateway、fallback、成本统计、请求日志或复杂 Dashboard。
- 不引入新的状态管理库、UI 组件库或打包工具。

## 风险等级

L3

触发原因：

- 修改外部 CLI 启动配置和 settings/env 注入。
- 修改 Electron 多窗口和 PTY Session 生命周期。
- 修改 macOS 打包流程和构建产物输出策略。
- 涉及 API Key 安全边界，必须确认模型 settings 不包含 secret。

## 功能要求

### 1. Claude 模型映射数据

Claude Profile 增加模型映射字段，但保持现有 `defaultModel` 作为“主模型”字段，避免重复模型概念。

新增字段：

```ts
type ClaudeDefaultLaunchMode = 'default' | 'opus' | 'sonnet' | 'haiku' | 'custom';

type ApiProfile = {
  defaultModel?: string; // Claude 中展示为“主模型”
  claudeDefaultLaunchMode?: ClaudeDefaultLaunchMode;
  claudeHaikuModel?: string;
  claudeSonnetModel?: string;
  claudeOpusModel?: string;
  claudeAlwaysThinkingEnabled?: boolean;
};
```

字段语义：

- `defaultModel`：主模型，默认用于 `ANTHROPIC_MODEL`。例如 `claude-opus-4-8`。
- `claudeHaikuModel`：写入 `ANTHROPIC_DEFAULT_HAIKU_MODEL`。
- `claudeSonnetModel`：写入 `ANTHROPIC_DEFAULT_SONNET_MODEL`。
- `claudeOpusModel`：写入 `ANTHROPIC_DEFAULT_OPUS_MODEL`。
- `claudeDefaultLaunchMode`：控制 Claude settings 中的 `model` 行为：
  - `default`：不写入 `settings.model`，让 Claude CLI 使用默认推荐入口，同时保留 env 模型映射。
  - `opus` / `sonnet` / `haiku`：写入对应族别字符串。
  - `custom`：写入 `defaultModel` 的完整模型 ID。
- `claudeAlwaysThinkingEnabled`：写入 Claude settings 的 `alwaysThinkingEnabled`，仅作为高级开关。

默认 AnyRouter Claude Profile 值：

- 主模型：`claude-opus-4-8`
- Haiku 默认模型：`claude-haiku-4-5-20251001`
- Sonnet 默认模型：`claude-fable-5`
- Opus 默认模型：`claude-opus-4-8`
- 默认启动选项：`default`
- `ANTHROPIC_BETAS=context-1m-2025-08-07` 继续保留在高级配置中，不新增 Sonnet 1M 字段。

### 2. 配置迁移

- 旧 profile 没有模型映射字段时：
  - `defaultModel` 保留并作为主模型。
  - AnyRouter Claude profile 自动补齐 Haiku/Sonnet/Opus 默认映射。
  - 非 AnyRouter Claude profile 不强行补齐具体模型 ID，只保留用户原有主模型。
- 历史 `opus[1m]` 仍作为非法旧别名处理：
  - 不能保存为主模型或可选模型。
  - AnyRouter Claude profile 迁移后主模型为 `claude-opus-4-8`。
  - 1M 能力继续通过 `ANTHROPIC_BETAS` 表达。
- 保存 profile 时只保存白名单字段，不保存 secret、env 快照或完整启动环境。

### 3. API 配置 UI

Claude 配置页增加“模型映射”区域，参考用户提供的 CC Switch 截图。

展示字段：

- 主模型
- Haiku 默认模型
- Sonnet 默认模型
- Opus 默认模型
- 默认启动选项：Default / Opus / Sonnet / Haiku / Custom

交互要求：

- 如果当前 profile 有 `availableModels`，这些字段使用下拉选择，同时允许手动输入自定义模型 ID。
- “拉取模型”只更新可选模型列表，不自动覆盖用户已经填写的映射值。
- 新增 Claude profile 时使用当前 AnyRouter 默认映射作为初始值；其他 provider 可以为空，由用户选择。
- Codex 配置页不显示 Claude 模型映射，只保留现有默认模型字段。
- `thinking` 开关放入 Claude 高级设置区，文案为“启用 Thinking 模式”。
- API Key 仍默认隐藏；点击显示才读取明文 Key。

### 4. Claude 启动 settings/env

启动 Claude 会话时，settings 文件和 PTY env 必须符合以下规则：

- PTY env 包含：
  - `ANTHROPIC_BASE_URL`
  - `ANTHROPIC_AUTH_TOKEN`
  - `ANTHROPIC_MODEL`，值为 `defaultModel`
  - `ANTHROPIC_DEFAULT_HAIKU_MODEL`，值为 `claudeHaikuModel`
  - `ANTHROPIC_DEFAULT_SONNET_MODEL`，值为 `claudeSonnetModel`
  - `ANTHROPIC_DEFAULT_OPUS_MODEL`，值为 `claudeOpusModel`
  - 已存在的高级 env，例如 `ANTHROPIC_BETAS`、代理、retry watchdog 等
- Claude settings 文件可包含：
  - `model`，按 `claudeDefaultLaunchMode` 规则写入
  - `alwaysThinkingEnabled`，按 `claudeAlwaysThinkingEnabled` 写入
  - `cleanupPeriodDays`
  - `env` 中只允许非 secret 的 Claude 高级 env
- settings 文件不得包含 API Key、完整 secret 或完整启动环境快照。

### 5. 多窗口支持

AgentDock 支持多个窗口并发打开：

- 主进程维护多个 `BrowserWindow`。
- ProfileStore、WorkspaceStore、SecretAdapter 仍为全局共享。
- SessionService 不再作为全局单例服务所有窗口，而是按窗口隔离：
  - 每个窗口拥有自己的 SessionService。
  - 每个窗口只能看到和控制自己启动的 sessions。
  - 终端 output 只发送到所属窗口，不能广播到其他窗口。
  - 一个窗口关闭时，只清理该窗口的 terminal output listener 和该窗口的 PTY sessions。
  - 关闭一个窗口不得影响其他窗口内运行的 sessions。
- Renderer 的 active session、selected profile、selected workspace、详情面板状态保持窗口内状态，不跨窗口共享。
- Profile/Workspace 保存、删除或选择路径后，主进程向所有窗口广播 metadata changed 事件，其他窗口刷新 profile/workspace 列表。
- 提供两个打开新窗口的入口：
  - 顶部按钮“新窗口”。
  - macOS 菜单 / 快捷键 `Cmd+N`。

### 6. macOS 打包安全输出

当前 `package:mac` 使用 `--out=release --overwrite`，会覆盖固定路径 App。Batch A 需要改为默认生成新目录。

要求：

- `npm run package:mac` 输出到时间戳目录，例如：

```text
release/packages/20260704-153000/AgentDock-darwin-arm64/AgentDock.app
```

- 默认不使用 `--overwrite` 覆盖固定 App。
- 打包脚本必须在输出开始前创建全新的目录；如果目录已存在则失败并提示换目录。
- codesign 针对新输出路径执行。
- 命令结束时打印最终 App 路径。
- 可通过环境变量 `AGENTDOCK_PACKAGE_OUT` 指定输出根目录，但最终 App 路径仍必须是新目录。
- 不再把 `release/AgentDock-darwin-arm64/AgentDock.app` 作为默认目标。
- 不引入 electron-builder / electron-forge；继续使用现有 electron-packager。

## 文件边界

允许修改：

- `src/shared/**`
- `src/main/**`
- `src/preload/**`
- `src/renderer/**`
- `tests/app/**`
- `package.json`
- `scripts/**`，仅用于打包脚本
- `.agent-workflow/state.md`
- `.agent-workflow/verification/**`
- `.agent-workflow/delivery/**`
- 必要的 README / 项目文档同步

禁止修改：

- `.env`
- 包管理器类型
- Git remote / Git history
- 与本批无关的复杂 Dashboard、API gateway、成本统计或上下文保存功能

## 测试要求

必须使用 TDD。新增或更新测试至少覆盖：

- Claude 默认 AnyRouter profile 的模型映射默认值。
- 旧 `defaultModel` profile 的迁移兼容。
- 历史 `opus[1m]` 不会进入主模型或模型列表。
- Profile 保存时不会落盘 secret/env。
- Claude 启动 env/settings 写入模型映射，不包含 API Key。
- `claudeDefaultLaunchMode` 对 settings `model` 的写入行为。
- `claudeAlwaysThinkingEnabled` 的 settings 写入行为。
- Claude 模型映射 UI 可编辑、可保存、可从模型列表选择。
- Codex UI 不显示 Claude 模型映射。
- 多窗口 session 隔离：窗口 A 的 session/output 不出现在窗口 B。
- metadata changed 事件能触发其他窗口刷新 profile/workspace。
- package 脚本生成时间戳目录，不再包含 `--overwrite` 固定覆盖。

## 真实验证要求

L3 任务完成前必须记录真实验证：

- `npm run workflow:doctor`
- `npm run test:workflow`
- `npm run test`
- `npm run typecheck`
- `npm run build`
- `npm run package:mac`
- 对新输出 App 路径执行 `codesign --verify --deep --strict --verbose=2`
- 打开两个窗口，验证：
  - 两个窗口能同时存在。
  - 每个窗口可独立启动本地 `zsh` session。
  - 一个窗口关闭不影响另一个窗口。
- 使用安全本地命令或用户确认的 Claude 配置验证 settings 文件：
  - 模型映射字段存在。
  - settings/env 中不包含 API Key 明文。

## 验收标准

- Claude Profile 页面能配置主模型、Haiku、Sonnet、Opus 和默认启动选项。
- AnyRouter Claude 默认配置符合用户确认的模型映射。
- 启动 Claude 时模型映射进入 PTY env/settings。
- Codex 模型配置未被复杂化，现有启动不回退。
- 可以同时打开多个 AgentDock 窗口。
- 多个窗口的 sessions 互相隔离。
- 打包输出到新目录，不覆盖固定 release App。
- 全量测试、typecheck、build、workflow 和 package 验证通过。
- 无 API Key、token 或 secret 写入代码、测试、文档、settings 文件或日志。

## 后续批次

Batch B 单独设计工作区共享上下文：

- `.agentdock/context/` 目录结构。
- 摘要型上下文，而不是完整终端日志。
- 脱敏策略。
- 多 agent CLI 可读写边界。
- 与 Claude/Codex 运行目录的关系。
