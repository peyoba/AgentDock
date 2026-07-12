# AgentDock 主工作台交互优化实施计划

## 风险等级

L3。原因：改动会话恢复策略、PTY 重启行为和多窗口工作台交互，需要真实 Electron 验证。

## Task 1：RED 测试

- 更新 Renderer 测试，锁定唯一启动入口、明确会话动作、停止态恢复条和面板互斥。
- 更新 SessionService 测试，锁定 `resume` 与 `fresh` 两种重启策略。
- 增加左右分隔条拖动、键盘和双击复位测试。
- 运行聚焦测试并确认失败原因是功能尚未实现。

## Task 2：会话动作 GREEN

- 为 Restart 请求增加显式策略。
- 让 `resume` 保留原生恢复与 AgentDock fallback。
- 让 `fresh` 跳过全部恢复逻辑。
- 简化主工作台按钮和菜单文案。
- 将 `stopped` 纳入恢复操作条。

## Task 3：面板布局 GREEN

- 增加左侧会话库宽度状态和分隔条。
- 完善右侧项目面板分隔条。
- 统一宽度边界和默认值。
- 实现键盘、Pointer Events、双击复位。
- 让会话详情和项目面板互斥展开。

## Task 4：验收与质量

- 对照 SPEC 逐条验收。
- 检查命名、职责、重复逻辑、可访问性和未使用代码。
- 检查现有未提交稳定性修复未被覆盖。

## Task 5：集成与真实验证

- 聚焦 Vitest。
- 全量 Vitest。
- `npm run test:workflow`。
- `npm run workflow:doctor`。
- `npm run typecheck`。
- `npm run build`。
- `git diff --check`。
- 打包并实际操作 Electron：启动、停止、继续、重新开始、左右拖拽、键盘调整、双击复位。
