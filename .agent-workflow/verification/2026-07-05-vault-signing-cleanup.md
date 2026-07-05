# 真实验证记录

## 验证对象
AgentDock vault v2 稳定密钥材料、macOS 稳定签名包、标签自绘 tooltip、项目清理第一阶段。

## 验证环境
本地 macOS，仓库路径 `/Users/peyoba/Desktop/web/AgentDock`。

## 使用的真实依赖
- 本机加密 vault：`~/Library/Application Support/AgentDock/secrets.vault.json`
- 本机代码签名身份：`AgentDock Codesign`
- 打包产物：`release/packages/20260705-020727/AgentDock-darwin-arm64/AgentDock.app`
- GitHub 远端：`https://github.com/peyoba/AgentDock.git`

## 验证步骤
1. 复核 workflow、测试、类型检查和构建。
2. 复核最新打包产物签名有效。
3. 扫描 app.asar，确认包内包含 vault v2 和 custom tooltip 代码 marker。
4. 确认本地 `main` 已推送到 `origin/main`。

## 证据门
| 检查项 | 命令或证据 | 结果 |
|--------|------------|------|
| Workflow doctor | `npm run workflow:doctor` | PASS |
| Workflow tests | `npm run test:workflow` | PASS：8 passed |
| App tests | `npm test` | PASS：30 files / 180 tests |
| Typecheck | `npm run typecheck` | PASS |
| Build | `npm run build` | PASS：仅 Vite chunk size warning |
| Package signature | `codesign --verify --deep --strict --verbose=2 release/packages/20260705-020727/AgentDock-darwin-arm64/AgentDock.app` | PASS |
| Package content | `grep -a 'AgentDock local encrypted vault v2' .../app.asar`、`grep -a 'tab-tooltip' .../app.asar` | PASS：两个 marker 均存在 |
| Git remote | `git push`、`git status --short --branch` | PASS：`main -> origin/main`，交付收尾后本地与远端同步 |

## 实际结果
- 本地 vault 记录已在前序步骤迁移到 v2，旧文件已备份为 `secrets.vault.json.bak-20260705`。
- 新包已使用稳定签名，不再是 ad-hoc 签名；`codesign --verify` 通过。
- 新包包含 vault v2 和 custom tooltip 实现。
- 两个此前未推送提交已成功推送；本报告和 workflow 文档作为收尾提交一起推送。

## 未验证项
- 未在 UI 中替用户点击启动此前报错的 Profile；该步骤会启动真实 Agent CLI 会话，需用户在当前运行的新包中确认。
- 未重复验证 macOS TCC 第二次启动不弹窗；首次使用新签名包仍可能需要授权一次，后续稳定性需要连续打包/启动观察。

## 结论
PASS，有条件交付：代码、构建、包签名和远端同步已验证；最终用户可见的 Profile 启动 smoke 需用户在新包里确认。

## 发现的问题
无新的代码问题。文档层发现 `docs/requirements/05-UI效果图.md` 仍引用已删除 mockup 图片，已改为文字说明。

## 后续动作
进入 `delivery_hook`；等待用户用当前新包执行 Profile 启动 smoke。
