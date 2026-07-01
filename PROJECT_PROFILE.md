# Project Profile — AgentDock 代理坞

本文件记录 AgentDock 的技术栈、命令、环境变量和运行约定。主 Agent 启动工作流时必须读取本文件。

## 1. 项目基本信息

| 项目 | 内容 |
|------|------|
| 项目名称 | AgentDock 代理坞 |
| 项目类型 | Desktop App / AI CLI Terminal Workspace |
| 主要语言 | TypeScript |
| 主要框架 | Electron + React + Vite |
| 终端技术 | xterm.js + node-pty（MVP 后续接入真实 PTY） |
| 运行环境 | macOS first；后续可扩展 Windows/Linux |

## 2. 包管理器

| 项目 | 内容 |
|------|------|
| 包管理器 | npm |
| 安装命令 | `npm install` |
| 锁文件 | `package-lock.json` |

## 3. 常用命令

| 用途 | 命令 | 备注 |
|------|------|------|
| 安装依赖 | `npm install` | 不得切换包管理器，除非用户确认 |
| 启动开发服务 | `npm run dev` | 同时启动 Vite 和 Electron |
| 工作流检查 | `npm run workflow:doctor` | 检查 agent workflow wiring |
| 工作流测试 | `npm run test:workflow` | Python 工作流 CLI 测试 |
| Typecheck | `npm run typecheck` | TypeScript 类型检查 |
| Build | `npm run build` | 构建 renderer 和 main/preload |
| Lint | 无 | 后续引入 ESLint 前需用户确认 |
| Format | 无 | 后续引入 Prettier 前需用户确认 |

## 4. 目录结构

| 路径 | 说明 |
|------|------|
| `src/main/` | Electron main process |
| `src/preload/` | Electron preload bridge |
| `src/renderer/` | React renderer UI |
| `docs/requirements/` | 从 Obsidian 导入的需求、UI、架构和竞品调研 |
| `docs/assets/mockups/` | UI 效果图 |
| `docs/assets/ui-references/` | 竞品 UI 参考图 |
| `.agent-workflow/` | agent-workflow-template 工作流 |
| `scripts/` | 工作流 CLI 和后续维护脚本 |
| `tests/` | 工作流 CLI 测试；后续增加应用测试 |

## 5. 环境变量

| 变量名 | 用途 | 是否敏感 | 来源 |
|--------|------|----------|------|
| `VITE_DEV_SERVER_URL` | Electron 开发模式加载 Vite 地址 | 否 | npm script |
| `ANTHROPIC_BASE_URL` | Claude 会话 endpoint；由 AgentDock 注入 PTY | 否 | Profile 配置 |
| `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY` | Claude API Key；由 AgentDock 从 Keychain 注入 PTY | 是 | macOS Keychain |
| `OPENAI_BASE_URL` | Codex/OpenAI 会话 endpoint；由 AgentDock 按 Profile 注入 PTY | 否 | Profile 配置 |
| `CODEX_HOME` | Codex 每 Profile 独立配置目录 | 否 | AgentDock 生成 |
| `OPENAI_API_KEY` | Codex/OpenAI API Key；由 AgentDock 从 Keychain 注入 PTY | 是 | macOS Keychain |

## 6. 本地环境文件

| 文件 | 用途 | 是否可提交 |
|------|------|------------|
| `.env` | 本地开发变量/密钥 | 否 |
| `.env.example` | 示例配置 | 是 |
| `.agentdock-local/` | 本地实验数据 | 否 |

## 7. 测试策略

- 工作流测试：`npm run test:workflow`
- 类型检查：`npm run typecheck`
- 构建验证：`npm run build`
- MVP UI 验证：`npm run dev` 手动打开 Electron 窗口
- 后续真实验证：实际启动 Claude/Codex PTY 会话，确认 endpoint/API key/CODEX_HOME 隔离
- 允许 mock：Profile/Workspace metadata、Keychain adapter 测试替身
- 必须真实验证：node-pty 启动、键盘输入、Ctrl+C、中文输入、Codex 独立 CODEX_HOME、Keychain 读写

## 8. 部署信息

| 项目 | 内容 |
|------|------|
| 打包方式 | 后续评估 electron-builder / electron-forge |
| CI/CD | 暂无；GitHub repo 创建后可增加 GitHub Actions |
| 生产环境入口 | macOS Desktop App |
| 回滚方式 | Git tag / GitHub release 回滚 |

## 9. 项目约束

- AgentDock 是“终端优先的内嵌终端工作台”，不是 API 网关后台，也不是完整 IDE。
- 主界面必须简洁：顶部启动条 + 会话标签 + 大终端区域；当前会话详情默认收起。
- API 配置界面按工具类型分类：Claude / Codex / Gemini / OpenCode / 全部，参考 CC Switch。
- API Profile 与 Workspace 必须解耦。
- Claude 每个会话通过独立 PTY 环境变量隔离 endpoint/key。
- Codex 每个会话必须隔离 endpoint/key；每个 Profile 使用独立 `CODEX_HOME`。
- Renderer / preload / IPC 不得返回完整 secret，也不得返回完整环境变量对象；只能返回脱敏预览或最小必要 metadata。
- API Key 不得明文写入代码、文档、测试 fixture、日志或前端状态持久化；只保存 Keychain 引用。
- 不做全局 provider 切换，不修改正在运行的其他终端会话。
- MVP 暂不做成本统计、请求日志、自动路由、fallback、复杂 Dashboard、分屏 IDE。

## 10. 主 Agent 启动要求

主 Agent 在执行 `intake_hook` 前必须：

1. 读取本文件。
2. 读取 `docs/PROJECT_REQUIREMENTS.md`。
3. 读取 `DECISIONS.md`。
4. 读取 `.agent-workflow/state.md`。
5. 根据任务风险分级；涉及 Keychain、PTY、外部 CLI、环境变量、构建发布的任务至少 L3。
