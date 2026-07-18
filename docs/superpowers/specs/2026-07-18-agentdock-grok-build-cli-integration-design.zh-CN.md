# AgentDock Grok Build CLI 一等公民接入设计

> 日期：2026-07-18  
> 状态：已批准（2026-07-19）  
> 范围：将本机 **Grok Build TUI**（`grok`）作为与 Claude / Codex 同级的正式工具类型接入 AgentDock  
> 语言：中文主文档

## 1. 背景与目标

AgentDock 当前正式支持 Claude / Codex 多配置并发会话。用户本机已安装 xAI **Grok Build TUI**（命令 `grok`），需要把它做成与 Claude / Codex 对齐的一等公民：

- API 配置页可新增 / 编辑 / 删除 Grok Profile
- 启动栏可选择 Grok Profile + Workspace 启动内嵌终端
- 每 Profile 独立凭证与运行目录，互不污染
- 支持 API Key 与 OAuth 两种认证
- 在能力面上尽量对齐 Claude / Codex（模型列表、恢复、摘要、会话库、详情面板）

### 1.1 已确认决策

| 项 | 决策 |
|----|------|
| 目标 CLI | 本机 Grok Build TUI（`grok`），非第三方 proxy CLI |
| 实现路径 | 方案 A：在现有 Claude/Codex 管线上扩展 `grok` ToolType |
| 默认命令 | `grok --no-alt-screen` |
| 权限策略 | 不默认自动批准；用户在 Grok TUI 内处理审批 |
| 认证 | 同时支持 `api-key` 与 `oauth` |
| 隔离 | 每 Profile 独立 `GROK_HOME`；OAuth 也独立登录，不共用 `~/.grok` |
| 深度 | 完整对齐 Claude/Codex（启动、配置、模型、恢复、摘要等） |
| 不做 | API gateway、自动路由、fallback、成本统计、完整 IDE |

### 1.2 本机探测结论（设计依据）

- 可执行文件：`~/.local/bin/grok`（Mach-O arm64，Grok Build TUI）
- 帮助与认证文档确认：
  - API Key 环境变量：`XAI_API_KEY`（兼容别名 `GROK_CODE_XAI_API_KEY`）
  - 配置目录覆盖：`GROK_HOME`（默认 `~/.grok`）
  - OAuth 凭证：`$GROK_HOME/auth.json`
  - **session token 优先于 `XAI_API_KEY`**；要用 Key 需无有效 session 或先 logout
  - 可选代理基址：`GROK_CLI_CHAT_PROXY_BASE_URL`
  - 模型列表环境：`GROK_MODELS_BASE_URL` + `XAI_API_KEY`（Bearer）
  - 默认模型：`grok-build`
  - 恢复：`-c/--continue`、`-r/--resume [SESSION_ID]`
- AgentDock 的 PTY PATH 已包含 `~/.local/bin`，默认可解析用户级 `grok`

## 2. 产品边界

### 2.1 必须实现（本 SPEC）

1. `ToolType` 增加并正式启用 `grok`
2. API 配置：筛选 / 新建 / 编辑 / 删除 Grok Profile
3. Grok 表单字段：名称、认证模式、Base URL、默认模型、模型列表、API Key（按模式）、独立 `GROK_HOME`、环境变量脱敏预览
4. 启动注入：`GROK_HOME` +（API Key 模式）`XAI_API_KEY` + 可选 endpoint 覆盖
5. 默认启动命令：`grok --no-alt-screen`
6. 会话库 / 终端 / 会话详情对 Grok 会话完整可用
7. 模型列表拉取（OpenAI 兼容 `/models` 或 Grok 文档约定路径）
8. 原生恢复探测与重启策略接入（`resume` / `fresh`）
9. 上下文摘要 / 续聊链路对 Grok 的最小可用支持（与 Claude/Codex 同入口，失败显式）
10. 密钥、日志、transcript 脱敏与 vault 约束不降级

### 2.2 明确不做

- 不把 Grok 伪装成 Codex / OpenAI Profile
- 不实现 AgentDock 侧 OAuth 浏览器代登录器（OAuth 在 Grok 终端内完成）
- 不自动从本机 `~/.grok` 复制 `auth.json` 到 Profile
- 不做 Grok 专用危险权限默认开启
- 不做 NewAPI / loopback 兼容网关（除非后续单独 SPEC）
- 不启用 Gemini / OpenCode 入口

## 3. 架构设计

```text
Renderer
  ApiConfigPanel (Grok 分组/表单)
  CommandBar (Grok Profile 默认命令)
  SessionLibrary / TerminalPane / SessionDetails
        │ IPC
Main
  ProfileStore + SecretVault
  SessionService.launch/restart
  launchEnvironment (Grok env)
  modelFetchService (Grok models)
  nativeResumeProbe (Grok resume)
  summaryRunner (Grok summary path)
  PtyAdapter (PATH + managed env scrub)
        │
  node-pty → `grok --no-alt-screen` @ workspace
        │
  环境：GROK_HOME, XAI_API_KEY?, GROK_CLI_CHAT_PROXY_BASE_URL?
```

原则：

- 与 Claude/Codex 同构，避免新框架或新状态库
- 隔离主键是 **Profile 级 `GROK_HOME`**，不是改全局 `~/.grok`
- 密钥只进 vault 与 PTY env；不进 Session command、日志、普通 IPC

## 4. 数据模型

### 4.1 ToolType

```ts
export type ToolType = 'claude' | 'codex' | 'grok' | 'gemini' | 'opencode';
export type GrokAuthMode = 'api-key' | 'oauth';
```

### 4.2 ApiProfile 扩展

```ts
export type ApiProfile = {
  // ...existing fields...
  toolType: ToolType;
  baseUrl: string;                 // Grok 默认 https://api.x.ai/v1
  defaultModel?: string;           // 默认 grok-build
  availableModels?: string[];
  keychainService: string;
  keychainAccount: string;
  grokHome?: string;               // ~/.agentdock/grok-profiles/<id>
  grokAuthMode?: GrokAuthMode;     // grok 必填；默认 api-key
};
```

字段规则：

| 字段 | Grok 规则 |
|------|-----------|
| `baseUrl` | 必填字符串；新建默认 `https://api.x.ai/v1`。用于模型拉取与可选 proxy 覆盖 |
| `defaultModel` | 可选；空则不强制 CLI `-m`，由 Grok 默认 `grok-build` |
| `grokHome` | 创建时自动生成 `~/.agentdock/grok-profiles/<id>`；UI 只读展示（对齐 codexHome） |
| `grokAuthMode` | `api-key` \| `oauth`；缺省按 `api-key` |
| API Key | `api-key` 模式保存/启动必需；`oauth` 模式可不存 Key |
| Claude/Codex 专用字段 | 保存时清空，避免脏数据 |

### 4.3 会话与恢复类型

```ts
export type NativeResumeState = {
  tool: 'claude' | 'codex' | 'grok';
  status: 'verified' | 'partial' | 'unavailable';
  sessionId?: string;
  resumeCommand?: string;
  checkedAt?: string;
  reason?: string;
};

export type InitialPromptTool = 'claude' | 'codex' | 'grok';
```

Session 本身仍通过 `profileId` 解析工具类型；不强制新增 `session.toolType` 字段（YAGNI）。若实现中发现多处重复解析，可在后续小重构中只读派生，不作为本 SPEC 必改。

### 4.4 持久化与迁移

- 旧配置无 `grok` Profile：无破坏性迁移
- 读到 `toolType: 'grok'` 但缺 `grokHome`：启动/保存时回填默认路径
- 读到缺 `grokAuthMode`：视为 `api-key`
- `gemini` / `opencode` 历史数据若存在，仍不显示创建入口；列表“全部”可只读展示但不承诺可启动

## 5. 启动环境与隔离

### 5.1 解析 GROK_HOME

对齐 `resolveCodexHome`：

```text
resolveGrokHome(profile, appDataPath, homeDir)
  = expand(profile.grokHome)
  ?? join(appDataPath, 'grok-profiles', profile.id)
```

默认展示路径：`~/.agentdock/grok-profiles/<profileId>`。

启动前确保目录存在（private/normal 权限与 codex profile 目录策略一致；不得把 secret 写入该目录的日志）。

### 5.2 buildLaunchEnvironment（Grok 分支）

```ts
if (profile.toolType === 'grok') {
  const grokHome = resolveGrokHome(...);
  const env: Record<string, string> = {
    GROK_HOME: grokHome,
  };

  if (profile.grokAuthMode !== 'oauth') {
    env.XAI_API_KEY = secret; // secret 来自 vault；缺失则失败
  }

  // baseUrl 非默认时，注入代理/模型基址覆盖，便于中转
  if (isCustomGrokBaseUrl(profile.baseUrl)) {
    env.GROK_CLI_CHAT_PROXY_BASE_URL = normalizeBaseUrl(profile.baseUrl);
    env.GROK_MODELS_BASE_URL = normalizeBaseUrl(profile.baseUrl);
  }

  return env;
}
```

说明：

- **不**设置伪造的 `OPENAI_API_KEY` 来“兼容”，避免与 Grok 文档语义混淆
- OAuth 模式：即使 vault 有旧 Key，也**默认不注入** `XAI_API_KEY`，避免与用户意图混淆；用户若要 Key 模式应切换 `grokAuthMode`
- API Key 模式：若 `GROK_HOME/auth.json` 存在，Grok 会优先 session token。为满足“Key 模式真正用 Key”的产品预期，启动前执行 **显式冲突策略**（见 5.3）

### 5.3 API Key 模式与 auth.json 冲突策略

当 `grokAuthMode === 'api-key'` 且 `${GROK_HOME}/auth.json` 存在：

1. 将 `auth.json` 原子重命名为 `auth.json.agentdock-disabled-<timestamp>`
2. 在终端输出一条**不含 secret** 的提示：  
   `[AgentDock] 已暂时停用该 Profile 的 Grok 登录态，改用 API Key 启动`
3. 不删除文件，便于用户手动恢复
4. 不读取、不日志输出 auth.json 内容

OAuth 模式不碰用户 `auth.json`。

### 5.4 Managed env scrub

扩展 `MANAGED_AGENT_ENV_KEYS`，避免宿主 shell 泄露/污染：

```ts
'XAI_API_KEY',
'GROK_CODE_XAI_API_KEY',
'GROK_HOME',
'GROK_CLI_CHAT_PROXY_BASE_URL',
'GROK_MODELS_BASE_URL',
'GROK_MODELS_LIST_URL',
```

规则保持现状：仅当本次 launch env **显式提供**时才保留，否则从合并环境中删除。

### 5.5 默认命令

```ts
function defaultCommandFor(profile?: ApiProfile): string {
  if (profile?.toolType === 'grok') {
    return 'grok --no-alt-screen';
  }
  // existing claude/codex...
}
```

- 用户仍可在启动栏改命令（如加 `-m <model>`、`--resume`）
- 若 Profile 配置了 `defaultModel`，**第一期不强制改写命令**；可在环境/配置层写入 `${GROK_HOME}/config.toml` 的 `[models] default = "..."`（见 5.6）。避免和用户手改 command 打架

### 5.6 Profile 级 config.toml（最小）

启动 Grok 会话前，确保 `${GROK_HOME}/config.toml` 存在且包含最小安全默认：

```toml
[models]
default = "<profile.defaultModel or grok-build>"

[terminal]
# 与 CLI --no-alt-screen 一致的兜底；CLI 参数优先
alt_screen = "never"
```

约束：

- 只写 AgentDock 管理的已知键；不覆盖用户在该 GROK_HOME 内自行添加的 MCP/hooks 等其他段（合并更新，不整文件抹掉）
- 绝不写入 API Key 到 config.toml（Key 只走环境变量 / vault）
- OAuth 模式同样可写 default model 与 terminal 段

### 5.7 工作目录

与 Claude/Codex 相同：PTY `cwd = workspace.path`。  
Grok 自己的 `--cwd` 不必重复，除非后续发现 workspace 与 GROK 项目探测冲突再补。

## 6. 认证 UX

### 6.1 API Key 模式

- 表单：API Key 输入（脱敏、可查看、可替换）— 复用现有 vault IPC
- 保存 Profile 时若 Key 非空则写入 vault
- 启动时 readSecret 失败 → 会话 `failed`，错误不含 secret
- 环境变量预览：`XAI_API_KEY=******`、`GROK_HOME=...`、可选 base url 覆盖键

### 6.2 OAuth 模式

- 表单：不强制 Key；显示说明  
  “此 Profile 使用独立 GROK_HOME。首次请在终端执行登录（Grok 会引导 `login` / 浏览器 OAuth）。”
- 启动命令仍是 `grok --no-alt-screen`
- AgentDock **不**代开系统浏览器 OAuth，不解析 auth.json
- 会话详情展示：`认证方式：OAuth（Profile 独立）`、`GROK_HOME`、不显示 Key 来源为 vault（可显示“未配置 API Key”）

### 6.3 模式切换

- `oauth` → `api-key`：要求用户提供 Key；下次启动触发 5.3 冲突处理
- `api-key` → `oauth`：保留 vault 中 Key 但不注入；用户在终端登录

## 7. UI 设计

### 7.1 API 配置页

筛选 tabs：

```text
Claude | Codex | Grok | 全部
```

`editableToolTypes` 增加 Grok。

Grok 右侧表单：

1. 名称
2. 工具类型
3. 认证方式：`API Key` / `OAuth（终端登录）`
4. Base URL（默认 `https://api.x.ai/v1`）
5. 默认模型 + 拉取模型按钮（OAuth 且无 Key 时：按钮禁用并提示需 API Key 或改用终端 `grok models`）
6. API Key（api-key 模式必填交互；oauth 模式可隐藏或标注可选）
7. 只读：`GROK_HOME`、keychain service/account
8. 环境变量脱敏预览

### 7.2 启动栏 CommandBar

- 选择 Grok Profile 时：
  - 默认命令：`grok --no-alt-screen`
  - **不显示** Claude lite/full，也**不显示** Codex native/NewAPI 模式
  - `local-shell` 是否对 Grok 开放：与 Claude/Codex 一致开放（用于排障）
- 无额外 Grok 启动模式选择（YAGNI；权限在 TUI 内）

### 7.3 会话详情

展开后显示：

- Profile 名 / toolType=Grok
- Base URL
- 认证方式
- Key 来源（vault / 无）
- `GROK_HOME`
- Workspace
- 命令
- 恢复信息（若有）

### 7.4 文案

- 工具标签：`Grok`
- 空状态：提示安装 `grok` 并确保在 PATH（`~/.local/bin` 已被 AgentDock 注入）

## 8. 模型列表

复用 `modelFetchService`：

- 使用 Profile `baseUrl` 生成 `/v1/models` 与 `/models` 候选
- Header：`Authorization: Bearer <secret>`
- Grok 不需要 anthropic-version
- `api-key` 模式：与现网一致从 vault 读 Key
- `oauth` 模式且无 Key：IPC 返回明确错误  
  `OAuth 模式未配置 API Key，无法从 AgentDock 拉取模型列表`

不在第一期解析 `grok models` CLI 输出（脆弱）；优先 HTTP。

## 9. 恢复（Resume）

### 9.1 能力

Grok CLI 支持：

- `grok --continue` / `-c`：继续当前工作目录最近会话
- `grok --resume [SESSION_ID]` / `-r`：按 ID 恢复

### 9.2 nativeResumeProbe

扩展探测：

1. 在对应 `GROK_HOME` 与 workspace 下查找 Grok 会话元数据（优先读 Grok 文档/目录约定的 session 索引；实现时以 `GROK_HOME` 内实际结构为准，找不到则 `partial`/`unavailable`）
2. 若仅能确认“可用 continue”：  
   `resumeCommand = "grok --no-alt-screen --continue"`，`status=partial`
3. 若能解析 session id：  
   `resumeCommand = "grok --no-alt-screen --resume <id>"`，`status=verified`
4. 失败：`unavailable` + 原因（无 secret）

### 9.3 重启策略

与现有 `RestartSessionStrategy` 对齐：

- `resume`：优先 `session.nativeResume.resumeCommand` 或 `session.resumeCommand`
- `fresh`：使用默认/用户命令重新开

### 9.4 初始 prompt 注入

若恢复需要补上下文：

- 扩展 `InitialPromptTool` 支持 `grok`
- 就绪探测：复用“TUI 就绪后再写 PTY”的约束；**禁止**把恢复正文塞进 argv
- 若 Grok 就绪特征不明显：允许 `partial` 失败并在 memoryRestore 标记 failed，不得假成功

## 10. 摘要（Summary）

### 10.1 入口

`isSummarySupportedAgentSession` 扩展：

```ts
profile.toolType === 'grok' && commandExecutableName(session.command) === 'grok'
```

### 10.2 执行

优先策略（按实现难度递增，验收允许分阶段）：

1. **阶段 S1（必须）**：摘要任务能对 Grok 会话产出 handoff 文件；续聊启动新 Grok 会话并注入 handoff（PTY 注入，不进 argv）
2. **阶段 S2（必须尽力）**：若可用 HTTP 模型 API（api-key + baseUrl）生成摘要，则走与现有摘要 runner 类似的 headless 调用
3. 若 OAuth 且无 Key：允许降级为“仅打包 transcript 片段 + 模板 handoff”，UI 明确 `partial`

禁止：静默跳过、伪造“已摘要”。

## 11. 安全

- API Key 仅 vault；UI 默认脱敏；查看走现有专用 IPC
- 错误 / 日志 / transcript sanitizer 增加对 `XAI_API_KEY`、`xai-` 前缀 token、Bearer 的脱敏模式
- `auth.json` 内容不得读入 renderer，不得写入 AgentDock 日志
- 复制环境变量预览默认隐藏 secret
- 不把 secret 写入 `GROK_HOME/config.toml`
- 多窗口：继续使用现有 session id 前缀与 runtime owner，不因 Grok 放宽

风险等级：**L3**（密钥、PTY、外部 CLI、环境变量）

## 12. 与 Claude / Codex 能力对齐表

| 能力 | Claude | Codex | Grok（本 SPEC） |
|------|--------|-------|-----------------|
| Profile CRUD | ✅ | ✅ | ✅ |
| Vault API Key | ✅ | ✅ | ✅（api-key） |
| OAuth/登录 | 间接 | 间接 | ✅ 终端内 Profile 隔离登录 |
| 独立运行目录 | settings/临时 | CODEX_HOME | GROK_HOME |
| 默认命令策略 | skip perms 可配 | bypass 可配 | `--no-alt-screen` 固定默认 |
| 启动模式 UI | lite/full | native/NewAPI | 无额外模式 |
| 模型拉取 | ✅ | ✅ | ✅（需 Key） |
| 内嵌终端会话库 | ✅ | ✅ | ✅ |
| Resume | ✅ | ✅ | ✅ |
| Summary | ✅ | ✅ | ✅（OAuth 可 partial） |
| Compat proxy | 可选 | NewAPI 可选 | ❌ 不做 |

## 13. 实现分批（建议）

> 批次供 writing-plans / 执行使用；本 SPEC 整体验收以第 14 节为准。

### Batch 1 — 类型与启动闭环
- `ToolType`/`ApiProfile`/`NativeResumeState`/`InitialPromptTool`
- `buildLaunchEnvironment` + managed env keys + `resolveGrokHome`
- auth.json 冲突策略
- 默认命令与 PATH 验证
- 单元测试：env 构建、冲突策略、scrub

### Batch 2 — UI 配置与启动栏
- ApiConfigPanel Grok 分组/表单
- CommandBar 行为
- 会话详情字段
- UI/组件测试

### Batch 3 — 模型 / 恢复 / 摘要
- modelFetchService
- nativeResumeProbe Grok
- summary 支持与 handoff 注入
- 集成测试 + 真机 `grok` 验证记录

### Batch 4 — 文档与门禁
- 更新 `docs/PROJECT_REQUIREMENTS.md`、`DECISIONS.md`、`PROJECT_PROFILE.md` 相关表述
- `npm run workflow:doctor` / `typecheck` / `build` / 相关测试
- L3 真实验证记录

## 14. 验收标准

1. API 配置页可见 `Grok` 分类，可创建 Profile，默认 `GROK_HOME` 为 `~/.agentdock/grok-profiles/<id>`
2. API Key 模式：保存 Key 后启动会话，PTY 环境含 `GROK_HOME` 与 `XAI_API_KEY`；终端可进入 Grok TUI
3. OAuth 模式：无 Key 可启动；环境含独立 `GROK_HOME`，不含强制 Key；用户可在该终端完成登录且不影响本机 `~/.grok`
4. 两个 Grok Profile 并发启动，互不共享 `GROK_HOME`
5. 默认命令为 `grok --no-alt-screen`；不自动加 `--always-approve`
6. API Key 模式下若 Profile `GROK_HOME` 存在 `auth.json`，启动前被安全改名且提示可见
7. 模型拉取：有效 Key + baseUrl 可返回列表；错误无 secret
8. 会话退出后可在会话库保留记录；resume/fresh 行为符合探测结果
9. 摘要入口对 Grok 可见；成功或 partial 均有明确状态
10. 普通 list/get IPC 不返回完整 Key；日志/transcript 无明文 Key
11. `gemini`/`opencode` 入口仍隐藏
12. 验证命令通过：`npm run workflow:doctor`、`npm run typecheck`、`npm run build`，以及本功能相关测试

## 15. 测试计划（TDD 方向）

### 单元
- `buildLaunchEnvironment` grok api-key / oauth / custom baseUrl
- `resolveGrokHome` 默认与自定义
- managed env scrub 删除宿主泄露的 `XAI_API_KEY`/`GROK_HOME`
- auth.json disable 策略（临时目录 fixture）
- `defaultCommandFor('grok')`
- model fetch headers / 错误路径
- resume command 构建

### 组件
- ApiConfigPanel 显示 Grok tab 与表单切换
- CommandBar 选中 Grok 不显示 claude/codex 模式选择

### 集成 / 真机（L3）
- 真实启动 `grok --no-alt-screen`（需本机已装）
- API Key 模式（用户提供测试 Key 或跳过并记录 PARTIAL）
- OAuth 模式仅验证能进入 TUI/登录提示，不在 CI 自动完成浏览器登录
- 双 Profile 目录隔离

## 16. 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| session token 优先导致 Key 模式“看起来没用 Key” | 高 | 5.3 自动 disable auth.json |
| OAuth 每 Profile 需重新登录 | 中 | 产品明确文案；坚持隔离决策 |
| Grok TUI 就绪信号不稳定影响注入 | 中 | 超时失败、memoryRestore failed、禁止假成功 |
| 摘要在 OAuth 无 Key 时能力弱 | 中 | partial handoff，不阻塞启动主路径 |
| Windows 路径 / 可执行文件差异 | 中 | PATH 注入与命令解析复用现有 win32 逻辑；真机补验 |
| 文档/CLI 版本变化 | 中 | 以本机 help + 官方 user-guide 为准，适配器集中在 launchEnvironment |

## 17. 文档更新清单（实现期）

- `docs/PROJECT_REQUIREMENTS.md`：正式工具类型加入 Grok
- `DECISIONS.md`：记录 Grok 一等公民、GROK_HOME 隔离、双认证、默认命令
- `PROJECT_PROFILE.md`：若有工具矩阵则更新
- 本 SPEC 作为主设计输入；实施计划另用 `writing-plans` 生成中文 plan

## 18. 开放问题（实现时可默认）

以下在实现中可采用括号内默认，无需再阻塞：

1. 自定义 baseUrl 是否总是注入 `GROK_CLI_CHAT_PROXY_BASE_URL`？（**是，当且仅当与默认 api.x.ai 不同**）
2. OAuth 模式是否允许可选保存 Key 仅用于模型拉取？（**允许但不注入启动 env**）
3. 是否提供内置默认 Grok Profile？（**否，避免无 Key 的假配置**）

---

## 19. Self-Review

- 无 TBD/占位符实现路径
- 与“完整对齐”一致，但明确 proxy/gateway 仍不做
- 与既有 Claude/Codex 隔离模型一致（Profile 级 home）
- 中文主文档，可直接进入 plan / 用户审阅
