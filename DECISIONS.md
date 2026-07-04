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

## 已拒绝/避免方向

| 日期 | 建议 | 拒绝原因 | 后续处理 |
|------|------|----------|----------|
| 2026-07-01 | 做成复杂 API 网关 Dashboard | 用户觉得界面复杂，核心需求是终端工作台 | Dashboard/统计后置 |
| 2026-07-01 | 默认外部终端平铺 | 窗口太多、管理混乱 | 改为内嵌终端标签页 |
| 2026-07-01 | 全局切换 provider | 会影响并发会话 | 每个 PTY session 独立注入配置 |

## 待确认决策

| 日期 | 问题 | 选项 | 截止点 |
|------|------|------|--------|
| 2026-07-01 | 打包工具 | electron-builder / electron-forge | MVP 可运行后 |
| 2026-07-01 | Keychain 库 | keytar / macOS security CLI wrapper / native addon | 已后置为 legacy adapter；新保存 key 使用本机加密 vault |
| 2026-07-01 | node-pty 兼容策略 | 直接依赖 node-pty / 自建 PTY adapter interface | 实现真实终端前 |
