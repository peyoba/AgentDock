# AgentDock 项目需求与 UI 要求汇总

## 1. 一句话定义

AgentDock 是一个可视化的 Claude/Codex/Grok 多配置内嵌终端工作台，让用户可以同时运行多个互不干扰的 AI CLI 实例，每个实例拥有独立 endpoint/API key，同时可自由进入同一个或不同项目目录。

## 2. 核心用户需求

用户需要同时开多个 Claude/Codex/Grok：

```text
Claude A -> Endpoint A -> Key A -> 项目 X
Claude B -> Endpoint B -> Key B -> 项目 X
Codex C  -> Endpoint C -> Key C -> 项目 X
Codex D  -> Endpoint D -> Key D -> 项目 Y
```

要求：

- endpoint 和 API key 完全独立，互不影响。
- 可以多个会话进入同一个项目目录，也可以进入不同目录。
- 不能通过修改全局配置来切换，因为会影响已经运行的会话。
- 应该提供可视化配置、用户自定义端点/API key、新增/删除/编辑配置。
- 每次打开会话都使用保存好的 endpoint/API key。
- 最终采用内嵌终端标签页，而不是默认平铺外部终端。

## 3. MVP 功能范围

必须实现：

1. API Profile 管理：新增、编辑、删除、测试连接（测试连接可后置到第二小版本）。
2. API 配置按当前正式支持的工具类型分类：Claude / Codex / Grok / 全部。Gemini / OpenCode 保留为后续方向，在启动环境和凭证注入实现前不显示入口。
3. API Key 安全保存：本机加密 vault，不明文落盘；旧 Keychain 数据仅用于迁移/适配。
4. Workspace 管理：保存项目名称和本地目录。
5. 启动器：选择 Profile + Workspace + 命令 + 启动模式。
6. 长期会话库与内嵌终端视图：Session Record、打开视图和 PTY Process 分离，关闭视图不自动删除历史记录。
7. Claude 会话隔离：每个 PTY 注入独立 `ANTHROPIC_BASE_URL` 和 Key。
8. Codex 会话隔离：每个会话注入独立 endpoint/key；原生模式每 Profile 使用独立 `CODEX_HOME`，NewAPI 兼容模式每 Session 使用临时运行目录。
8b. Grok 会话隔离：每个会话注入独立 `GROK_HOME`；支持 API Key（`XAI_API_KEY`）与 OAuth（Profile 内终端登录）双认证。
9. 当前会话详情：默认收起，可展开，显示 endpoint/key 来源/workspace/操作。
10. 共享目录提示：轻提示，不作为错误。

暂不实现：

- 成本统计、请求日志、复杂 Dashboard。
- API gateway / provider fallback / 自动路由。
- 完整 IDE、代码 diff、分屏工作台。
- 团队同步和云端账号。

## 4. UI 要求

### 4.1 主界面

最终接受方向：`agentdock-ui-mockup-cn-v3b-collapsed.png`。

要求：

- 终端优先。
- 左侧只常驻长期会话库，不放置复杂的 Dashboard/设置导航。
- 顶部只保留接口配置、新窗口和紧凑启动条等关键入口。
- 新建会话区是一条紧凑 command bar：Profile / Workspace / command / 启动模式 / 启动。
- 中间为当前会话视图和大面积终端；会话切换、搜索和归档统一放在左侧会话库。
- 当前会话详情默认收起，点击“会话详情”或右侧把手展开。
- 右侧只读项目面板默认收起为 rail，不承担代码编辑职责。
- 共享目录风险用轻量 chip：`共享目录 · 3 个会话`。

### 4.2 API 配置界面

最终接受方向：`agentdock-api-config-cn-v2.png`。

要求：

- 参考 CC Switch，顶部按当前支持范围分组：Claude / Codex / Grok / 全部；Gemini / OpenCode 在具备完整启动能力后再启用。
- 左侧只显示当前工具类型下的配置。
- 右侧表单根据工具类型显示不同字段。
- Claude 类型展示：Base URL、模型、Anthropic 协议、API Key、本机密钥存储状态、环境变量预览。
- Codex 类型展示：OpenAI base URL、model_provider、默认模型、独立 `CODEX_HOME`、默认运行模式、Responses 适配方式、API Key。
- Grok 类型展示：Base URL、默认模型、认证方式（API Key / OAuth）、独立 `GROK_HOME`、API Key（按模式）、环境变量预览。
- API Key 默认脱敏，只能通过用户操作显示/替换。
- Renderer / preload / IPC 的默认查询和事件不得返回完整 secret 或完整环境变量对象；环境变量只能以脱敏预览或最小必要字段展示。只有用户明确点击查看某个已保存 Profile 的 API Key 时，专用 IPC 才可按需返回该单个 secret。

### 4.3 Codex 运行模式

- 顶部启动栏和 Codex Profile 必须显式提供“原生 Codex · Responses”与“完整工具 · NewAPI 兼容”。
- 旧 Profile 和旧 Session 缺少字段时使用原生模式；不得根据 endpoint 或模型自动切换协议。
- 原生模式直接连接 Profile 上游，使用真实模型名与 Profile 独立 `CODEX_HOME`。
- NewAPI 兼容模式使用单 Session loopback 适配器和临时运行时 `CODEX_HOME`。内部别名只用于促使 Codex 生成标准顶层 tools；适配器只重写 `model`，其他请求字段与 Responses/SSE 原样透传。
- 用户界面、普通 Session metadata 和 transcript 始终展示/保存真实模型名，不保存内部别名。
- 兼容模式失败时显式失败；不实现自动 fallback、自动换模型、自动路由或通用 API gateway。用户可手动改选原生模式重新启动。

## 5. 技术架构要求

采用：

```text
Electron + React + TypeScript + xterm.js + node-pty
```

核心模块：

- Profile Manager
- Workspace Manager
- Session Manager
- PTY Manager
- Secret Storage Adapter
- Terminal Renderer
- Config Generator

## 6. 安全要求

- 不得在代码、文档、测试、日志、前端持久化中保存完整 API Key。
- Key 必须进入本机加密 vault；Renderer / preload / IPC 默认不得返回完整 secret。用户明确查看单个已保存 Profile 时允许专用 IPC 按需读取，但不得广播、写入日志、前端持久化状态或普通 metadata 响应。
- UI 仅展示脱敏 key，例如 `sk-••••A7f`。
- 复制环境变量时默认隐藏 key，除非用户明确选择显示。
- 错误日志不得输出 secret。
- 除用户明确触发的单 Profile 密钥查看响应外，IPC 响应不得包含完整 secret 或完整 env；测试必须覆盖这一边界。
- 恢复正文不得进入 CLI argv、Session command、错误或日志；只允许在 TUI 就绪后通过 PTY 注入一次。就绪超时或进程提前退出必须标记恢复失败。

## 7. 验收标准

MVP 验收时必须证明：

1. 可新增至少两个 Claude Profile，endpoint/key 不同。
2. 可新增至少一个 Codex Profile，使用独立 endpoint/key 和独立 `CODEX_HOME`。
3. 可选择同一个 Workspace 同时启动多个会话。
4. 每个内嵌终端会话环境变量不同且互不影响。
5. 关闭/重启一个会话不影响其他会话。
6. API 配置页面按工具类型分类。
7. 当前会话详情默认收起，可展开。
8. 项目可通过 `npm run typecheck` 和 `npm run build`。
9. UI 测试覆盖当前会话详情默认收起、API 配置按工具类型分组。
10. IPC/Renderer 测试覆盖不返回完整 secret 或完整 env。
11. Codex 两种运行模式在 Profile 和启动栏可见；Session 保存实际选择，旧 Session 缺字段时保持原生模式。
12. NewAPI 兼容模式只改写 `model`，并使用单 Session 临时 `CODEX_HOME`；关闭一个 Session 不影响其他 Session。
13. 自动化、typecheck 和 build 通过只构成代码闸门；真实 NewAPI 工具闭环、node-pty、恢复/并发、argv 与 secret scan 必须另有真实验证记录，未验证项不得标记为已验收。

## 8. 参考资料

完整调研和效果图已导入：

- `docs/requirements/01-立项需求分析.md`
- `docs/requirements/02-产品UI设计.md`
- `docs/requirements/03-MVP功能清单.md`
- `docs/requirements/04-竞品UI参考.md`
- `docs/requirements/05-UI效果图.md`
- `docs/requirements/06-技术架构方案.md`
- `docs/assets/ui-references/`
