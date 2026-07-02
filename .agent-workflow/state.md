# Agent Workflow State

## 当前任务
AgentDock Phase 2 Real Terminal & Keychain：Phase 1 已验证完成；Phase 2 Task 1-6 已完成；真实 Keychain / node-pty 本地安全验证与 Phase 2 总验证均已通过。

## 风险等级
L3

触发原因：Electron 桌面应用、内嵌终端 PTY、API Key/Keychain、环境变量注入、外部 CLI（Claude/Codex）、GitHub 仓库初始化。

## 当前 Hook
plan_review_hook

## 当前阶段
phase-2-pass

## 已派发角色
| 角色 | 状态 | 产出 |
|------|------|------|
| 主 Agent | PASS | 项目骨架、文档、工作流配置、GitHub 仓库 |
| ⑦文档工程师 | PASS | docs/PROJECT_REQUIREMENTS.md、README.md、PROJECT_PROFILE.md、DECISIONS.md |
| ⑧集成工程师 | PASS | workflow doctor、workflow tests、typecheck、build |
| ⑨部署工程师 | PASS | GitHub private repo: https://github.com/peyoba/AgentDock |
| 主 Agent | PASS | Phase 1 基础层实现与验证：测试框架、类型/脱敏、启动环境、adapter contracts、metadata stores、preload IPC、Renderer UI、session orchestration |
| 主 Agent | PASS | Phase 2 SPEC 与实施计划：`.agent-workflow/specs/2026-07-02-agentdock-phase-2-real-terminal-keychain.md`、`docs/plans/2026-07-02-agentdock-phase-2-real-terminal-keychain.md` |
| 主 Agent | PASS | Phase 2 Task 1：SessionService fake Keychain/PTTY adapter 注入编排与安全返回测试 |
| 主 Agent | PASS | Phase 2 Task 4（非真实集成部分）：Terminal input/resize/kill IPC whitelist、terminal output 订阅、安全 payload 合同、SessionService fake PTY 控制 |
| 主 Agent | PASS | Phase 2 Task 5（非真实集成部分）：Renderer TerminalPane 创建 xterm instance，输入/resize 走 IPC，按 sessionId 接收 output，unmount 清理订阅 |
| 主 Agent | PASS | Phase 2 Task 2/3：真实 `keytar` Keychain adapter、真实 `node-pty` adapter、本地测试 service/account 与安全 PTY 命令验证 |
| 主 Agent | PASS | Phase 2 Task 6：总验证通过并记录 `.agent-workflow/verification/2026-07-02-phase-2-real-terminal-keychain.md` |
| 主 Agent | PASS | Renderer launch flow：启动按钮接入 `launchSession`、动态 sessions/tabs、active xterm session、安全错误显示 |
| 主 Agent | PASS | Session launch failure safety：workspace 缺失先失败、PTY 启动失败标记 failed、安全错误不泄露 secret/env |

状态只能使用：`READY / RUNNING / PASS / FAIL / BLOCKED / SKIPPED`

## 阻塞点
无

## 用户待确认
无。用户已确认进入 Phase 2 真实 Keychain 和真实 node-pty 集成；验证约束为不使用真实 API key，只做测试 service/account 和本地安全 PTY 命令验证。

## 下一步
Phase 2 已完成；已继续补上 renderer 启动按钮到真实 IPC/session 的产品化连接，并加固 launch failure 安全处理。后续若要验证真实 Claude/Codex CLI 账号或 API key，必须由用户另行明确确认。

## Phase 1 暂停规则
Phase 1 内部任务不需要逐项再确认；只有新增生产依赖、进入真实 node-pty/Keychain 集成、修改产品范围或遇到安全风险时才暂停请求用户确认。

## 决策记录
| 时间 | 决策 | 理由 |
|------|------|------|
| 2026-07-01 | Electron + React + TypeScript + xterm.js + node-pty | 内嵌终端成熟度最高，接近 VSCode/Cursor |
| 2026-07-01 | 主界面终端优先，当前会话详情默认收起 | 用户接受简化方向 |
| 2026-07-01 | API 配置按工具类型分类，参考 CC Switch | 用户明确要求 |
| 2026-07-01 | 创建 GitHub 私有仓库 | 用户明确要求创建 GitHub 仓库；私有仓库更适合开发初期 |
| 2026-07-02 | Phase 1 执行确认并补充安全/UI 测试约束 | 用户确认计划并要求 Codex endpoint 隔离、Renderer/IPC 不返回完整 secret/env、UI 测试覆盖关键 UI 行为 |

## 验证记录
| 时间 | 命令 | 结果 |
|------|------|------|
| 2026-07-01 | `npm run workflow:doctor` | PASS |
| 2026-07-01 | `npm run test:workflow` | PASS：8 passed |
| 2026-07-01 | `npm run typecheck` | PASS |
| 2026-07-01 | `npm run build` | PASS |
| 2026-07-01 | `grep` 密钥模式扫描 | 未发现真实 key |
| 2026-07-02 | `npm run workflow:doctor` | PASS |
| 2026-07-02 | `npm run test:workflow` | PASS：8 passed |
| 2026-07-02 | `npm run test` | PASS：3 files / 5 tests |
| 2026-07-02 | `npm run build` | PASS |
| 2026-07-02 | key-like secret scan | 未发现真实 API key；命中项仅为历史文档/mockup 占位符 |
| 2026-07-02 | `npm run workflow:doctor` | PASS |
| 2026-07-02 | `npm run test:workflow` | PASS：8 passed |
| 2026-07-02 | `npm run test` | PASS：6 files / 11 tests |
| 2026-07-02 | `npm run build` | PASS |
| 2026-07-02 | key-like secret scan | 未发现真实 API key；命中项仅为历史文档/mockup 占位符 |
| 2026-07-02 | `npm run workflow:doctor` | PASS |
| 2026-07-02 | `npm run test:workflow` | PASS：8 passed |
| 2026-07-02 | `npm run test` | PASS：8 files / 15 tests |
| 2026-07-02 | `npm run build` | PASS |
| 2026-07-02 | key-like secret scan | 未发现真实 API key；命中项仅为历史文档/mockup 占位符 |
| 2026-07-02 | `npm run test -- sessionService sessionSecurity` | PASS：2 files / 2 tests |
| 2026-07-02 | `npm run build` | PASS |
| 2026-07-02 | `npm run test` | PASS：9 files / 16 tests |
| 2026-07-02 | `npm run workflow:doctor` | PASS |
| 2026-07-02 | `npm run test:workflow` | PASS：8 passed |
| 2026-07-02 | `npm run test -- sessionServiceTerminal terminalIpcTypes` | PASS：2 files / 4 tests |
| 2026-07-02 | `npm run build` | PASS |
| 2026-07-02 | `npm run test` | PASS：11 files / 20 tests |
| 2026-07-02 | `npm run workflow:doctor` | PASS |
| 2026-07-02 | `npm run test:workflow` | PASS：8 passed |
| 2026-07-02 | `git diff --check` | PASS |
| 2026-07-02 | API Key input clarity | PASS：配置页显示 `API Key（保存到 macOS 钥匙串）` 密码框和留空保留当前 Key 说明 |
| 2026-07-02 | packaged Codex PATH lookup | PASS：PTY PATH 补齐 `~/.npm-global/bin` 等用户 CLI 路径；成品 App `command -v codex` 输出 `/Users/peyoba/.npm-global/bin/codex` |
| 2026-07-02 | `npm run test` | PASS：17 files / 47 tests |
| 2026-07-02 | `npm run build` | PASS |
| 2026-07-02 | `npm run package:mac` | PASS：重新生成 `release/AgentDock-darwin-arm64/AgentDock.app` |
| 2026-07-02 | packaged API key and Codex PATH smoke | PASS：remote debugging 验证 API Key 输入框和 packaged shell Codex PATH |
| 2026-07-02 | `npm run workflow:doctor` | PASS |
| 2026-07-02 | `npm run test:workflow` | PASS：8 passed |
| 2026-07-02 | `git diff --check` | PASS |
| 2026-07-02 | Phase 2 total verification | PASS：workflow doctor、workflow tests、app tests、build、key-like scan |
| 2026-07-02 | Safe end-to-end SessionService verification | PASS：real Keychain + real PTY + local command; returned payload contains no test secret |
| 2026-07-02 | Renderer launch flow tests | PASS：App launch IPC and safe error behavior covered |
| 2026-07-02 | Session launch failure safety tests | PASS：15 files / 29 tests、build、workflow、diff check |
| 2026-07-02 | `npm run test -- keychainAdapter ptyAdapter` | PASS：2 files / 4 tests |
| 2026-07-02 | `npm run build` | PASS |
| 2026-07-02 | Real Keychain verification | PASS：test service/account write/read/delete; no real API key |
| 2026-07-02 | Real node-pty verification | PASS：local `printf agentdock-pty-ok`; no real API key |
| 2026-07-02 | `npm run test -- keychainAdapter ptyAdapter` | PASS：2 files / 4 tests |
| 2026-07-02 | `npm run build` | PASS |
| 2026-07-02 | `npm run test` | PASS：14 files / 25 tests |
| 2026-07-02 | `npm run workflow:doctor` | PASS |
| 2026-07-02 | `npm run test:workflow` | PASS：8 passed |
| 2026-07-02 | `git diff --check` | PASS |
| 2026-07-02 | `npm run test -- TerminalPane` | PASS：1 file / 1 test |
| 2026-07-02 | `npm run build` | PASS |
| 2026-07-02 | `npm run test` | PASS：12 files / 21 tests |
| 2026-07-02 | `npm run workflow:doctor` | PASS |
| 2026-07-02 | `npm run test:workflow` | PASS：8 passed |
| 2026-07-02 | `git diff --check` | PASS |

| 2026-07-02 | `npm run package:mac` | PASS：生成本地 ad-hoc signed App；原生模块 unpack 检查通过 |
| 2026-07-02 | macOS package validation | PASS：codesign verify、app.asar 内容、node-pty/keytar unpack、Gatekeeper expected reject |

| 2026-07-02 | packaged App white-screen fix | PASS：Vite `base: './'` 修复 file:// 下 `/assets` 绝对路径导致的白屏；packaged DOM 冒烟通过 |
| 2026-07-02 | `npm run test` | PASS：16 files / 31 tests |

| 2026-07-02 | renderer interaction completion | PASS：命令选择、API 类型过滤、配置卡片选择、加号启动、关闭 tab、动态详情已接状态/IPC |
| 2026-07-02 | packaged UI interaction smoke | PASS：成品 App 中点击 Codex 过滤与配置卡片选择生效 |

| 2026-07-02 | System AnyRouter API key test | PARTIAL PASS：`/v1/models` 鉴权成功 16 models；模型调用返回上游 Service Unavailable/配置提示 |
| 2026-07-02 | AgentDock AnyRouter endpoint config | PASS：Claude CLI base URL 修正为 `https://anyrouter.top`，避免 `/v1/v1/messages` |

| 2026-07-02 | API config editing | PASS：可编辑名称、工具类型、Base URL、默认模型、Keychain 引用、Codex Home；保存走 `profiles:save` IPC 并影响 launch profile |
| 2026-07-02 | packaged API config editing smoke | PASS：成品 App 表单存在、保存提示出现、未暴露 secret/env 字段名 |
| 2026-07-02 | API config page plan alignment | PASS：默认终端工作台不再内嵌配置；顶部“接口配置”打开独立配置页；“返回终端工作台”回到主界面 |
| 2026-07-02 | API multi-profile creation | PASS：新增配置生成唯一 profile id 和唯一 Keychain Account，可保存不同 Base URL/API Key |
| 2026-07-02 | Codex Home preparation | PASS：`~/...` 展开为绝对路径，并在启动 Codex 前创建 `CODEX_HOME` 目录 |
| 2026-07-02 | `npm run test` | PASS：17 files / 46 tests |
| 2026-07-02 | `npm run build` | PASS |
| 2026-07-02 | `npm run package:mac` | PASS：重新生成 `release/AgentDock-darwin-arm64/AgentDock.app` |
| 2026-07-02 | packaged API config page smoke | PASS：remote debugging 验证默认主界面、进入独立 API 配置页、返回终端工作台 |
| 2026-07-02 | `npm run workflow:doctor` | PASS |
| 2026-07-02 | `npm run test:workflow` | PASS：8 passed |
| 2026-07-02 | `git diff --check` | PASS |

## 批次进展
| 批次 | 状态 | 产出 |
|------|------|------|
| Phase 1 Batch 1 | PASS | 测试框架、共享类型、密钥脱敏、Claude/Codex 启动环境生成；验证记录 `.agent-workflow/verification/2026-07-02-phase-1-batch-1.md` |
| Phase 1 Batch 2 | PASS | Keychain/PTY adapter contracts、Profile/Workspace metadata stores、preload IPC 安全边界；验证记录 `.agent-workflow/verification/2026-07-02-phase-1-batch-2.md` |
| Phase 1 Batch 3 | PASS | 终端优先 Renderer、UI 行为测试、内存 session orchestration；验证记录 `.agent-workflow/verification/2026-07-02-phase-1-batch-3.md` |
| Phase 1 MVP Foundation | PASS | 总验证记录 `.agent-workflow/verification/2026-07-02-agentdock-phase-1-mvp-foundation.md` |
| Phase 2 Plan | PASS | SPEC 与计划已创建；真实集成前等待确认 |
| Phase 2 Task 1 | PASS | `SessionService` 支持 fake Keychain/PTTY adapter 注入、构建 env 并 spawn fake PTY；返回/list 只暴露安全 metadata |
| Phase 2 Task 4（fake IPC/control） | PASS | `SessionService` 支持 terminal write/resize/kill/output 订阅；preload whitelist 增加 terminal API；IPC payload 不暴露 secret/env |
| Phase 2 Task 5（xterm binding） | PASS | `TerminalPane` 为 active session 创建 xterm；xterm input/resize 通过 preload IPC 发送；terminal output 按 sessionId 写入 xterm；unmount 清理订阅与 terminal instance |
| Phase 2 Task 2/3（real adapters） | PASS | `createKeytarAdapter` 使用真实 keytar；`createNodePtyAdapter` 使用真实 node-pty 并确保 Unix spawn-helper 可执行；验证记录 `.agent-workflow/verification/2026-07-02-phase-2-real-keychain-pty.md` |
| Phase 2 Real Terminal & Keychain | PASS | 总验证与安全端到端验证记录 `.agent-workflow/verification/2026-07-02-phase-2-real-terminal-keychain.md`；真实 API key / CLI 账号未验证（未授权） |
| Renderer launch flow | PASS | 验证记录 `.agent-workflow/verification/2026-07-02-renderer-launch-flow.md`；启动按钮已接真实 preload IPC |
| Session launch failure safety | PASS | 验证记录 `.agent-workflow/verification/2026-07-02-session-launch-failure-safety.md`；缺 workspace/PTY fail 不泄露 secret/env |
| macOS local package | PASS | 产物 `release/AgentDock-darwin-arm64/AgentDock.app`；验证记录 `.agent-workflow/verification/2026-07-02-macos-local-package.md`；仅本地 ad-hoc 签名，未 notarize |
| Renderer MVP interactions | PASS | 命令栏 select、API 配置筛选/选择、加号启动、关闭会话、动态详情；验证记录 `.agent-workflow/verification/2026-07-02-macos-local-package.md` |
| Real AnyRouter key smoke | PARTIAL PASS | 系统 `ANYROUTER_API_KEY` 已写入 Keychain `AgentDock/claude-anyrouter`；models 鉴权成功；上游模型调用暂不可用；默认 endpoint 修正为 `https://anyrouter.top` |
| API Config Editing MVP | PASS | 接口配置编辑表单、`saveProfile` preload API、主进程 profileStore 保存、launch 读取保存后配置；验证记录 `.agent-workflow/verification/2026-07-02-macos-local-package.md` |
| API Config Page Alignment | PASS | 按计划改为独立配置页面/视图；支持多 profile 新增与独立 Keychain Account；验证记录 `.agent-workflow/verification/2026-07-02-macos-local-package.md` |
| Codex Home Launch Fix | PASS | `CODEX_HOME` 展开 `~` 并自动创建目录，避免 Codex CLI 启动前报路径不存在 |
| API Key Input Clarity | PASS | 配置页明确显示 API Key 密码框，保存到 macOS Keychain，留空保留当前 Key |
| Packaged Codex PATH Fix | PASS | 打包 App 的 PTY 环境补齐用户 CLI PATH，解决 `zsh:1: command not found: codex` |
| 2026-07-02 | Keychain prompt mitigation | PASS：主进程缓存同一 App 运行期间已读取/写入的 secret，减少重复 macOS 系统密码弹窗；不通过 renderer/IPC 暴露 secret/env |
| 2026-07-02 | `npm run test` | PASS：17 files / 50 tests |
| 2026-07-02 | `npm run build` | PASS |
| 2026-07-02 | `npm run package:mac` | PASS：重新生成 `release/AgentDock-darwin-arm64/AgentDock.app` |
| 2026-07-02 | `npm run workflow:doctor` | PASS |
| 2026-07-02 | `npm run test:workflow` | PASS：8 passed |
| 2026-07-02 | `git diff --check` | PASS |
| 2026-07-02 | macOS window move/resize fix | PASS：自定义标题栏增加 drag/no-drag 区域；BrowserWindow 显式 resizable 且最小尺寸降为 720x480；打包 app.asar 已确认包含修复 |
| 2026-07-02 | `npm run test` | PASS：18 files / 52 tests |
| 2026-07-02 | `npm run build` | PASS |
| 2026-07-02 | `npm run package:mac` | PASS：重新生成 `release/AgentDock-darwin-arm64/AgentDock.app` |
| 2026-07-02 | packaged window chrome smoke | PASS：app.asar 包含 720x480/resizable true 和 app-region drag/no-drag CSS |
| 2026-07-02 | `npm run workflow:doctor` | PASS |
| 2026-07-02 | `npm run test:workflow` | PASS：8 passed |
| 2026-07-02 | `git diff --check` | PASS |
| 2026-07-02 | Workspace path picker | PASS：主界面工作区下拉旁新增“选择路径”；首次目录选择后保存到 `workspaces.json` 并立即选中，下次 `workspaces:list` 可直接选择 |
| 2026-07-02 | `npm run test` | PASS：19 files / 55 tests |
| 2026-07-02 | `npm run build` | PASS |
| 2026-07-02 | `npm run package:mac` | PASS：重新生成 `release/AgentDock-darwin-arm64/AgentDock.app` |
| 2026-07-02 | packaged workspace picker smoke | PASS：app.asar 包含 `workspaces:choose`、目录选择器、preload `chooseWorkspace`、renderer “选择路径”按钮、workspaceStore/workspaceService |
| 2026-07-02 | `npm run workflow:doctor` | PASS |
| 2026-07-02 | `npm run test:workflow` | PASS：8 passed |
| 2026-07-02 | `git diff --check` | PASS |
| 2026-07-02 | API config advanced fields UX | PASS：默认隐藏配置 ID/Keychain/Codex Home；高级设置展开后内部字段只读；Codex Home 仅 Codex 配置显示 |
| 2026-07-02 | `npm run test` | PASS：19 files / 57 tests |
| 2026-07-02 | `npm run build` | PASS |
| 2026-07-02 | `npm run package:mac` | PASS：重新生成 `release/AgentDock-darwin-arm64/AgentDock.app` |
| 2026-07-02 | packaged API advanced fields smoke | PASS：app.asar 包含“显示/隐藏高级设置”、高级说明和 readOnly 逻辑 |
| 2026-07-02 | `npm run workflow:doctor` | PASS |
| 2026-07-02 | `npm run test:workflow` | PASS：8 passed |
| 2026-07-02 | `git diff --check` | PASS |
| 2026-07-02 | Main UI visible redesign | PASS：顶部品牌图标、Quick Launch 深色说明卡 + 白色字段面板、胶囊式会话 tabs、详情高级信息默认隐藏 |
| 2026-07-02 | API config visual polish | PASS：配置卡片不再默认显示 Keychain 引用，文案转为“密钥存储”，保持高级字段默认隐藏/只读 |
| 2026-07-02 | Pre-push security check | PASS：release/dist/node_modules/env/workspaces/profiles 未跟踪；无真实 key/token/private key；测试假 sk 字符串已改为 test 形态 |
| 2026-07-02 | `npm run test` | PASS：20 files / 62 tests |
| 2026-07-02 | `npm run build` | PASS |
| 2026-07-02 | `npm run package:mac` | PASS：重新生成 `release/AgentDock-darwin-arm64/AgentDock.app` |
| 2026-07-02 | `npm run workflow:doctor` | PASS |
| 2026-07-02 | `npm run test:workflow` | PASS：8 passed |
| 2026-07-02 | `git diff --check` | PASS |
