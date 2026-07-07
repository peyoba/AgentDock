# Batch 5 只读项目文件树验证

## 结论

PASS。

## 范围

- 新增 `workspaceFiles:listDirectory` IPC，仅按 workspace id 和相对路径读取目录 metadata。
- 新增只读项目面板文件树，展示文件/目录、git 状态、本会话期间变化标记。
- 新增 `session-file-index/<session-id>.json` 文件索引 store，不保存源码正文或完整 diff。
- 右侧下方信息区包含 `选中文件`、`当前会话`、`恢复摘要` 折叠段，默认只展开 `选中文件`。
- 文件树下方横向分隔条支持鼠标拖动调整信息区高度。

## 安全边界

- Renderer 只拿到 workspace 相对路径、条目类型、git 状态、变化标记和 diff stat 数字。
- 文件树 service 使用 `realpath` 校验目标路径和符号链接，逃逸 workspace 时拒绝。
- IPC 不返回文件正文、完整 diff、完整 restore context、完整环境变量或 API Key。
- 删除 Session Record 的语义未在本批次改变，不删除 workspace 项目文件。

## RED/GREEN

- `tests/app/workspaceFileTreeService.test.ts`：实现前模块缺失；实现后覆盖 workspace 逃逸拒绝、文件正文不返回、git 状态和本会话变化标记分离。
- `tests/app/sessionFileIndexStore.test.ts`：实现前模块缺失；实现后覆盖文件索引落盘、源码正文不持久化、缺失会话返回空索引。
- `tests/app/preloadTypes.test.ts`：实现前 `listWorkspaceDirectory` 未进入 API 白名单；实现后通过。
- `tests/app/App.test.tsx -t "read-only project file tree"`：实现前右侧仅 placeholder，无 tree；实现后通过。

## 验证命令

- `npx vitest run tests/app/workspaceFileTreeService.test.ts tests/app/sessionFileIndexStore.test.ts tests/app/preloadTypes.test.ts tests/app/App.test.tsx -t "read-only project file tree|preloadTypes|workspaceFileTreeService|sessionFileIndexStore"`
  - PASS：4 files / 8 tests passed。
- `npx vitest run tests/app/App.test.tsx`
  - PASS：1 file / 69 tests passed。
- `npm run workflow:doctor`
  - PASS。
- `npm run test:workflow`
  - PASS：8 passed。
- `npm test`
  - PASS：46 files / 293 tests passed。
- `npm run typecheck`
  - PASS。
- `npm run build`
  - PASS；仅 Vite chunk size warning。
- `git diff --check`
  - PASS：无输出。
- secret-like scan：`rg -n "sk-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|BEGIN (RSA|OPENSSH|PRIVATE) KEY" src tests docs .agent-workflow || true`
  - PASS：无命中。

## 未验证项

- 本批次未启动 Electron 窗口做人工拖拽视觉验收；最终交付前统一做终端列宽和右侧项目面板手动/自动验证。
- `在 Finder 中显示` 未接入 IPC，当前只提供真实可用的复制路径动作，避免假按钮。
