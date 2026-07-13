# AgentDock 代理坞

AgentDock 是一个面向 Claude CLI / Codex CLI 的多配置内嵌终端工作台。

核心目标：

- 在一个窗口中同时运行多个 Claude / Codex 终端会话。
- 每个会话拥有独立 endpoint、API Key、环境变量和运行状态。
- Codex 原生模式按 Profile 使用独立 `CODEX_HOME`；NewAPI 兼容模式再为每个 Session 创建临时运行目录，避免并发会话互相覆盖配置。
- API Profile 与 Workspace 解耦：不同端点可进入同一个项目，也可进入不同项目。
- API Key 保存到本机加密 vault，不明文落盘；旧 Keychain 数据仅用于迁移/适配。

## 下载与安装

当前 GitHub Release 为 macOS Apple Silicon 预发布版本，适用于 M1、M2、M3、M4 等 ARM 架构 Mac，不支持 Intel Mac。

下载地址：

```text
https://github.com/peyoba/AgentDock/releases/tag/v0.1.0
```

安装步骤：

1. 下载 `AgentDock-v0.1.0-macos-arm64.zip`。
2. 解压 ZIP，将 `AgentDock.app` 拖入“应用程序”目录。
3. 在 Finder 的“应用程序”中右键 AgentDock，选择“打开”。
4. 如果 macOS 仍阻止启动，前往“系统设置 → 隐私与安全性”，找到 AgentDock 被阻止的提示，点击“仍要打开”，再确认一次。
5. 如果所选 Workspace 位于桌面、文稿或下载目录，按 macOS 提示授权对应文件夹。也可以在“系统设置 → 隐私与安全性 → 文件与文件夹”中检查 AgentDock 的权限。通常不需要授予“完全磁盘访问权限”。

当前版本使用稳定的本机自签名证书，尚未使用 Apple Developer ID 签名和 Apple notarization。因此，首次在其他 Mac 上启动时需要执行上述手动确认。这不代表应用包已损坏。

如果系统提示“应用已损坏”或下载不完整，请先校验 ZIP：

```bash
shasum -a 256 ~/Downloads/AgentDock-v0.1.0-macos-arm64.zip
```

`v0.1.0` 的 SHA-256 应为：

```text
a2fba33b0a9954e2b61b944f8e3b4b86cd3ad1159717d2198b3779ca430bdb64
```

仅当文件来自本仓库的 GitHub Release 且 SHA-256 一致，但 Gatekeeper 仍错误阻止时，技术用户可移除该 App 的下载隔离属性：

```bash
xattr -dr com.apple.quarantine "/Applications/AgentDock.app"
```

不要对来源不明或校验不一致的应用执行该命令。

## 首次使用与个人 API 配置

GitHub Release **不包含任何开发者私有 endpoint、API Key、登录状态或本机 Vault 数据**。每位用户必须使用自己的 Claude/Codex 账号或 API 服务配置；不要共享或提交个人 API Key。

首次使用步骤：

1. 安装需要使用的 CLI。只使用 Claude 时无需安装 Codex，反之亦然。

   ```bash
   claude --version
   codex --version
   ```

2. 启动 AgentDock，打开“接口配置”。
3. 新建或编辑属于你自己的 Claude/Codex API Profile。
4. 填写自己的服务地址（endpoint）、API Key 和模型配置，然后保存。
5. 返回终端工作台，选择 Workspace 和刚保存的 Profile，再启动会话。

API Key 只写入当前 Mac 上的本机加密 Vault。默认界面、IPC、日志、Session history、Workspace context 和 GitHub Release 都不会携带完整 API Key。只有用户主动点击查看某个已保存 Profile 时，应用才会临时读取并显示该 Key。

新 Mac 不会自动继承另一台 Mac 的 API Profile、API Key、Claude/Codex 登录状态或 Codex Home。需要在每台设备上分别配置。

如果 AgentDock 可以打开但会话无法启动，请依次检查：

- 对应的 `claude` 或 `codex` 命令是否已安装并能在终端运行；
- 当前 Profile 是否填写了有效的个人 endpoint 和 API Key；
- 网络、代理和 DNS 是否能够访问所配置的服务；
- macOS 是否已允许 AgentDock 访问所选 Workspace。

## Codex 运行模式

Codex Profile 可设置默认运行模式，启动会话时也可在顶部启动栏明确选择：

- **原生 Codex · Responses**：Codex 直接使用 Profile 的 Responses endpoint、真实模型名和 Profile 独立 `CODEX_HOME`。这是旧 Profile、旧 Session 和功能回滚的默认路径；工具种类取决于 Codex CLI 与所选上游的原生兼容性。
- **完整工具 · NewAPI 兼容**：面向需要标准顶层 Responses tools 的 NewAPI 兼容服务。每个 Session 启动一个仅监听本机回环地址的受限适配器，并创建临时运行时 `CODEX_HOME`。适配器只把内部模型别名精确改回 Profile 的真实模型；请求中的 tools、input、instructions 等字段以及 Responses/SSE 响应保持原样透传。

该模式要求 Profile 上游真实支持标准 `/v1/responses` tools。已验证的 `newapi + gpt-5.6-sol` 可用；当前本机 `anyrouter-codex-GitHub` 上游会返回 HTTP 400 `invalid_responses_request`，应改用原生模式或更换为已验证的 NewAPI Profile。

兼容模式不是 API gateway，不提供自动路由、fallback、协议猜测或请求正文日志。真实模型名仍显示在界面和会话记录中，内部别名不应进入普通 metadata 或 transcript。Session 退出、停止、删除、重启或应用关闭时，对应适配器与临时运行目录会进入清理流程。

如果兼容模式启动、连接或工具闭环失败，AgentDock 会显式失败，不会静默切换上游或伪装成功。可停止当前会话并改选“原生 Codex · Responses”重新启动；两种模式的上游能力不同，切换模式不等于保证原生上游提供同样的工具集合。

恢复 Session 时，summary/transcript 恢复正文不会拼入 Codex 或 Claude 的 CLI argv。AgentDock 会先等待 TUI 输入提示就绪，再通过 PTY 写入一次；超时或进程提前退出会记录为恢复失败，而不是标记为已加载。

当前自动化合同、类型检查、构建及安全/风险/性能闸门已覆盖上述边界。2026-07-13 已使用本机已保存的 NewAPI Profile 完成生产 `SessionService → node-pty → loopback → gpt-5.6-sol` 真实工具闭环：Codex 实际执行 `pwd` 与 `uname -a`，工具结果成功回传；进程 argv、终端输出和脱敏结果均未出现真实 Key 或本地 token。双 Session 与完整恢复组合仍以自动化合同为主，后续发布候选可继续补充真机矩阵。

## 当前阶段

核心 MVP 已完成，当前处于 macOS arm64 本地 Beta 稳定性与真实端到端验收阶段。

已完成：

- 导入 Obsidian 中的需求、UI 调研、效果图和技术架构文档。
- 实现 Electron + React + TypeScript + xterm.js 的终端优先工作台。
- 接入真实 `node-pty`，密钥读取走本机加密 vault adapter。
- 支持 Claude/Codex API Profile、Workspace、内嵌终端会话和独立启动环境。
- 支持 Codex 每 Profile 独立 `CODEX_HOME`。
- 支持 API 配置独立页面、多 Profile 新增/编辑和按工具类型分类。
- 完成 Batch A：Claude 模型映射、多窗口 Session 隔离、时间戳 macOS 打包。
- 完成 Claude 轻量/完整 MCP 启动模式；轻量模式隔离 user settings/plugin hook。
- 完成 Batch B：Workspace Shared Context 写入 workspace 本地 `.agentdock/context/`。
- 完成终端滚动体验小修：长输出时可拖动右侧滚动滑块快速定位。
- 完成本机加密 vault v2 修复：去除 hostname/目录依赖，旧记录读取时自愈迁移。
- 完成 macOS 稳定自签名打包和标签快速 tooltip。
- 完成 Claude StatusLine 的 CCometixLine 内嵌：优先使用 PATH 中用户已安装版本，缺失时回退到随包内嵌的 `ccline`。
- 完成 Context Budget Guard + 手动总结/续开：支持 Claude `--print` / Codex `exec` one-shot summary runner，并写入 workspace 本地 summary/handoff。
- 完成长期会话库：Session Record、Open View 与 PTY Process 分层，支持搜索、归档、关闭视图和恢复。
- 完成分层记忆恢复：原生 resume 探针优先，不可用时读取脱敏 summary 与 transcript tail。
- 完成右侧只读项目文件树、构建版本信息和 Claude Profile 会话级兼容改写代理。
- 完成 Codex 两种可见运行模式、NewAPI 单字段模型兼容层、兼容模式单 Session 临时 `CODEX_HOME` 与恢复正文 argv 隔离；真实 NewAPI/node-pty 的 `pwd` / `uname -a` 工具闭环已通过，详见 `.agent-workflow/verification/2026-07-13-codex-newapi-full-tool-capability.md`。

本地可复测包不会提交到 Git。请从干净工作区执行：

```bash
npm run package:mac
```

命令会在 `release/packages/<buildId>/AgentDock-darwin-arm64/AgentDock.app` 生成新包；
具体 commit、buildId 和 dirty 状态以包内 `Contents/Resources/build-info.json` 为准。

下一批计划：

- 冻结干净发布基线，并完成最新包的人工 GUI 验收。
- 补真实终端体验验收：Ctrl+C、中文输入、粘贴长文本、resize、真实 Claude/Codex 请求。
- 在用户授权使用本机 API 额度后，复测 Claude native resume、summary 和兼容代理外部上游。
- 外部分发前补 Developer ID 签名、notarization 与 Gatekeeper 验证。

## 开发命令

```bash
npm install
npm run typecheck
npm run build
npm run dev
npm run workflow:doctor
npm run test:workflow
npm run package:mac
```

## macOS 打包

`npm run package:mac` 会构建并输出到新的时间戳目录，例如：

```text
release/packages/20260704-153000/AgentDock-darwin-arm64/AgentDock.app
```

默认不会覆盖 `release/AgentDock-darwin-arm64/AgentDock.app`。

每个包会写入对应的构建信息：

```text
AgentDock.app/Contents/Resources/build-info.json
```

应用左侧会话库顶部会显示 `v版本 · buildId`，悬浮可查看 commit、构建时间和 dirty 状态，方便区分本地连续打出来的不同包。

## 重要文档

- `docs/PROJECT_REQUIREMENTS.md`：需求和 UI 要求汇总。
- `docs/requirements/`：从 Obsidian 导入的完整调研文档。
- `06-技术架构方案.md` 的导入副本：技术选型依据。
- `AGENTS.md`：开发代理必须遵守的工程约束。
