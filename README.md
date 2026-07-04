# AgentDock 代理坞

AgentDock 是一个面向 Claude CLI / Codex CLI 的多配置内嵌终端工作台。

核心目标：

- 在一个窗口中同时运行多个 Claude / Codex 终端会话。
- 每个会话拥有独立 endpoint、API Key、环境变量和运行状态。
- Codex 会话使用独立 `CODEX_HOME` 隔离配置和认证缓存。
- API Profile 与 Workspace 解耦：不同端点可进入同一个项目，也可进入不同项目。
- API Key 保存到 macOS Keychain，不明文落盘。

## 当前阶段

开发前准备 / MVP 骨架。

已完成：

- 导入 `agent-workflow-template` 工作流。
- 导入 Obsidian 中的需求、UI 调研、效果图和技术架构文档。
- 创建 Electron + React + TypeScript 最小可运行骨架。
- 记录 AgentDock 的项目约束和开发命令。

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
- `docs/assets/mockups/`：UI 效果图。
- `06-技术架构方案.md` 的导入副本：技术选型依据。
- `AGENTS.md`：开发代理必须遵守的工程约束。
- `.agent-workflow/`：9+1 工程角色开发工作流。
