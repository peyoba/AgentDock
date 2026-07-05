# AgentDock 代理坞

AgentDock 是一个面向 Claude CLI / Codex CLI 的多配置内嵌终端工作台。

核心目标：

- 在一个窗口中同时运行多个 Claude / Codex 终端会话。
- 每个会话拥有独立 endpoint、API Key、环境变量和运行状态。
- Codex 会话使用独立 `CODEX_HOME` 隔离配置和认证缓存。
- API Profile 与 Workspace 解耦：不同端点可进入同一个项目，也可进入不同项目。
- API Key 保存到本机加密 vault，不明文落盘；旧 Keychain 数据仅用于迁移/适配。

## 当前阶段

MVP 基础能力已进入可打包验证阶段。

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

当前可复测包：

```text
release/packages/20260705-020727/AgentDock-darwin-arm64/AgentDock.app
```

下一批计划：

- 手动 smoke 最新包：vault 修复后 Profile 启动、标签 tooltip、TCC 一次性授权、多窗口同 workspace、CLI 退出提示。
- 补真实终端体验验收：Ctrl+C、中文输入、粘贴长文本、resize、真实 Claude/Codex 请求。
- 准备下一批前补一份真实终端体验验收记录。

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

## 重要文档

- `docs/PROJECT_REQUIREMENTS.md`：需求和 UI 要求汇总。
- `docs/requirements/`：从 Obsidian 导入的完整调研文档。
- `06-技术架构方案.md` 的导入副本：技术选型依据。
- `AGENTS.md`：开发代理必须遵守的工程约束。
- `.agent-workflow/`：9+1 工程角色开发工作流。
