# Claude Code 项目上下文 (CLAUDE.md)

**项目**: AgentDock 代理坞
**生成时间**: 2026-07-03 19:15
**当前版本**: Phase 2 完成
**项目状态**: MVP 产品化阶段，准备后续迭代

---

## 📋 项目核心信息

### 产品定义
- **名称**: AgentDock 代理坞
- **类型**: Desktop App (Electron) - 多配置内嵌终端工作台
- **目标用户**: Claude CLI / Codex CLI 用户
- **核心功能**: 在一个窗口中同时运行多个独立的 Claude/Codex 终端会话

### 技术栈
| 组件 | 选型 | 原因 |
|------|------|------|
| 框架 | Electron 37.2.0 | 桌面应用，支持自定义终端 |
| UI | React 19.1.0 + TypeScript 5.8.3 | 类型安全，快速迭代 |
| 终端 | xterm.js 5.5.0 + node-pty 1.0.0 | 成熟的内嵌终端方案 |
| 构建 | Vite 7.0.0 | 快速开发、优化打包 |
| 测试 | Vitest 4.1.9 | 轻量级测试框架 |
| 秘密管理 | 本机加密 vault + keytar optional | 主流程使用本机加密 vault，keytar 保留为兼容 adapter |

### 项目结构
```
AgentDock/
├── src/
│   ├── main/           # Electron main process
│   │   ├── adapters/   # Keychain、PTY、Store adapters
│   │   ├── services/   # SessionService、WorkspaceService
│   │   └── stores/     # ProfileStore、WorkspaceStore
│   ├── preload/        # IPC 安全通道
│   ├── renderer/       # React UI
│   └── shared/         # 共享类型和工具函数
├── tests/              # Vitest 单元测试
├── docs/
│   ├── requirements/   # 需求文档
│   ├── plans/          # 阶段计划
│   ├── reports/        # 开发报告
│   └── assets/         # UI 参考和原型
├── .agent-workflow/    # Agent workflow 配置
└── package.json        # 依赖和脚本
```

---

## 🎯 当前阶段进度

### ✅ Phase 1: MVP 基础（已完成）
- 测试框架和类型系统
- Keychain/PTY adapter contracts
- Profile 和 Workspace 数据模型
- 终端优先的 Renderer UI
- 基础 session orchestration

### ✅ Phase 2: 真实集成（已完成）
- 真实 `keytar` Keychain 集成
- 真实 `node-pty` PTY 启动
- Renderer launch flow 接入
- Session launch failure safety
- macOS 打包和签名
- API 配置编辑
- 本地加密 secret vault

### 🚧 Phase 3: 后续迭代（待规划）
- 高级功能（日志、成本统计）
- 跨平台支持（Windows/Linux）
- 性能优化
- 完整的真实 API key 验证

---

## 📚 核心文档速查

| 文档 | 路径 | 用途 |
|------|------|------|
| **项目需求** | `docs/PROJECT_REQUIREMENTS.md` | 产品定义、功能清单、UI 要求 |
| **项目配置** | `PROJECT_PROFILE.md` | 技术栈、命令、环境变量 |
| **架构决策** | `DECISIONS.md` | 已确认决策、已拒绝建议 |
| **快速开始** | `QUICKSTART.md` | 初次开发环境搭建 |
| **Agent 开发** | `AGENTS.md` | 开发代理必读 |
| **工作流** | `.agent-workflow/WORKFLOW.md` | 9+1 角色任务分级协议 |
| **当前状态** | `.agent-workflow/state.md` | 项目进度、验证记录 |

---

## 🚀 立即可执行的命令

```bash
# 开发
npm install              # 安装依赖
npm run dev             # 启动开发环境（Vite + Electron）
npm run typecheck       # TypeScript 类型检查
npm run build           # 生产构建

# 测试
npm test                # 运行单元测试
npm run test:watch      # 监听模式

# 工作流
npm run workflow:doctor # 检查工作流配置
npm run test:workflow   # 运行工作流 CLI 测试

# 打包
npm run package:mac     # 打包 macOS app
```

---

## ⚠️ 项目约束（必读）

### 安全约束
1. **API Key 绝不明文落盘**: 只保存到本机加密 vault 或兼容的 macOS Keychain adapter
2. **IPC 安全**: 完整 secret 仅在用户主动点击“显示”时按需返回，用于本人查看；不主动广播或默认返回 secret、env 对象
3. **环境变量隔离**: 每个 PTY session 独立注入 endpoint/key，避免 CLI 冲突

### 功能约束
1. **终端优先**: 主界面简洁，API 配置必须独立页面
2. **不做全局切换**: 不修改已运行的其他终端会话
3. **Codex 隔离**: 每个 Codex Profile 使用独立 `CODEX_HOME`

### 代码约束
1. **类型安全**: 所有代码必须通过 `npm run typecheck`
2. **测试覆盖**: 关键路径必须有单元测试
3. **脱敏返回**: renderer/IPC 默认返回数据必须脱敏；只有用户显式点击显示 API Key 时才按需读取明文

---

## 🔍 最近改进（2026-07-04）

### 代码审查修复（全项目审查后的批量落地）
- ✅ 高优先级：PTY 进程退出感知（session 标记 `exited` + 终端内提示，退出后标签页仍可关闭）
- ✅ 高优先级：跨窗口 session ID 冲突（每窗口注入 `w<windowId>-` 前缀，共享上下文 transcript 不再互相覆盖）
- ✅ Agent CLI PATH 同步（用户级 `~/.local/bin` 等优先 + login shell 内重新 export PATH）
- ✅ keytar→vault 迁移接线、孤儿密钥清理、profile ID 校验
- ✅ 共享上下文节流重建 + 每 workspace 串行写队列；终端缓冲回放竞态修复
- ✅ 低优先级批量：Gemini/OpenCode 半成品入口隐藏、短密钥全遮蔽、死代码清理（redactEnvironmentPreview/migrateAll）、node-pty 移入 dependencies、模型拉取超时 + baseUrl 中文报错

### 产品决策（用户确认）
- 🔓 API Key 允许界面主动查看（类似 ccswitch）：本地加密保存、不外发即可，不追求防本机攻击者
- ⚙️ 危险权限标志默认开启是有意设计，高级设置可关，不作为缺陷处理

### 项目清理分析
- 📄 清理分析报告：`docs/reports/2026-07-03-project-cleanup-analysis.md`
- ✅ 第一阶段已执行（2026-07-05）：删除 Agent.md、BOOTSTRAP_CHECKLIST.md、EMERGENCY_FIX.md、INSTALL_SUPERPOWERS.md 及 `docs/assets/mockups/` 全部原型，并清理保留文档中的悬空引用
- ⏸️ 第二阶段说明：`.agent-workflow/` 仍被 `workflow.py`、workflow 测试和本文档引用，**保留不删**（报告中"已不参与日常开发"的前提已过时）；`docs/requirements/` 暂保留，待用户决定归档或删除

---

## 🎬 后续开发建议

### 立即可做
1. ✅ **文件清理** - 执行第一阶段清理（删除过时文件）
2. ✅ **代码继续开发** - 任何新功能、bug 修复、UI 优化
3. ✅ **文档维护** - 同步 DECISIONS.md、PROJECT_PROFILE.md

### 需真机验证
1. ⚠️ 真实 Claude/Codex 账号启动（用户确认时执行）
2. ⚠️ 中文输入和特殊键位处理
3. ⚠️ 长时间运行稳定性

### 长期规划
1. 🔮 性能优化（减少打包体积）
2. 🔮 跨平台支持（Windows/Linux）
3. 🔮 高级功能（成本统计、日志导出等）

---

## 📊 项目健康指标

```
构建状态        ✅ 通过 (npm run build)
测试状态        ✅ 通过 (30 files / 177 tests)
类型检查        ✅ 通过 (npm run typecheck)
安全扫描        ✅ 通过 (无真实 API key 发现)
打包验证        ✅ 通过 (macOS self-signed with AgentDock Codesign)
```

---

## 🔗 Git 信息

- **主分支**: `main`
- **当前状态**: 2026-07-04 审查修复批次已提交（滚动条 macOS 化、会话详情/标签提示、PATH 同步、稳定性加固、session 生命周期修复），待推送远端
- **仓库**: https://github.com/peyoba/AgentDock (私有)

---

## 📞 帮助资源

- **快速问题**: 查看 `PROJECT_PROFILE.md` 的常用命令
- **工作流问题**: 读取 `.agent-workflow/WORKFLOW.md` 了解 Agent 分级规则
- **需求澄清**: 参考 `docs/PROJECT_REQUIREMENTS.md`
- **架构问题**: 查看 `DECISIONS.md` 和 `.agent-workflow/specs/`
- **测试框架**: 参考 `tests/` 目录中的现有测试

---

## 📝 更新日志

| 日期 | 类型 | 内容 |
|------|------|------|
| 2026-07-09 | 修复 | 全面代码审查修复两批（09a0db2、1fd17d8）：历史写入性能放大+transcript 滚动截断、session ID 复用、compat proxy 流式转发/关闭阻塞、JSON 原子写+损坏兜底、历史 transcript 密钥脱敏、退出可靠落盘、ApiConfigPanel 修复、IPC 纵深防御、workspace 上下文容量控制、renderer 批量修复 |
| 2026-07-06 | 修复 | 复制粘贴补全：Edit 菜单加全选（Cmd+A）、输入框/选中文本右键编辑菜单、终端右键"有选中复制、无选中粘贴" |
| 2026-07-05 | 修复 | vault 密钥材料 v2（去除 hostname/目录依赖 + legacy 自愈），9 条已存记录已迁移；标签悬停 0.3s 自定义 tooltip；打包排除本地工具文件；出厂配置去除本机代理 |
| 2026-07-05 | 构建 | 打包改用本机自签名证书 `AgentDock Codesign`（解决 TCC 权限反复弹窗）；GitHub 直连失败时用 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` |
| 2026-07-05 | 清理 | 执行清理报告第一阶段：删除 4 个过时根文档 + mockups 原型 19 个文件，清理悬空引用；`.agent-workflow/` 确认保留 |
| 2026-07-04 | 修复 | 全项目审查修复批次：PTY 退出感知、跨窗口 session ID、PATH 同步、密钥迁移接线、上下文节流、低优先级批量 |
| 2026-07-04 | 优化 | 终端滚动条 macOS 悬浮化；会话详情显示 API 配置名；标签悬停显示全名 |
| 2026-07-04 | 决策 | API Key 界面可见（本地保存不外发）；危险权限标志默认开启为预期设计 |
| 2026-07-03 | 文档 | 创建 CLAUDE.md 项目上下文文档 |
| 2026-07-03 | 分析 | 完成代码审查和项目清理分析 |
| 2026-07-03 | 验收 | Phase 2 所有功能已验证完成 |
| 2026-07-02 | 优化 | 终端滚动条和历史保留优化 |
| 2026-07-02 | 功能 | 本地加密 secret vault 集成 |

---

**下一步**: 用 2026-07-05 新包做真机 smoke（vault 修复后 profile 启动、悬停 tooltip、TCC 一次性授权、多窗口同工作区、CLI 退出提示），并决定 `docs/requirements/` 归档或保留（清理第二阶段）。

Happy coding! 🚀
