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
| 2026-07-01 | Keychain 库 | keytar / macOS security CLI wrapper / native addon | 实现 Keychain adapter 前 |
| 2026-07-01 | node-pty 兼容策略 | 直接依赖 node-pty / 自建 PTY adapter interface | 实现真实终端前 |
