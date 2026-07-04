# AgentDock 当前项目记录

更新时间：2026-07-04

## 当前状态

AgentDock 已完成 Claude/Codex 多配置内嵌终端工作台的主要 MVP 能力，并完成本轮 AnyRouter Claude 配置与打包验证。

最新可试用包：

```text
/private/tmp/agentdock-package-20260704-000803/AgentDock-darwin-arm64/AgentDock.app
```

该包打到新的临时目录，不覆盖 `release/`，也不覆盖当前运行窗口。

## 本轮关键修复

1. Claude / AnyRouter 高级配置
   - `CLAUDE_CODE_RETRY_WATCHDOG=1` 和 `CLAUDE_CODE_MAX_RETRIES=100` 已作为 Claude 可选配置支持。
   - `ANTHROPIC_BETAS=context-1m-2025-08-07` 保留为 1m 上下文配置。
   - `HTTP_PROXY` / `HTTPS_PROXY` 会校验为合法 `http://` 或 `https://` URL；错误值不会再注入 Claude 进程。

2. Claude 模型选择
   - `opus[1m]` 不再作为模型 ID、默认模型或常用模型写入。
   - 历史配置里已保存的 `opus[1m]` 会在读取时自动迁移到真实可选的 `claude-opus-*` 模型。
   - 1m 能力只通过 `ANTHROPIC_BETAS` 表达。

3. macOS Desktop 权限弹窗
   - 生产源码不再硬编码 `/Users/peyoba/Desktop/...` 默认工作区。
   - 默认工作区为空，用户需要显式选择目录。
   - 对 `~/Desktop` / `~/Documents` / `~/Downloads` 下的工作区不再做额外 `fs.existsSync` 预检查，减少 AgentDock 自己触发权限弹窗。
   - 如果实际启动的工作区仍在 `~/Desktop/...`，Claude/Codex 访问项目文件时 macOS 仍可能弹系统权限，这是 TCC 系统策略。

4. API 配置 UI
   - Claude 高级配置已分组为启动参数、网络与请求、本地配置，减少界面混乱。
   - API Key 默认不读取、不显示；用户点击显示时才按需读取当前配置的明文 Key。

## 验证结果

最新一轮验证：

```text
npm run test              PASS: 26 files / 131 tests
npm run workflow:doctor   PASS
npm run test:workflow     PASS: 8 passed
npm run typecheck         PASS
npm run build             PASS, with existing Vite chunk-size warning
git diff --check          PASS
key-like secret scan      PASS
codesign verify           PASS
```

成品验证：

- 新包路径：`/private/tmp/agentdock-package-20260704-000803/AgentDock-darwin-arm64/AgentDock.app`
- 成品不含 `defaultModel: "opus[1m]"` 或 `model: "opus[1m]"`。
- 成品 key-like secret scan 无命中。
- `node-pty` / `keytar` native 文件在 `app.asar.unpacked` 中。

## 当前注意点

- 当前仓库工作区有大量未提交改动，包含多轮 Claude/Codex 协作结果；不要执行 `git reset --hard` 或回退不属于当前任务的文件。
- 若用户继续从 `/private/tmp/agentdock-package-*` 运行新包，macOS 可能把每个新路径视为不同 app，再次触发权限确认。
- 要彻底减少 Desktop 权限弹窗，建议把项目目录迁移到 `~/Developer` 或 `~/Projects`，或者使用固定路径的签名 app 并在系统设置中授权。

## 后续建议

1. 为 protected folders 增加应用内提示：选择 `Desktop/Documents/Downloads` 工作区时提示 macOS 权限风险。
2. 后续打包若要给日常使用，应输出到固定目录，减少 macOS 对临时路径 app 的重复权限提示。
3. 继续收敛打包规则，避免把 `.pytest_cache`、测试缓存或开发文档打入成品包。
