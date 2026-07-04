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

## 🔍 最近改进（2026-07-03）

### 代码审查发现
- ✅ 高质量的代码结构和测试覆盖
- ⚠️ 权限绕过标志需监控使用场景（`--dangerously-skip-permissions` 等）
- ✅ 国际化支持完善（中文错误消息）

### 项目清理分析
- 📄 已生成清理分析报告：`docs/reports/2026-07-03-project-cleanup-analysis.md`
- 🗑️ 建议删除：4 个过时文档 + 8 个旧 UI 原型 (~500KB)
- 📦 可选归档：`.agent-workflow/` + `docs/requirements/` (~400KB)

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
测试状态        ✅ 通过 (27 files / 135 tests)
类型检查        ✅ 通过 (npm run typecheck)
安全扫描        ✅ 通过 (无真实 API key 发现)
打包验证        ✅ 通过 (macOS ad-hoc signed)
```

---

## 🔗 Git 信息

- **主分支**: `main`
- **当前状态**: 未提交改动已审查；默认模型和内置配置删除保护已修复，仍待用户决定提交或清理
- **最后提交**: `Ship AgentDock packaged app usability fixes`
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
| 2026-07-03 | 文档 | 创建 CLAUDE.md 项目上下文文档 |
| 2026-07-03 | 分析 | 完成代码审查和项目清理分析 |
| 2026-07-03 | 验收 | Phase 2 所有功能已验证完成 |
| 2026-07-02 | 优化 | 终端滚动条和历史保留优化 |
| 2026-07-02 | 功能 | 本地加密 secret vault 集成 |

---

**下一步**: 根据 `docs/reports/2026-07-03-project-cleanup-analysis.md` 的建议执行项目清理，然后开始下一阶段开发。

Happy coding! 🚀
