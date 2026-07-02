# 真实验证记录

## 验证对象
AgentDock macOS 本地 App 打包产物。

## 验证环境
本机 macOS，Apple Silicon arm64，本地开发仓库 `/Users/peyoba/Desktop/web/AgentDock`。

## 使用的真实依赖
- Electron Packager 本地打包流程
- macOS `codesign` / `spctl`
- 真实 `node-pty` 与 `keytar` 原生模块的包体布局检查
- 未使用真实 API key

## 验证步骤
1. 执行 `npm run package:mac` 生成 `release/AgentDock-darwin-arm64/AgentDock.app`。
2. 检查 `app.asar` 中包含主进程与 renderer 构建产物。
3. 检查 `app.asar.unpacked` 中存在 `node-pty` darwin-arm64 `pty.node`、`spawn-helper` 与 `keytar.node`，且 helper/node 文件具备可执行权限。
4. 执行 `codesign --verify --deep --strict --verbose=2` 验证本地 ad-hoc 签名。
5. 执行自动化回归：`npm run test`、`npm run workflow:doctor`、`npm run test:workflow`、`git diff --check`。

## 证据门
| 检查项 | 命令或证据 | 结果 |
|--------|------------|------|
| 打包 | `npm run package:mac` | PASS：生成 `release/AgentDock-darwin-arm64/AgentDock.app` |
| 构建 | `npm run package:mac` 内部执行 `npm run build` | PASS |
| App 内容 | `asar.listPackage(app.asar)` | PASS：`/dist/main/main.js`、`/dist/renderer/index.html`、`/package.json` 存在 |
| 原生模块 unpack | `ls -l app.asar.unpacked/node_modules/{node-pty,keytar}` | PASS：darwin-arm64 `pty.node`、`spawn-helper`、`keytar.node` 存在；`spawn-helper` 为 executable |
| 本地签名 | `codesign --verify --deep --strict --verbose=2 release/AgentDock-darwin-arm64/AgentDock.app` | PASS：valid on disk，satisfies Designated Requirement |
| Gatekeeper | `spctl --assess --type execute --verbose=4 release/AgentDock-darwin-arm64/AgentDock.app` | EXPECTED REJECT：ad-hoc signed，本地未 notarize |
| 测试 | `npm run test` | PASS：15 files / 30 tests |
| Workflow doctor | `npm run workflow:doctor` | PASS |
| Workflow tests | `npm run test:workflow` | PASS：8 passed |
| Whitespace | `git diff --check` | PASS |

## 实际结果
本地 macOS App 包已生成并通过包体、原生模块 unpack、ad-hoc 签名与自动化回归检查。产物路径：`/Users/peyoba/Desktop/web/AgentDock/release/AgentDock-darwin-arm64/AgentDock.app`。

## 未验证项
- 未做人工 UI 冒烟验证；原因：用户要求先打包，由用户使用成品 App 测试。
- 未做真实 API key / Claude / Codex 账号调用；原因：用户明确要求不要使用真实 API key。
- 未做 Developer ID 签名与 notarization；当前产物仅用于本机手工测试，不是正式分发包。

## 结论
PASS

## 发现的问题
- 初次检查发现 Electron Packager 产物需要本地重新签名，否则 `codesign --verify` 报 `code has no resources but signature indicates they must be present`；已在 `package:mac` 追加 ad-hoc `codesign --force --deep --sign -`。
- `node-pty` 的 `spawn-helper` 需要随 `.node` 一起 unpack，并在运行时将 `app.asar` 路径映射到 `app.asar.unpacked`；已覆盖并验证。

## 后续动作
- 由用户双击/打开本地 App 进行人工 UI 与终端行为验证。
- 若需要发给其他机器或规避 Gatekeeper 拦截，后续进入 Developer ID 签名与 notarization 流程。

## 白屏修复追加验证
- 根因：`vite.config.ts` 未设置 `base: './'`，Vite production HTML 生成 `/assets/...` 绝对路径；Electron packaged app 使用 `file://.../index.html` 加载时会解析为 `file:///assets/...`，导致 renderer JS/CSS 加载失败并白屏。
- 修复：在 `vite.config.ts` 设置 `base: './'`，新增 `tests/app/vitePackaging.test.ts` 防止回归。
- RED：`npm run test -- vitePackaging` 先失败，提示配置源中缺少 `base: './'`。
- GREEN：`npm run test -- vitePackaging` PASS。
- 打包：`npm run package:mac` PASS，重新生成 `/Users/peyoba/Desktop/web/AgentDock/release/AgentDock-darwin-arm64/AgentDock.app`。
- 包体检查：`app.asar/dist/renderer/index.html` 使用 `src="./assets/..."` 与 `href="./assets/..."`，不再使用 `/assets/...`。
- 冒烟：通过 `--remote-debugging-port=9223` 读取 packaged renderer DOM，`document.body.innerText` 包含 AgentDock 主界面文本，`#root` 有子节点。
- 回归：`npm run test` PASS：16 files / 31 tests；`npm run workflow:doctor` PASS；`npm run test:workflow` PASS：8 passed；`git diff --check` PASS。

## UI 交互补齐追加验证
- 根因/范围：用户手工测试发现很多按钮点击无反应；检查代码确认顶部按钮、命令选择、API 类型 tab、API 配置卡片、加号和关闭 tab 多数仍是静态 UI 或缺少状态联动。
- 修复：命令栏改为真实可选控件；API 配置支持按工具类型过滤并选择配置；选择 Codex 配置自动切换启动命令为 `codex`；加号复用启动会话；关闭 tab 调用 `killTerminal` 并从 UI 移除；会话详情显示当前 session/profile/workspace 动态信息；顶部按钮可跳转/聚焦相关区域。
- RED：`npm run test -- App` 先失败，证明缺少 `选择 API 配置` 控件、配置卡片过滤、独立关闭按钮。
- GREEN：`npm run test -- App` PASS。
- 打包：`npm run package:mac` PASS，重新生成 `/Users/peyoba/Desktop/web/AgentDock/release/AgentDock-darwin-arm64/AgentDock.app`。
- Packaged 点击冒烟：通过 `--remote-debugging-port=9224` 启动成品 App，点击 `Codex` 类型后只显示 `Codex · OpenAI` 卡片；点击卡片后命令栏选中 `codex-openai`，启动命令变为 `codex`。
- 回归：`npm run test` PASS：16 files / 34 tests；`npm run build` PASS；`npm run workflow:doctor` PASS；`npm run test:workflow` PASS：8 passed；`git diff --check` PASS。

## 系统 AnyRouter API Key 真实测试
- 授权来源：用户要求使用当前系统 API key 测试。
- Secret 处理：未打印 API key；未写入代码或文档；仅将系统环境变量 `ANYROUTER_API_KEY` 写入 macOS Keychain `AgentDock/claude-anyrouter`，供 AgentDock 本地测试使用。
- Keychain 检查：`AgentDock/claude-anyrouter` 存在，长度与系统 `ANYROUTER_API_KEY` 一致。
- 只读鉴权测试：`GET https://anyrouter.top/v1/models` 使用系统 key 返回 HTTP 200，模型数量 16，首个模型 `claude-3-5-haiku-20241022`。
- Messages 直连测试：`POST https://anyrouter.top/v1/messages` 已到达服务端，但模型层返回 `429 Service Unavailable` 或 AnyRouter 配置提示；这表示 key 可鉴权，但当前上游模型调用不可用。
- Claude CLI 端到端测试：发现 Claude CLI 会在 `ANTHROPIC_BASE_URL` 后追加 `/v1/messages`；因此 AgentDock 的 Claude profile 不能配置成 `https://anyrouter.top/v1`，否则会请求 `/v1/v1/messages`。已修正默认 Claude AnyRouter endpoint 为 `https://anyrouter.top`。
- 成品 App 冒烟：打包 App 中 `claude-anyrouter` profile 显示 `https://anyrouter.top`，不再包含 `example.invalid`。
- 回归：`npm run test` PASS：16 files / 34 tests；`npm run build` PASS；`npm run package:mac` PASS；`git diff --check` PASS。

## API 配置编辑追加验证
- 用户问题：成品 App 的接口配置无法编辑、无法修改 endpoint/model/keychain 引用。
- 修复范围：新增 API 配置编辑表单；支持修改名称、工具类型、Base URL、默认模型、Keychain Service、Keychain Account、Codex Home；保存后更新 renderer 状态并通过 `profiles:save` IPC 写入主进程 profile store；后续 `sessions:launch` 从 profile store 合并后的配置读取 profile，确保保存后的 endpoint 会影响启动。
- 安全边界：编辑表单只处理 Keychain 引用，不读取、不显示、不返回完整 API key 或完整 env；成品 App 冒烟确认页面不包含 `ANTHROPIC_AUTH_TOKEN` / `OPENAI_API_KEY` 字样。
- RED：`npm run test -- App preloadTypes` 先失败，缺少 `接口名称` 编辑字段和 `saveProfile` preload API。
- GREEN：`npm run test -- App preloadTypes` PASS；`npm run test` PASS：16 files / 35 tests。
- 构建/打包：`npm run build` PASS；`npm run package:mac` PASS。
- 成品 App 冒烟：通过 `--remote-debugging-port=9226` 打开新包，确认 `编辑接口配置` 表单存在，`接口名称`、`Base URL`、`默认模型` 字段存在；点击 `保存配置` 后出现 `配置已保存`；当前 Base URL 为 `https://anyrouter.top`。
- 签名检查：`codesign --verify --deep --strict --verbose=2 release/AgentDock-darwin-arm64/AgentDock.app` PASS。
- Workflow：`npm run workflow:doctor` PASS；`npm run test:workflow` PASS：8 passed；`git diff --check` PASS。

## API 多配置、独立配置页与 Codex Home 修复追加验证
- 用户问题：接口配置仍像嵌在主界面的单个编辑区，且新增不同 API 地址/key 的流程不明显；Codex 启动报 `CODEX_HOME points to "~/.agentdock/codex-profiles/codex-openai", but that path does not exist`。
- 计划对齐：根据 `docs/PROJECT_REQUIREMENTS.md` 与 `docs/requirements/02-产品UI设计.md`，主界面应保持终端优先，API 配置作为独立配置页面/视图；最终接受方向为 `agentdock-api-config-cn-v2.png` 的按工具类型分类配置页。
- 修复范围：
  - 默认页面只显示终端工作台，不再内嵌 API 配置区域。
  - 点击顶部“接口配置”进入独立配置页；配置页提供“返回终端工作台”。
  - “新增配置”会创建唯一 profile id 与唯一 Keychain Account，避免两个 API 配置覆盖同一把 key。
  - 支持为新增配置保存不同 Base URL、默认模型和替换 API Key，保存后回到终端工作台可在启动栏选择新配置。
  - `CODEX_HOME` 支持将 `~/...` 展开为真实用户目录，并在 spawn Codex 前创建目录。
- RED：
  - `npm run test -- tests/app/App.test.tsx` 先失败，证明 API 配置仍被内嵌在终端工作台，且缺少“返回终端工作台”。
  - `npm run test -- tests/app/launchEnvironment.test.ts tests/app/sessionServiceTerminal.test.ts` 先失败，证明 `CODEX_HOME` 原样传递 `~` 且未创建目录。
- GREEN：
  - `npm run test -- tests/app/App.test.tsx` PASS：13 tests。
  - `npm run test -- tests/app/launchEnvironment.test.ts tests/app/sessionServiceTerminal.test.ts` PASS：7 tests。
  - `npm run test` PASS：17 files / 46 tests。
- 构建/打包：
  - `npm run build` PASS。
  - `npm run package:mac` PASS，重新生成 `/Users/peyoba/Desktop/web/AgentDock/release/AgentDock-darwin-arm64/AgentDock.app`。
- 成品 App UI 冒烟：通过 `--remote-debugging-port=9233` 打包 App 验证：
  - 默认显示 `aria-label="新建终端会话"`，不存在 `section[aria-label="API 配置"]`。
  - 点击顶部“接口配置”后显示 `section[aria-label="API 配置"]`，终端启动栏隐藏，并存在“返回终端工作台”按钮。
  - 点击“返回终端工作台”后回到终端工作台，API 配置页从 DOM 移除。
- 结论：PASS。配置页结构已重新对齐计划；多 API 地址/key 与 Codex Home 缺目录问题已修复。

## API Key 输入入口与 packaged Codex PATH 修复追加验证
- 用户问题：
  - API 配置页看不到明确填写 API Key 的地方。
  - 启动 Codex 报 `zsh:1: command not found: codex`。
- 根因：
  - API Key 密码框原文案为“替换 API Key”，用户初次配置时不够明确。
  - 机器上的 Codex CLI 位于 `/Users/peyoba/.npm-global/bin/codex`；打包 App 从 Finder 启动时 PATH 可能只有系统短路径，缺少 `~/.npm-global/bin`。
- 修复范围：
  - 将密码框改为明确的 `API Key（保存到 macOS 钥匙串）`，补充说明“填写后保存到 macOS 钥匙串；留空则保留当前 Key。”，并加 `aria-label` 便于无障碍和测试定位。
  - PTY spawn 环境自动补齐常见用户 CLI 路径：`~/.npm-global/bin`、`~/.local/bin`、`~/.codex/bin`、`~/.claude/bin`、`~/.opencode/bin`、Homebrew 和 `/usr/local/bin` 等。
- RED：
  - `npm run test -- tests/app/App.test.tsx` 先失败，证明找不到明确的 API Key 输入框和说明。
  - `npm run test -- tests/app/ptyAdapter.test.ts` 先失败，证明短 PATH 下没有补齐 `~/.npm-global/bin`。
- GREEN：
  - `npm run test -- tests/app/App.test.tsx tests/app/ptyAdapter.test.ts` PASS：2 files / 18 tests。
  - `npm run test` PASS：17 files / 47 tests。
  - `npm run build` PASS。
  - `npm run package:mac` PASS，重新生成 `/Users/peyoba/Desktop/web/AgentDock/release/AgentDock-darwin-arm64/AgentDock.app`。
- 成品 App 冒烟：通过 `--remote-debugging-port=9234` 打包 App 验证：
  - 配置页存在 `input[aria-label="API Key（保存到 macOS 钥匙串）"]`。
  - 配置页说明包含“填写后保存到 macOS 钥匙串；留空则保留当前 Key。”。
  - 通过 `window.agentDock.launchSession` 执行 `sleep 0.2; command -v codex; sleep 0.5`，终端 buffer 包含 `/Users/peyoba/.npm-global/bin/codex`，证明 packaged shell PATH 可找到 Codex。
- 结论：PASS。用户现在可以在配置页明确填写 API Key，打包 App 也能找到本机安装的 Codex CLI。

## macOS Keychain 重复系统密码弹窗缓解
- 用户问题：保存/启动配置时 macOS 频繁要求输入电脑系统密码。
- 根因：AgentDock 通过 `keytar` 调用 macOS Keychain；每次 `getPassword`/`setPassword` 都可能触发系统授权。当前本地包是 ad-hoc/开发签名，macOS 不会像正式 Developer ID 签名 App 一样稳定信任该二进制；并且重新打包后签名/路径状态变化会让钥匙串再次询问。
- 修复范围：`createKeytarAdapter` 增加主进程内存 secret cache；首次读取或写入后，同一次 App 运行期间同一 `Service/Account` 的后续启动不再重复读取 Keychain，从而减少重复系统密码弹窗。删除 secret 时同步清理缓存。
- 安全边界：缓存只在 Electron main process 内存中，不经 renderer/IPC 返回完整 secret 或完整 env；App 重启后仍需要由 macOS Keychain 授权读取。
- RED：`npm test -- tests/app/keychainAdapter.test.ts` 先失败，证明旧实现会重复 `getPassword`，且写入后下一次读取仍回到 Keychain。
- GREEN：`npm test -- tests/app/keychainAdapter.test.ts` PASS：5 tests。
- 回归：`npm run test` PASS：17 files / 50 tests；`npm run build` PASS；`npm run package:mac` PASS；`npm run workflow:doctor` PASS；`npm run test:workflow` PASS：8 passed；`git diff --check` PASS。
- 产物：已重新生成 `/Users/peyoba/Desktop/web/AgentDock/release/AgentDock-darwin-arm64/AgentDock.app`。

## macOS 窗口拖动与自由缩放修复
- 用户问题：主界面窗口在屏幕中的位置不能自由调整，窗口大小也不能自由缩放。
- 根因：Electron 使用 `titleBarStyle: 'hiddenInset'` 后，Renderer 自定义顶部栏没有设置 `-webkit-app-region: drag`，导致内容标题栏区域不能拖动窗口；同时 BrowserWindow 设置 `minWidth: 980` / `minHeight: 680`，使窗口无法缩到更小尺寸。
- 修复范围：
  - `src/renderer/styles.css`：`.titlebar-spacer` 增加 `-webkit-app-region: drag`；标题栏内 button/input/select 增加 `-webkit-app-region: no-drag`，保证按钮仍可点击。
  - `src/main/main.ts`：显式设置 `resizable: true`，并把最小窗口尺寸降到 `720x480`。
  - `tests/app/windowChrome.test.ts`：新增回归测试约束标题栏拖动区、控件 no-drag、可缩放窗口和紧凑最小尺寸。
- RED：`npm test -- tests/app/windowChrome.test.ts` 先失败，证明旧代码缺少拖动区域、未显式 resizable 且最小尺寸过大。
- GREEN：`npm test -- tests/app/windowChrome.test.ts` PASS：2 tests。
- 回归：`npm run test` PASS：18 files / 52 tests；`npm run build` PASS；`npm run package:mac` PASS；`npm run workflow:doctor` PASS；`npm run test:workflow` PASS：8 passed；`git diff --check` PASS。
- 打包产物检查：直接读取 `release/AgentDock-darwin-arm64/AgentDock.app/Contents/Resources/app.asar`，确认包含 `minWidth: 720`、`minHeight: 480`、`resizable: true`、`-webkit-app-region:drag` 和 `-webkit-app-region:no-drag`。
- 产物：已重新生成 `/Users/peyoba/Desktop/web/AgentDock/release/AgentDock-darwin-arm64/AgentDock.app`。

## 工作区路径选择与持久化
- 用户需求：工作区目前不能自由选择；应通过路径选择工作区，第一次选择后保存名称，下次可直接从下拉选择。
- 设计决定：MVP 不新增复杂工作区页面，先在主界面 command bar 的工作区下拉旁增加“选择路径”按钮；点击后打开 macOS 目录选择器，选中目录后用目录 basename 作为默认工作区名称保存到本地 `workspaces.json`，并立即选中。
- 修复范围：
  - `src/main/workspaceService.ts`：新增从路径生成稳定 Workspace 记录、合并默认/已保存工作区并按 path 去重。
  - `src/main/main.ts`：接入 `createWorkspaceStore`；`workspaces:list` 返回默认 + 已保存工作区；新增 `workspaces:choose` IPC，调用 `dialog.showOpenDialog({ properties: ['openDirectory'] })`，保存首次选择的目录；`sessions:launch` 从完整工作区列表查找 workspace。
  - `src/shared/preloadTypes.ts` / `src/preload/preload.cts`：新增 `chooseWorkspace()` preload API，只返回 Workspace metadata，不涉及 secret/env。
  - `src/renderer/components/CommandBar.tsx` / `src/renderer/App.tsx`：工作区下拉旁显示“选择路径”按钮；选择后 upsert 到下拉并设为当前工作区，启动时使用新 workspaceId。
  - `tests/app/workspaceService.test.ts`、`tests/app/preloadTypes.test.ts`、`tests/app/App.test.tsx`：覆盖路径生成、preload 白名单、UI 选择路径后保存/选中/启动。
- RED：`npm test -- tests/app/workspaceService.test.ts tests/app/preloadTypes.test.ts tests/app/App.test.tsx` 先失败，证明缺少 workspaceService、preload `chooseWorkspace` 和“选择工作区路径”按钮。
- GREEN：同一命令 PASS：3 files / 18 tests。
- 回归：`npm run test` PASS：19 files / 55 tests；`npm run build` PASS；`npm run package:mac` PASS；`npm run workflow:doctor` PASS；`npm run test:workflow` PASS：8 passed；`git diff --check` PASS。
- 打包产物检查：直接读取 `release/AgentDock-darwin-arm64/AgentDock.app/Contents/Resources/app.asar`，确认 main 包含 `workspaces:choose` 和 `showOpenDialog`，preload 包含 `chooseWorkspace`/`workspaces:choose`，renderer 包含“选择路径”/“选择工作区路径”，`workspaceStore.js` 包含 `workspaces.json`，`workspaceService.js` 包含稳定 workspace id 和 basename 逻辑。
- 产物：已重新生成 `/Users/peyoba/Desktop/web/AgentDock/release/AgentDock-darwin-arm64/AgentDock.app`。

## API 配置高级字段默认隐藏与只读
- 用户需求：`配置 ID`、`Keychain Service`、`Keychain Account`、`Codex Home` 对普通使用者没有日常作用；按建议默认隐藏，不需要修改的做成只读。
- 修复范围：
  - `src/renderer/components/ApiConfigPanel.tsx`：默认表单只显示常用字段（接口名称、工具类型、Base URL、默认模型、API Key）；新增“显示高级设置/隐藏高级设置”折叠控制；高级区显示 `配置 ID`、`Keychain Service`、`Keychain Account` 只读字段；`Codex Home` 只在 Codex 配置的高级区显示且只读；切换配置或新增配置时高级区默认收起。
  - `src/renderer/styles.css`：补充高级设置折叠按钮样式。
  - `tests/app/App.test.tsx`：新增测试覆盖高级字段默认隐藏、展开后只读、Claude 不显示 Codex Home、Codex 仅在高级区显示只读 Codex Home。
- RED：`npm test -- tests/app/App.test.tsx` 先失败，证明旧 UI 默认暴露配置 ID/Keychain/Codex Home 且部分字段可编辑。
- GREEN：`npm test -- tests/app/App.test.tsx` PASS：16 tests。
- 回归：`npm run test` PASS：19 files / 57 tests；`npm run build` PASS；`npm run package:mac` PASS；`npm run workflow:doctor` PASS；`npm run test:workflow` PASS：8 passed；`git diff --check` PASS。
- 打包产物检查：直接读取 `release/AgentDock-darwin-arm64/AgentDock.app/Contents/Resources/app.asar`，确认 renderer 包含“显示高级设置”“隐藏高级设置”、高级设置说明和 readOnly 逻辑。
- 产物：已重新生成 `/Users/peyoba/Desktop/web/AgentDock/release/AgentDock-darwin-arm64/AgentDock.app`。

## 主界面可见视觉改版与提交前安全检查
- 用户反馈：上一轮主界面 UI 变化不明显；要求继续开发，同时要求更新到 GitHub 前做好安全检查，不能上传重要信息。
- 修复范围：
  - `src/renderer/components/AppHeader.tsx`：增加品牌锁定区和 `AD` 品牌图标，让顶部不再只是文字标题。
  - `src/renderer/components/CommandBar.tsx`：启动栏改为明显的 `Quick Launch` 双区结构，左侧深色说明卡，右侧白色字段面板；保留 Profile/Workspace/path/command/launch 交互。
  - `src/renderer/components/SessionDetailsDrawer.tsx`：默认隐藏 Keychain 这类工程细节，新增“显示高级详情”。
  - `src/renderer/components/ApiConfigPanel.tsx`：配置卡片不再默认显示 Keychain 引用，文案改为用户可理解的“密钥存储”。
  - `src/renderer/styles.css`：主界面背景、品牌图标、Quick Launch、胶囊式 session tabs、终端卡片和 API 配置双栏布局做明显视觉调整。
  - `tests/app/App.test.tsx` / `tests/app/layoutPolish.test.ts`：新增回归测试约束 Quick Launch 文案、工程详情默认隐藏、配置卡片不暴露 Keychain、启动栏 grid、tab 单行省略、API 配置稳定双栏。
- RED：`npm test -- tests/app/App.test.tsx -t "renders terminal-first launch controls"` 先失败，证明旧主界面没有 `Quick Launch` 工作台标题和说明；`npm test -- tests/app/App.test.tsx tests/app/layoutPolish.test.ts` 曾失败，证明旧 UI 默认暴露 Keychain、样式缺少 compact tab/grid 约束。
- GREEN：`npm test -- tests/app/App.test.tsx tests/app/layoutPolish.test.ts` PASS：2 files / 21 tests。
- 回归：`npm run test` PASS：20 files / 62 tests；`npm run build` PASS；`npm run package:mac` PASS；`npm run workflow:doctor` PASS；`npm run test:workflow` PASS：8 passed；`git diff --check` PASS。
- 提交前安全检查：
  - 确认 `release/`、`dist/`、`node_modules/`、`.env`、`.env.local`、`workspaces.json`、`profiles.json` 均未被 Git 跟踪。
  - 扫描变更文件名：无 `.env`、private key、token、credential、workspaces/profiles userData 等敏感文件名。
  - 扫描内容：未发现 `sk-...`、`sk-proj-...`、AWS、Google、GitHub token、private key、用户 endpoint 等真实敏感内容。
  - 将测试中的假 `sk-...` 字符串改为非真实形态 `test-...`，避免误报和误传。
  - 仅剩 `ANTHROPIC_AUTH_TOKEN` / `OPENAI_API_KEY` 字段名出现在源码运行时 env builder 中，不包含实际 secret 值，属于功能代码。
- 产物：已重新生成 `/Users/peyoba/Desktop/web/AgentDock/release/AgentDock-darwin-arm64/AgentDock.app`，但 release 目录被 `.gitignore` 排除，不会提交。
