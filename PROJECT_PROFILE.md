# Project Profile — AgentDock 代理坞

本文件记录 AgentDock 的技术栈、命令、环境变量和运行约定。主 Agent 启动工作流时必须读取本文件。

## 1. 项目基本信息

| 项目 | 内容 |
|------|------|
| 项目名称 | AgentDock 代理坞 |
| 项目类型 | Desktop App / AI CLI Terminal Workspace |
| 主要语言 | TypeScript |
| 主要框架 | Electron + React + Vite |
| 终端技术 | xterm.js + node-pty（真实 PTY 已接入） |
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
| macOS 打包 | `npm run package:mac` | 输出到 `release/packages/<timestamp>/...`，默认不覆盖固定 App |
| Lint | 无 | 后续引入 ESLint 前需用户确认 |
| Format | 无 | 后续引入 Prettier 前需用户确认 |

## 4. 目录结构

| 路径 | 说明 |
|------|------|
| `src/main/` | Electron main process |
| `src/preload/` | Electron preload bridge |
| `src/renderer/` | React renderer UI |
| `docs/requirements/` | 从 Obsidian 导入的需求、UI、架构和竞品调研 |
| `docs/assets/ui-references/` | 竞品 UI 参考图 |
| `.agent-workflow/` | agent-workflow-template 工作流 |
| `scripts/` | 工作流 CLI 和后续维护脚本 |
| `tests/` | Vitest 应用测试与 pytest 工作流 CLI 测试 |

## 5. 环境变量

| 变量名 | 用途 | 是否敏感 | 来源 |
|--------|------|----------|------|
| `VITE_DEV_SERVER_URL` | Electron 开发模式加载 Vite 地址 | 否 | npm script |
| `ANTHROPIC_BASE_URL` | Claude 会话 endpoint；由 AgentDock 注入 PTY | 否 | Profile 配置 |
| `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY` | Claude API Key；由 AgentDock 从本机加密 vault 注入 PTY | 是 | 本机加密 `secrets.vault.json` |
| `OPENAI_BASE_URL` | Codex/OpenAI 会话 endpoint；由 AgentDock 按 Profile 注入 PTY | 否 | Profile 配置 |
| `CODEX_HOME` | 原生模式使用每 Profile 独立目录；NewAPI 兼容模式使用每 Session 临时运行目录 | 否 | AgentDock 生成 |
| `OPENAI_API_KEY` | Codex/OpenAI API Key；由 AgentDock 从本机加密 vault 注入 PTY | 是 | 本机加密 `secrets.vault.json` |

## 6. 本地环境文件

| 文件 | 用途 | 是否可提交 |
|------|------|------------|
| `.env` | 本地开发变量/密钥 | 否 |
| `.env.example` | 示例配置 | 是 |
| `.agentdock-local/` | 本地实验数据 | 否 |
| `secrets.vault.json` | 用户本机加密 API Key vault，位于 Electron userData | 否 |

## 7. 测试策略

- 工作流测试：`npm run test:workflow`
- 类型检查：`npm run typecheck`
- 构建验证：`npm run build`
- MVP UI 验证：`npm run dev` 手动打开 Electron 窗口
- 持续真实验证：实际启动 Claude/Codex PTY 会话，确认 endpoint/API key/CODEX_HOME 隔离；Codex 兼容模式还必须验证真实工具闭环、并发 Session 和生命周期清理
- 允许 mock：Profile/Workspace metadata、secret adapter 测试替身
- 必须真实验证：node-pty 启动、键盘输入、Ctrl+C、中文输入、Codex 原生 Profile `CODEX_HOME`、兼容模式单 Session 运行目录、本机加密 vault 读写，以及恢复正文不进入进程 argv

## 8. 部署信息

| 项目 | 内容 |
|------|------|
| 打包方式 | `npm run package:mac`，当前使用 electron-packager 输出本地时间戳目录 |
| CI/CD | 暂无；GitHub repo 创建后可增加 GitHub Actions |
| 生产环境入口 | macOS Desktop App |
| 回滚方式 | Git tag / GitHub release 回滚 |

## 9. 项目约束

- AgentDock 是“终端优先的内嵌终端工作台”，不是 API 网关后台，也不是完整 IDE。
- 主界面必须简洁：左侧长期会话库 + 顶部启动条 + 大终端区域 + 默认收起的右侧项目面板。
- API 配置界面按当前支持范围分类：Claude / Codex / 全部，参考 CC Switch；Gemini / OpenCode 在启动环境完成前保持隐藏。
- API Profile 与 Workspace 必须解耦。
- Claude 每个会话通过独立 PTY 环境变量隔离 endpoint/key。
- Codex 每个会话必须隔离 endpoint/key；原生模式按 Profile 隔离 `CODEX_HOME`，兼容模式按 Session 隔离临时运行目录。
- Codex 提供“原生 Codex · Responses”和“完整工具 · NewAPI 兼容”两种显式模式；旧 Profile/Session 缺少模式时固定走原生路径，不得自动改变历史网络行为。
- NewAPI 兼容层仅限 loopback、单 Session 生命周期和 `model` 字段精确重写；不得改写 tools/input/instructions、解析 SSE 工具事件、记录请求正文，或扩展成自动路由/fallback/API gateway。
- NewAPI 兼容模式必须使用单 Session 临时运行时 `CODEX_HOME`，不得让同一 Profile 的并发 Session 共享并覆盖运行配置；Profile 独立目录仍保留给原生模式和持久配置。
- Claude/Codex 恢复正文不得进入 CLI argv、Session command、日志或错误；只能在 TUI 就绪后通过 PTY 注入一次，超时或提前退出必须显式失败。
- Renderer / preload / IPC 默认不得返回完整 secret，也不得返回完整环境变量对象；仅当用户明确点击查看某个已保存 Profile 的 API Key 时，专用 IPC 可按需返回该单个 secret，且不得广播、记录日志或持久化到前端状态。
- API Key 不得明文写入代码、文档、测试 fixture、日志或前端状态持久化；只进入本机加密 vault，配置中只保存脱敏状态和引用信息。
- 不做全局 provider 切换，不修改正在运行的其他终端会话。
- MVP 暂不做成本统计、请求日志、自动路由、fallback、复杂 Dashboard、分屏 IDE。

## 10. 主 Agent 启动要求

主 Agent 在执行 `intake_hook` 前必须：

1. 读取本文件。
2. 读取 `docs/PROJECT_REQUIREMENTS.md`。
3. 读取 `DECISIONS.md`。
4. 读取 `.agent-workflow/state.md`。
5. 根据任务风险分级；涉及密钥存储、PTY、外部 CLI、环境变量、构建发布的任务至少 L3。

## 11. Codex NewAPI 兼容能力的验证与回滚边界

- 自动化可以证明模式白名单、单字段重写、SSE 顺序、请求大小边界、生命周期清理、metadata/IPC 隔离和恢复 argv 合同，但不能代替真实上游与 node-pty 验收。
- 2026-07-13 已使用用户本机已保存 Profile 验证实际命令工具闭环、真实 node-pty、进程 argv、运行时 Key 隔离和临时目录清理；新建兼容会话可真实执行 `pwd` 与 `uname -a`。双 Session 与完整 fresh/resume/interrupted 真机矩阵仍应在 clean 发布候选前补跑。
- 上游不支持、适配器失败或工具调用未发生时，不得自动换模型、协议或 provider；应保留真实失败状态。
- 功能回滚优先在启动栏或 Codex Profile 中选择“原生 Codex · Responses”并重新启动 Session；发布回滚仍使用 Git tag / GitHub Release。原生模式是否具备相同工具能力由其上游实际支持决定。
