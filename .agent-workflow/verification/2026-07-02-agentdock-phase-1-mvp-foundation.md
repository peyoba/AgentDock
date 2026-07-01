# AgentDock Phase 1 MVP Foundation Verification

## 结论

AgentDock Phase 1 MVP Foundation 已完成计划内基础层任务，并通过当前阶段验证。

## 已完成范围

- 应用测试框架：Vitest / jsdom / React Testing Library。
- 共享领域类型：Profile / Workspace / Session / LaunchRequest。
- 密钥脱敏与环境变量预览。
- Claude / Codex 启动环境生成；Codex endpoint 使用 `OPENAI_BASE_URL` 隔离。
- Keychain / PTY adapter contracts；Phase 1 使用 fail-fast unavailable adapter。
- Profile / Workspace metadata stores；Profile store 会剥离误传 secret/env 字段。
- preload IPC 类型与方法白名单；不暴露完整 secret/env 读取方法。
- 终端优先 Renderer 组件拆分。
- 当前会话详情默认收起。
- API 配置按工具类型分组。
- 主进程内存 session orchestration。

## 验证命令

```bash
npm run workflow:doctor
npm run test:workflow
npm run test
npm run build
python3 <key-like-secret-scan>
```

## 验证结果

- `npm run workflow:doctor`：PASS。
- `npm run test:workflow`：PASS，8 passed。
- `npm run test`：PASS，8 test files / 15 tests。
- `npm run build`：PASS。
- key-like secret scan：未发现真实 API Key；命中项仅为历史需求/mockup 占位符或脱敏说明。

## L3 风险说明

本阶段建立了安全边界和测试基础，但仍未进入真实高风险集成：

- 未接入真实 `node-pty`。
- 未读写真实 macOS Keychain。
- 未启动真实 Claude / Codex PTY 会话。
- 未验证 Ctrl+C、resize、粘贴、中文输入等真实终端行为。

这些内容应进入 Phase 2，并在开始前按暂停规则请求用户确认。

