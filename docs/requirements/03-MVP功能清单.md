# AgentDock MVP 功能清单

> 历史清单（不再作为当前完成状态）：其中外部 Terminal.app/iTerm2、SwiftUI 等早期方向已被 Electron 内嵌 xterm.js + node-pty 路线取代；当前完成状态以 `README.md`、`.agent-workflow/state.md` 和 verification 记录为准。

## 第一阶段：MVP 必须实现

- [ ] Profile 增删改查
- [ ] API key 存本机加密 vault
- [ ] Workspace 增删改查
- [ ] 选择 Profile + Workspace 启动新终端
- [ ] Claude 独立环境变量启动
- [ ] Codex 独立 `CODEX_HOME` 启动
- [ ] 至少支持 Terminal.app 或 iTerm2
- [ ] 会话记录列表
- [ ] 启动前环境预览
- [ ] 同一 Workspace 多会话风险提示

## 第二阶段：增强能力

- [ ] Test Connection
- [ ] 多终端进程状态检测
- [ ] Git worktree 自动创建
- [ ] 终端聚焦 / 停止
- [ ] 使用统计
- [ ] endpoint 健康检查
- [ ] 配置导入 / 导出
- [ ] 支持 Warp / Ghostty

## 第三阶段：高级能力

- [ ] 多 provider fallback
- [ ] API key 轮换
- [ ] 请求日志
- [ ] 模型路由
- [ ] 本地代理模式
- [ ] 和 CCR / ccNexus 集成
- [ ] 团队共享配置，但不共享密钥

## 推荐实现路线

1. macOS SwiftUI App 骨架
2. 本地配置模型：Profile、Workspace、Session
3. 本机加密 vault 密钥保存
4. Terminal.app 启动 Claude
5. 独立 CODEX_HOME 启动 Codex
6. iTerm2 支持
7. 会话列表和环境预览
8. worktree 支持

## MVP 验收标准

用户可以完成以下操作：

```text
1. 新增 Claude Profile A，填写 endpoint A + key A
2. 新增 Claude Profile B，填写 endpoint B + key B
3. 新增 Codex Profile C，填写 endpoint C + key C
4. 新增 Workspace：/Users/peyoba/dev/project-x
5. 同时打开三个终端：
   - Claude A -> project-x
   - Claude B -> project-x
   - Codex C  -> project-x
6. 三个终端互不影响，各自使用自己的 endpoint 和 key
7. 三个终端共享同一个工作目录，App 给出冲突风险提示
```
