# AgentDock Phase 2 Real Terminal & Keychain SPEC

## 背景

Phase 1 MVP Foundation 已完成并验证：测试框架、类型/脱敏、启动环境、adapter contracts、metadata stores、preload IPC 安全边界、Renderer UI、内存 session orchestration 均已落地。MVP 下一阶段需要把基础层连接到真实 macOS Keychain、真实 `node-pty` 和 xterm.js 终端渲染，证明 Claude / Codex 会话能以独立 endpoint/key/CODEX_HOME 在内嵌终端中运行。

## 目标

交付真实终端与 Keychain MVP：用户能通过 AgentDock 读取 Keychain 中的 API key，启动真实 PTY 会话，在 xterm.js 标签页中输入/输出，并保持 Claude/Codex 每会话 endpoint/key/CODEX_HOME 隔离。

## 非目标

- 不做成本统计、请求日志、API gateway、fallback、自动路由。
- 不做完整 IDE、diff viewer、复杂分屏。
- 不做团队同步或云端账号。
- 不要求连接真实付费外部 provider 做联网请求；真实 API key/账号必须由用户显式提供后才能验证。

## 用户路径 / 调用路径

1. 用户在 API 配置中选择或创建 Claude / Codex Profile。
2. API key 存入 macOS Keychain，metadata 只保存 Keychain 引用。
3. 用户选择 Workspace 与命令。
4. AgentDock 读取 Keychain secret，构建会话专属环境变量。
5. PTY adapter 启动真实 shell / command。
6. Renderer 的 xterm.js 终端显示 PTY 输出，并把用户输入写回 PTY。
7. 多个会话标签页同时存在且互不影响。
8. 当前会话详情可展开查看脱敏 endpoint/key 来源/workspace。

## 功能要求

- `KeychainAdapter` 接入真实 `keytar` 或可替代实现。
- `PtyAdapter` 接入真实 `node-pty`。
- `SessionService` 从内存 metadata 升级为可注入 Keychain/Pty adapter 的编排层。
- `buildLaunchEnvironment` 输出只在 main process / PTY 层使用，不通过 IPC 返回完整 env。
- Renderer 使用 xterm.js 创建每 session terminal instance。
- IPC 支持 terminal output/input/resize/kill，但不得返回完整 secret 或完整 env。
- Claude 会话注入独立 `ANTHROPIC_BASE_URL` 和 Key。
- Codex 会话注入独立 `OPENAI_BASE_URL`、`OPENAI_API_KEY` 和 `CODEX_HOME`。
- 关闭/重启一个会话不影响其他会话。

## 边界情况

- Keychain 缺少 secret：启动失败，错误信息不得包含 secret；提示用户补全配置。
- CLI 不存在：启动失败，返回安全错误和 command 名称，不泄露 env。
- Workspace path 不存在：启动失败，提示路径不可用。
- PTY spawn 失败：session 标记 failed，保留安全错误。
- Resize / input 发送到已关闭 session：fail fast 或安全忽略并返回明确错误。

## 技术选择

- 语言/框架：TypeScript + Electron + React + Vite。
- 终端：xterm.js + `node-pty`。
- Keychain：优先使用已存在 optionalDependency `keytar`。
- 测试：Vitest + jsdom + React Testing Library；真实 PTY/Keychain 需补充手工/集成验证记录。
- 包管理：npm。

## 文件边界

- 允许修改：
  - `src/main/**`
  - `src/preload/**`
  - `src/renderer/**`
  - `src/shared/**`
  - `tests/app/**`
  - `.agent-workflow/state.md`
  - `.agent-workflow/verification/**`
  - `docs/plans/**`
- 禁止修改：
  - `.env`
  - 包管理器类型
  - 产品范围
  - Git remote / history
- 暂停条件：
  - 进入真实 `node-pty` / Keychain 集成前需要确认。
  - 处理真实 API key、真实账号、真实外部服务前需要确认。
  - 需要新增生产依赖前需要确认。

## 依赖关系

- 前置任务：Phase 1 verification PASS。
- 依赖模块：Phase 1 adapter contracts、stores、preload API、Renderer shell。
- 可并行任务：Keychain adapter 与 PTY adapter 可并行设计，但真实集成验证必须串行并记录。

## 任务拆分判断

- 是否需要拆分：需要。
- 拆分理由：真实 Keychain、PTY、终端 I/O、环境变量隔离均为 L3 风险，需要 TDD + 小批次验证 + 真实验证记录。

## 风险等级

L3

## 触发原因

- 真实 Keychain secret 读写。
- 真实 `node-pty` native module。
- 真实 PTY 环境变量注入。
- 外部 CLI（Claude / Codex）。
- 用户本地 shell、PATH、Workspace 路径和输入输出行为。

## 验收标准

- 可用 fake adapter 单元测试覆盖 Keychain/Pty 编排，不泄露 secret/env。
- 真实 Keychain adapter 有隔离测试或手工验证记录。
- 真实 PTY adapter 有本地命令验证记录。
- xterm.js 能显示 PTY 输出并发送输入。
- Claude/Codex 环境变量隔离在测试或验证记录中被证明。
- `npm run workflow:doctor`、`npm run test:workflow`、`npm run test`、`npm run build` 通过。

## 验收证据

- 测试命令：
  - `npm run test`
  - `npm run test:workflow`
- 构建 / Typecheck：
  - `npm run workflow:doctor`
  - `npm run build`
- 真实环境验证：
  - node-pty 本地命令 spawn / input / output / resize / kill。
  - macOS Keychain write/read/delete，使用测试 service/account 和非真实 secret。
  - Claude/Codex CLI 真实启动前需用户确认是否提供真实账号/key。
- 未验证项：
  - 未经用户确认不得使用真实 API key。

