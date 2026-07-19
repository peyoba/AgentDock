# Decision Log — AgentDock

本文件记录用户已确认、已拒绝或需要长期遵守的项目决策。

## 已确认决策

| 日期 | 决策 | 理由 | 影响范围 |
|------|------|------|----------|
| 2026-07-01 | 产品定位为“多配置内嵌终端工作台”，不是全局 API 切换器 | 用户需要多个 Claude/Codex 终端同时使用不同 endpoint/API key，互不干扰 | 产品核心交互、数据模型、启动逻辑 |
| 2026-07-01 | 技术栈采用 Electron + React + TypeScript + xterm.js + node-pty | 最接近 VSCode/Cursor 内嵌终端方案，利于 AI Coding 快速开发 | 架构、依赖、测试策略 |
| 2026-07-01 | 主界面采用终端优先的极简结构 | 用户反馈 Dashboard 太复杂，接受简化建议 | UI/UX |
| 2026-07-01 | 当前会话详情默认收起，可展开 | 避免遮挡终端区域 | 主工作台 UI |
| 2026-07-01 | API 配置按工具类型分类，参考 CC Switch | 用户明确要求按不同工具类型分类 | API 配置 UI |
| 2026-07-01 | 创建 GitHub 仓库并推送项目 | 用户明确要求 | 项目交付准备 |
| 2026-07-02 | Codex 会话也必须隔离 endpoint，Renderer/IPC 不得返回完整 secret 或完整 env | 用户确认 Phase 1 执行前补充安全约束 | 启动环境生成、IPC 契约、Renderer、测试验收 |
| 2026-07-04 | 新保存 API Key 使用本机加密 `secrets.vault.json`，不再直接写 macOS Keychain | 避免本地/ad-hoc App 反复触发系统 Keychain 密码弹窗；仍保持不明文落盘和 IPC 不泄露 secret | 密钥存储、API 配置 UI、Session 启动、文档 |
| 2026-07-04 | API Key 允许用户在界面主动查看（类似 ccswitch），本地加密保存、不外发即可，vault 强度不追求防本机攻击者 | 用户在代码审查反馈中明确：工具定位需要方便查看已存 Key，不需要过严的加密要求 | 密钥展示 UI、安全约束表述、后续审查基线 |
| 2026-07-04 | 危险权限标志（skip-permissions/bypass-approvals）默认开启属产品预期 | 用户确认这是有意设计，高级设置中可关闭即可，不作为缺陷处理 | 启动命令、API 配置 UI、审查基线 |
| 2026-07-04 | Gemini/OpenCode 配置入口暂时隐藏 | 启动环境尚未实现（不注入凭证），避免半成品入口误导用户 | API 配置 UI |
| 2026-07-04 | `node-pty` 移入 dependencies，`keytar` 保留在 optionalDependencies | node-pty 是核心依赖，安装失败应立即暴露；keytar 仅作 legacy 迁移回退，缺失可降级 | 依赖管理、打包 |
| 2026-07-04 | 会话 ID 注入每窗口唯一前缀（`session-w<windowId>-<n>`），CLI 进程退出后标记 exited 并在终端提示 | 修复多窗口下共享上下文 transcript 互相覆盖、以及 CLI 退出后会话假活的两个审查高优先级问题 | SessionService、窗口注册、workspace 上下文、终端 UX |
| 2026-07-05 | macOS 打包使用本机自签名证书 `AgentDock Codesign`（脚本自动检测），不再 ad-hoc | ad-hoc 每次打包 cdhash 变化，TCC 反复弹桌面/文稿权限窗；稳定签名让授权持续有效 | 打包脚本、真机权限体验 |
| 2026-07-05 | vault 密钥材料升级 v2：仅由固定字面量+用户名+home 目录组成，不再混入 hostname 和 vault 目录字符串；读取旧记录时自动用 legacy 材料解密并重加密回写（自愈） | hostname 随网络漂移（`设备名.local` ↔ 纯 IP）导致已存 Key 解不开（真机故障复盘：9 条记录分属两个历史 hostname）；vault 定位是本地混淆不追求防本机攻击者，稳定性优先 | 密钥存储、Session 启动可靠性 |
| 2026-07-10 | 当前 macOS 本地打包继续使用 `@electron/packager` 的时间戳目录方案，构建信息的 dirty 状态覆盖整个 Git 工作区 | 现有路线已能稳定打出本机 arm64 包；发布候选必须能识别测试、文档、配置和未跟踪文件造成的不可复现状态 | 打包脚本、发布基线、构建追溯 |
| 2026-07-11 | Claude compat proxy 仅允许作为 loopback、单 Session、Profile 显式开启的协议兼容适配器，不扩展自动路由、fallback、请求正文日志或 Gateway Dashboard | 明确区分当前必要的 Anthropic 协议改写与已拒绝的通用 API gateway，防止后续产品边界漂移 | compat proxy、Profile 配置、后续功能评审 |
| 2026-07-12 | `newapi + gpt-5.6-sol` 的 Codex 完整工具能力采用内部模型别名 + loopback 单字段 `model` 重写；Responses/SSE 其余内容原样透传 | 前置真实探针证明真实模型 ID会触发不兼容的 `input.additional_tools`，未知别名可生成标准顶层 tools；2026-07-13 生产 SessionService + node-pty 真机验证已完成 `pwd` / `uname -a` 工具闭环 | Codex Profile 运行模式、SessionService、受限适配器、真实工具验收 |
| 2026-07-12 | 恢复 Codex/Claude 用户可见运行模式选择，并禁止恢复正文通过 CLI argv 传递 | 自动命令选择隐藏了实际运行能力；进程检查证明 argv 可能暴露恢复正文 | CommandBar、Session metadata、恢复注入、安全验证 |
| 2026-07-13 | Codex 兼容模式使用单 Session 临时运行时 `CODEX_HOME`；原生模式继续使用每 Profile 独立目录 | 同一 Profile 的并发兼容 Session 若共享配置目录会互相覆盖 loopback/模型运行配置；临时目录还能随 Session 生命周期清理 | SessionService、Codex 配置生成、并发隔离、清理与安全验收 |
| 2026-07-13 | Codex 功能回滚采用用户显式选择“原生 Codex · Responses”，不做自动 fallback | 自动切换会隐藏真实失败、改变历史 Session 网络行为并越过“非 API gateway”产品边界；旧 Profile/Session 缺字段时固定原生模式 | Profile 默认值、启动/恢复行为、错误展示、回滚说明 |
| 2026-07-16 | v0.1.1 采用 macOS arm64 + Windows x64 便携 ZIP 双平台 Pre-release；Windows 不引入安装器依赖或签名 | 用户要求两个平台都上传且越简单越好；新 tag 保证新包不混入旧 v0.1.0 commit | 版本、打包、README、GitHub Release |

## 已拒绝/避免方向

| 日期 | 建议 | 拒绝原因 | 后续处理 |
|------|------|----------|----------|
| 2026-07-01 | 做成复杂 API 网关 Dashboard | 用户觉得界面复杂，核心需求是终端工作台 | Dashboard/统计后置 |
| 2026-07-01 | 默认外部终端平铺 | 窗口太多、管理混乱 | 改为内嵌终端标签页 |
| 2026-07-01 | 全局切换 provider | 会影响并发会话 | 每个 PTY session 独立注入配置 |

## 待确认决策

当前无阻塞开发的待确认架构决策。正式发行前仍需单独决定 Developer ID、notarization、Windows 安装器/签名和自动更新方案。

## 2026-07-19 Grok Build CLI

| 日期 | 决策 | 原因 | 影响范围 |
|------|------|------|----------|
| 2026-07-19 | 将本机 Grok Build TUI（`grok`）作为与 Claude/Codex 同级的正式工具类型 | 用户需要在 AgentDock 内并发管理 Grok 配置与终端会话 | ToolType、API 配置、启动环境、会话恢复/摘要 |
| 2026-07-19 | 每 Profile 独立 `GROK_HOME`，OAuth 也独立登录，不共用本机 `~/.grok` | 对齐 Codex 隔离模型，避免多配置互相污染 | launchEnvironment、grokHomePrep |
| 2026-07-19 | 同时支持 API Key（`XAI_API_KEY`）与 OAuth；Key 模式启动前停用冲突的 `auth.json` | Grok session token 优先于 API Key，否则 Key 模式会被登录态覆盖 | grokHomePrep、认证 UX |
| 2026-07-19 | 默认启动命令为 `grok --no-alt-screen`，不默认自动批准工具 | 嵌入 xterm 需避免 alt-screen；权限在 Grok TUI 内处理 | CommandBar / defaultCommandFor |
| 2026-07-19 | 不做 Grok gateway / 自动路由 / 把 Grok 伪装成 Codex | 保持终端优先产品边界 | 架构边界 |

## 2026-07-19 发布 v0.1.2

| 日期 | 决策 | 原因 | 影响范围 |
|------|------|------|----------|
| 2026-07-19 | 发布 AgentDock v0.1.2 双平台 Pre-release | 包含 Grok Build CLI 一等公民接入 | 版本号、Release、README 校验和 |

## 2026-07-19 更新检查修复与 v0.1.3

| 日期 | 决策 | 原因 | 影响范围 |
|------|------|------|----------|
| 2026-07-19 | 更新检查改用 `releases.atom`，纳入 pre-release | `/releases/latest` 会忽略 pre-release，导致 v0.1.2 无法被发现 | updateCheckService、发布策略 |
| 2026-07-19 | 发布 v0.1.3 正式/可发现版本承载更新检查修复 | 旧客户端只有发现比当前更新的版本才会去下载 | Release、README |
