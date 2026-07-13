# AgentDock 阶段总结与交接（2026-07-12）

## 1. 文档目的

本文档用于冻结 2026-07-12 当前开发现场，供下一次会话直接续接。当前阶段重点完成了共享上下文阅读体验、会话记忆恢复、GitHub Release 更新提醒，以及对应的 macOS 本机验证包。

当前结论：**主要功能已在真机正常运行，但工作区仍有未提交修改，完整测试套件尚未全部恢复绿色，因此本批次属于“有条件交接”，不是 clean 发布候选。**

## 2. 当前产品状态

- AgentDock 仍定位为 Claude/Codex 多配置内嵌终端工作台。
- API Profile、Workspace、Session、PTY、Vault 和共享上下文主链路保持可用。
- 当前应用版本仍为 `0.1.0`。
- 当前公开更新源：<https://github.com/peyoba/AgentDock-Releases>。
- 当前公开 latest Release：<https://github.com/peyoba/AgentDock-Releases/releases/tag/v0.1.0>。
- 当前最终本机验证包：
  `release/packages/20260712-141512/AgentDock-darwin-arm64/AgentDock.app`。
- 该包基于 dirty 工作区构建，仅用于本机验证，不应作为 clean Release 直接发布。

## 3. 本阶段完成内容

### 3.1 共享上下文阅读弹窗

将会话详情窄栏中的 Markdown 原文预览替换为独立 Portal 弹窗：

- 支持标题、段落、列表和代码块的受限 Markdown 展示。
- 支持搜索过滤、刷新、复制全文和在 Finder 中打开目录。
- 支持关闭按钮、`Escape` 和点击遮罩关闭。
- 弹窗独立滚动，不再挤占终端宽度。
- 保留会话切换、Workspace 切换和抽屉关闭后的旧异步请求失效保护。

主要文件：

- `src/renderer/components/WorkspaceContextDialog.tsx`
- `src/renderer/components/SessionDetailsDrawer.tsx`
- `src/renderer/styles.css`
- `tests/app/SessionDetailsDrawer.test.tsx`
- `tests/app/App.test.tsx`

### 3.2 会话记忆恢复修复

根因：旧实现只把恢复文件路径放进 Claude/Codex 初始提示，要求外部 CLI 自行读取 `session-*.md`。CLI 不一定调用文件工具，因此会回答“无法访问该文件”，实际没有恢复记忆。

当前实现：

- 恢复文件继续写入 Workspace 的私有目录，作为持久化和追溯副本。
- 已脱敏的恢复正文直接嵌入 Claude/Codex 初始上下文，不再依赖二次读盘。
- 初始提示明确要求只回复一句“记忆已恢复”，等待用户后续指令，不自动继续旧任务。
- 用户真机提问“刚刚在说什么”时，Agent 已能根据之前内容回答。

主要文件：

- `src/main/restoreContextStore.ts`
- `tests/app/restoreContextStore.test.ts`

已知体验问题：恢复正文目前会在终端中完整可见，内容较长。后续可研究在不破坏 Claude/Codex初始上下文注入的前提下，只让终端显示简短恢复状态。

### 3.3 App 更新检查与下载提示

已实现“不自动安装，只检查并提示下载”的轻量更新方案：

- App 启动约 3 秒后自动检查更新。
- 左侧版本号旁有明确的“检查更新”按钮。
- 检查中显示“检查中…”，并阻止重复请求。
- 当前已是最新版时短暂显示状态，5 秒后自动消失。
- 检查失败时显示“检查更新失败”和“重试”，5 秒后自动消失。
- 发现新版本时持续显示“发现 vX.Y.Z · 前往下载”。
- 只允许通过系统浏览器打开 `peyoba/AgentDock-Releases` 下的可信 Release URL。
- 不内置 GitHub Token，不新增第三方依赖，不改变现有打包方式。

最初使用 GitHub REST `releases/latest` API，但真机遇到匿名 IP 限额耗尽（HTTP 403）。现已改为访问公开页面：

```text
https://github.com/peyoba/AgentDock-Releases/releases/latest
```

通过 GitHub 的 302 跳转目标 `/releases/tag/vX.Y.Z` 解析版本，避免 REST API 匿名限流。

主要文件：

- `src/main/updateCheckService.ts`
- `src/main/main.ts`
- `src/preload/preload.cts`
- `src/shared/agentdockTypes.ts`
- `src/shared/preloadTypes.ts`
- `src/renderer/App.tsx`
- `src/renderer/components/SessionLibrary.tsx`
- `src/renderer/styles.css`
- `tests/app/updateCheckService.test.ts`
- `tests/app/preloadTypes.test.ts`
- `tests/app/App.test.tsx`

### 3.4 公开更新仓库

已创建公开的 Release-only 仓库：

```text
https://github.com/peyoba/AgentDock-Releases
```

已正式发布非草稿、非预发布的 `v0.1.0` 基线，`/releases/latest` 可以正常跳转到 `v0.1.0`。

遗留问题：123 MB 的 `AgentDock-v0.1.0-macos-arm64.zip` 多次上传到 `uploads.github.com` 时卡住或返回 404，当前公开 `v0.1.0` Release 页面没有 ZIP 附件。该问题不影响版本检测，但会影响用户从公开更新页直接下载。

## 4. 验证结果

### 4.1 已通过

| 验证 | 结果 |
|------|------|
| 更新服务与 preload 聚焦测试 | PASS：2 files / 5 tests |
| App 单文件测试 | PASS：1 file / 86 tests |
| 共享上下文聚焦测试 | PASS：2 files / 91 tests（实施时记录） |
| 恢复上下文与 Session 启动聚焦测试 | PASS：2 files / 20 tests（实施时记录） |
| `npm run typecheck` | PASS |
| `npm run workflow:doctor` | PASS |
| `npm run build` | PASS |
| 更新检查真实网络 smoke（当前 `0.1.0`） | PASS：返回 `current` |
| 更新检查真实网络 smoke（模拟 `0.0.9`） | PASS：返回 `available`，latest `0.1.0` |
| `npm run package:mac` | PASS |
| 本机签名 | PASS：`AgentDock Codesign` |

### 4.2 未完全通过

完整 `npm test` 曾得到：

```text
57 files
386 tests
6 failed / 380 passed
```

6 条失败均来自旧会话恢复合同，仍断言“恢复提示只能包含短文件路径”，与当前“直接嵌入已脱敏恢复正文”的新行为冲突。涉及：

- `tests/app/sessionService.test.ts`
- `tests/app/sessionSecurity.test.ts`

下一次必须先更新这些旧断言，同时继续保证：

- Session metadata 不返回恢复正文或 instruction。
- Secret 不出现在 metadata、日志或未脱敏恢复材料中。
- Claude 使用 system prompt 注入，Codex 使用 initial prompt 注入。
- 不通过 stdin 重复写入恢复正文。

此外，`tests/app/App.test.tsx` 在与其他测试并行运行时偶发异步加载波动；单文件复跑 86 项通过。后续如果全量仍波动，应检查测试等待条件，避免用固定时序等待。

## 5. 当前工作区状态

当前基线提交为 `6bd7572`，本阶段改动尚未提交或推送。

已知修改/新增范围包括：

- `README.md`
- `src/main/main.ts`
- `src/main/restoreContextStore.ts`
- `src/main/updateCheckService.ts`
- `src/preload/preload.cts`
- `src/renderer/App.tsx`
- `src/renderer/components/SessionDetailsDrawer.tsx`
- `src/renderer/components/SessionLibrary.tsx`
- `src/renderer/components/WorkspaceContextDialog.tsx`
- `src/renderer/styles.css`
- `src/shared/agentdockTypes.ts`
- `src/shared/preloadTypes.ts`
- `tests/app/App.test.tsx`
- `tests/app/SessionDetailsDrawer.test.tsx`
- `tests/app/preloadTypes.test.ts`
- `tests/app/restoreContextStore.test.ts`
- `tests/app/updateCheckService.test.ts`

注意：继续开发前必须重新执行 `git status --short`，确认是否还有本清单之外的用户改动；不得覆盖或回滚未知修改。

## 6. 安全与架构结论

- 更新检查不持有 GitHub Token，不向 Renderer 暴露原始网络响应。
- 更新下载只打开白名单内的 HTTPS GitHub Release 页面。
- 更新检查失败不会影响 PTY、Session、Vault 或 Workspace。
- 恢复正文沿用已有脱敏逻辑后才进入初始上下文。
- 恢复文件继续使用私有目录和私有文件权限。
- 当前仍使用本机自签名 `AgentDock Codesign`，未接入 Developer ID 和 notarization。
- 当前只做更新发现与下载引导，不做自动下载、替换、重启或回滚。

## 7. 下一次会话建议顺序

### 优先级 P0：恢复完整测试绿色

1. 读取本文档和 `.agent-workflow/state.md`。
2. 执行 `git status --short`，确认 dirty 文件。
3. 更新 `tests/app/sessionService.test.ts` 和 `tests/app/sessionSecurity.test.ts` 的旧恢复断言。
4. 执行：

```bash
npm test -- --run tests/app/restoreContextStore.test.ts tests/app/sessionService.test.ts tests/app/sessionSecurity.test.ts
npm test
npm run typecheck
npm run workflow:doctor
npm run build
```

5. 只有全量测试通过后，才准备 clean commit 与发布候选。

### 优先级 P1：补齐公开 Release 下载资产

1. 检查公开 `v0.1.0` 资产列表。
2. 网络稳定时重新上传：

```bash
gh release upload v0.1.0 \
  "release/update-baseline/AgentDock-v0.1.0-macos-arm64.zip" \
  --repo peyoba/AgentDock-Releases \
  --clobber
```

3. 用 `gh release view` 验证资产名称、大小和下载 URL。

### 优先级 P2：准备下一个真实更新版本

1. 全量测试绿色并提交当前工作。
2. 将 `package.json` 版本提升到 `0.1.1` 或 `0.2.0`。
3. 从 clean HEAD 重新打包。
4. 在公开更新仓库创建同版本正式 Release 并上传 ZIP。
5. 用已安装的 `0.1.0` 真机验证“发现新版本 → 前往下载”闭环。

### 可选体验优化

- 避免完整恢复正文在终端可见，只保留绿色“记忆已恢复”状态提示。
- 为共享上下文轻量 Markdown 渲染补充行内代码样式和搜索命中高亮。
- 检查 `App.test.tsx` 并行运行时的异步波动。

## 8. 交接结论

**结论：有条件 PASS。**

用户真机已确认更新检查恢复正常；共享上下文阅读和会话记忆恢复也已实际生效。当前阻塞 clean 交付的事项是：完整测试中的 6 条旧恢复断言尚未同步，以及公开 Release 的 ZIP 附件尚未上传成功。下一次应先恢复全量测试绿色，再处理 clean commit、版本递增和真实跨版本更新验证。
