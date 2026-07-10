# AgentDock 代理坞

AgentDock 是一个面向 Claude CLI / Codex CLI 的多配置内嵌终端工作台。

核心目标：

- 在一个窗口中同时运行多个 Claude / Codex 终端会话。
- 每个会话拥有独立 endpoint、API Key、环境变量和运行状态。
- Codex 会话使用独立 `CODEX_HOME` 隔离配置和认证缓存。
- API Profile 与 Workspace 解耦：不同端点可进入同一个项目，也可进入不同项目。
- API Key 保存到本机加密 vault，不明文落盘；旧 Keychain 数据仅用于迁移/适配。

## 当前阶段

核心 MVP 已完成，当前处于 macOS arm64 本地 Beta 稳定性与真实端到端验收阶段。

已完成：

- 导入并配置 `agent-workflow-template` 工作流。
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
- `.agent-workflow/`：9+1 工程角色开发工作流。
