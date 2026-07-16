# AgentDock Windows x64 便携包设计

## 状态

等待用户审阅。本文档尚未进入实现阶段。

本文档定义 AgentDock 首个 Windows 版本的最小交付范围。后续实施计划、测试拆分、代码修改和打包验证必须以本文档的用户确认版本为准。

## 风险等级

L3。

原因：本设计后续会影响 Electron 发布产物、`node-pty` Windows 原生模块、PowerShell/ConPTY 启动方式、CLI PATH、平台专属可执行文件隔离和真实 Windows 验证。

## 背景

AgentDock 当前以 macOS Apple Silicon 为首发平台，已有稳定的时间戳打包脚本、构建信息、`node-pty`、本机加密 vault 和 macOS 自签名流程。项目尚未提供 Windows 打包命令或 Windows 发布说明。

现有代码中存在以下平台假设，不能直接把 macOS 包装参数改成 `win32` 后宣称可用：

- Renderer 的本地终端固定显示并启动 `zsh`。
- Main 进程的会话命令白名单只包含 `claude`、`codex`、`zsh` 和 `bash`。
- PTY 命令通过 Unix shell 的 `-lc`、`export PATH=...` 和单引号规则启动。
- PATH 补全包含 `/opt/homebrew/bin`、`/usr/local/bin` 等 Unix 路径。
- BrowserWindow 固定使用 macOS 风格隐藏标题栏，而 Renderer 没有 Windows 最小化、最大化和关闭按钮。
- 内置 CCometixLine 二进制固定为 macOS arm64 包，不能进入 Windows 运行路径。
- macOS 打包脚本只处理 `spawn-helper`、`ccline` 和代码签名，不覆盖 Windows ConPTY 所需的 `.exe` 文件。

用户确认首个 Windows 版本以“越简单越好”为原则：先交付 Windows x64 便携 ZIP，不制作安装向导，不新增 npm 依赖，不做 Windows 代码签名。

## 方案比较

### 方案 A：Windows x64 便携 ZIP

复用现有 `@electron/packager`，生成 `AgentDock-win32-x64` 目录并压缩为 ZIP。

优点：

- 不新增 npm 依赖。
- 不引入 NSIS、Squirrel 或安装器配置。
- 可在当前 macOS 开发机执行交叉打包。
- 输出结构简单，便于检查 `node-pty` Windows 预编译文件和 `build-info.json`。

限制：

- 用户需要手动解压并运行 `AgentDock.exe`。
- 没有开始菜单快捷方式、卸载入口、自动更新或代码签名。
- macOS 不能完成真实 Windows GUI 和 ConPTY 运行验证。

### 方案 B：Windows CI 构建便携 ZIP

通过 GitHub Actions 的 Windows runner 执行安装、测试、构建和压缩。

优点：在真实 Windows 构建环境生成产物，原生模块和路径验证更可靠。

限制：需要新增 CI 配置和发布凭据管理，超出“先做最简单本地首包”的范围。

### 方案 C：Windows `.exe` 安装器

引入 electron-builder、electron-winstaller 或同类工具，生成 NSIS/Squirrel 安装程序。

优点：用户安装体验完整。

限制：需要新增依赖、安装器配置、图标、签名、卸载和升级策略，改动与验证范围最大。

## 选定方案

采用方案 A：Windows x64 便携 ZIP。

首包只面向常见的 64 位 Intel/AMD Windows 10/11。Windows arm64、32 位 Windows、安装器、签名和自动更新均不在本次范围内。

## 目标

1. 提供可重复执行的 Windows x64 打包命令。
2. 生成包含 `AgentDock.exe` 的便携目录和 ZIP 文件。
3. Windows 上的本地终端使用 PowerShell，而不是 `zsh`。
4. Claude/Codex CLI 会话通过 Windows PowerShell 和 ConPTY 启动。
5. Windows 包包含 `node-pty` 的 win32-x64 原生文件，并保证 `.node`、ConPTY/WinPTY `.exe` 不留在 `app.asar` 内。
6. Windows 运行路径不得调用或打包为可用 fallback 的 macOS arm64 `ccline`。
7. 包内写入版本、build id、commit 和 dirty 状态，保持与 macOS 包一致的可追溯能力。
8. Windows 使用系统原生窗口标题栏，具备最小化、最大化和关闭操作。
9. 不改变 macOS 现有行为和 `npm run package:mac` 的输出。

## 非目标

- 不生成 NSIS、MSI、Squirrel 或其他安装程序。
- 不增加桌面、开始菜单或任务栏快捷方式。
- 不实现自动更新。
- 不做 Windows 代码签名。
- 不发布到 GitHub Release。
- 不支持 Windows arm64 或 x86。
- 不内置 Windows 版 Claude CLI、Codex CLI 或 CCometixLine。
- 不修改 API Profile、Workspace、Session Record 或 vault 数据模型。
- 不新增状态管理库、UI 组件库或打包工具。
- 不承诺在 macOS 上完成真实 Windows GUI、ConPTY、中文输入和 Ctrl+C 验收。

## 交付产物

打包命令建议为：

```text
npm run package:win
```

产物使用现有时间戳目录：

```text
release/packages/<buildId>/AgentDock-win32-x64/
release/packages/<buildId>/AgentDock-v0.1.0-windows-x64.zip
```

便携目录至少包含：

```text
AgentDock.exe
resources/app.asar
resources/app.asar.unpacked/
resources/build-info.json
Electron/Chromium 运行文件
```

ZIP 解压后必须能保持完整目录结构，用户不得只单独复制 `AgentDock.exe`。

## 平台运行设计

### 本地终端标识

Renderer 不再把本地终端选项写死为 `zsh`。用户可见文案统一为“本地终端”，会话请求使用平台无关的本地 shell 标识。

Main/PTY 层负责把该标识解析为：

- macOS/Linux：当前默认 shell，缺省使用 `/bin/zsh`。
- Windows：优先使用系统 PowerShell，缺省为 `powershell.exe`。

已有历史 Session 中的 `zsh` 和 `bash` 仍保持兼容，不能因平台无关标识而破坏 macOS 历史记录。

### Claude/Codex 命令启动

Unix 平台继续使用现有登录 shell 行为。

Windows 平台使用 PowerShell 的命令执行参数启动 `claude` 或 `codex`，不得拼接 Unix 的 `export`、`-lc` 或单引号 shell 转义。

命令白名单继续只允许 AgentDock 支持的 Claude、Codex 和本地 shell 入口。Windows 支持不得扩大为任意 PowerShell 命令执行接口。

### PATH

Windows 保留继承的系统 PATH，并使用 Windows 的 PATH 分隔符。不能把 Homebrew、`/usr/local/bin` 等 Unix 路径加入 Windows PATH。

Windows 首包不主动猜测所有 npm 安装目录。Claude/Codex CLI 必须已经能在用户正常 PowerShell 中通过命令名启动；AgentDock 只继承并传递该可用环境。

### CCometixLine

当前内置包 `@cometix/ccline-darwin-arm64` 只允许在 macOS arm64 上作为 fallback 使用。

Windows 首包规则：

- Windows 打包产物不得把该 macOS 二进制作为可执行 fallback。
- Windows 会话默认不写入内置 `ccline` statusLine。
- Profile 中已有 `claudeCclineStatusLineEnabled` 不得导致 Windows 启动失败。
- Windows 版 ccline 内置或用户安装探测留给后续独立需求。

### 窗口边框

macOS 继续使用现有隐藏标题栏和自定义拖动区域。

Windows 首包使用 Electron/Windows 系统原生标题栏和窗口控制按钮，不在本次实现自绘 Windows 标题栏。Renderer 顶部品牌栏继续作为应用内容显示，但不替代系统最小化、最大化和关闭按钮。

## 打包设计

新增独立 Windows 打包脚本，保持 macOS 脚本职责不变。

Windows 脚本复用以下既有规则：

- `npm run build` 先完成类型检查、Renderer 和 Main/Preload 构建。
- 使用 `npx --no-install electron-packager`，不隐式下载新的 npm 工具。
- 输出到新的时间戳目录，不覆盖旧产物。
- 忽略源码、测试、文档、release、工作流、本地配置、`.env` 和日志。
- 使用整个 Git 工作区判断 dirty 状态。
- 写入 `build-info.json`。

Windows 专属参数：

- `platform=win32`
- `arch=x64`
- 解包 `*.node` 和 `*.exe`，保证 node-pty 的 win32-x64 原生模块、ConPTY/WinPTY 辅助程序可直接执行。
- 排除 macOS 专属 ccline fallback。

压缩步骤使用系统已有命令完成，不引入 ZIP npm 依赖。压缩失败必须保留已生成的便携目录并明确报错，不得伪装成完整交付成功。

## 构建信息

Windows `build-info.json` 与 macOS 保持相同字段：

- `version`
- `buildId`
- `buildTime`
- `commit`
- `commitShort`
- `dirty`

Windows 路径为：

```text
AgentDock-win32-x64/resources/build-info.json
```

首个正式候选包必须从干净工作区生成；dirty 包只能作为开发验证包。

## 错误处理

- 缺少 `electron-packager` 时立即失败，提示先执行 `npm install`。
- 输出目录已存在时立即失败，不覆盖旧包。
- Electron Windows 运行时下载失败时保留明确错误，不生成空 ZIP。
- 找不到压缩命令时明确报告便携目录路径，并将 ZIP 交付标记为失败。
- Windows 上找不到 PowerShell、Claude 或 Codex 时显示脱敏的启动失败信息，不包含完整环境变量或 API Key。
- node-pty 原生模块缺失时打包验证必须失败，不能等用户启动后才发现。

## 安全边界

- Windows 包不得包含 `.env`、本地 Profile、Workspace、Session history、vault、API Key 或开发机登录状态。
- 打包日志和错误不得输出 secret 或完整环境变量。
- Windows 启动仍由 Main 进程读取本机加密 vault，Renderer/IPC 默认不返回完整 secret。
- Windows PATH 兼容不能允许 Renderer 提交任意 shell 控制字符。
- Windows 包不得携带 macOS 本机签名身份、Keychain 数据或用户目录绝对路径。

## 测试策略

### TDD 自动化

实现前先新增失败测试，至少覆盖：

1. Windows 本地终端解析为 PowerShell。
2. Windows Claude/Codex 命令不使用 Unix `-lc` 和 `export PATH`。
3. Windows PATH 不注入 Unix 固定目录。
4. 会话命令白名单接受平台无关本地 shell 标识，仍拒绝控制字符和未知命令。
5. Windows 不启用 macOS ccline fallback。
6. Windows BrowserWindow 使用系统原生标题栏；macOS 仍保持现有隐藏标题栏。
7. Windows 打包脚本使用 win32/x64、时间戳输出、完整 dirty 检查和 `.node`/`.exe` 解包。
8. Windows 打包脚本不修改 macOS 打包脚本行为。
9. ZIP 文件名和 build-info 路径符合设计。

### 构建机验证

当前 macOS 开发机至少验证：

- `npm run workflow:doctor`
- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm run package:win`
- Windows 目录和 ZIP 存在且非空。
- `AgentDock.exe` 为 Windows PE 文件。
- `resources/build-info.json` 指向当前 commit，并记录正确 dirty 状态。
- `app.asar.unpacked` 包含 win32-x64 node-pty `.node` 和所需 `.exe`。
- 包内没有 API Key、vault、`.env`、本机 Profile/Workspace/Session 数据和开发机绝对路径。

### Windows 真机验证

由于当前执行环境是 macOS，下列项目必须在 Windows 10/11 x64 真机或 Windows CI runner 上补验：

- 解压 ZIP 并启动 `AgentDock.exe`。
- 创建 Workspace。
- 启动 PowerShell 本地终端。
- 验证输入、输出、Ctrl+C、中文输入、粘贴和 resize。
- 在已安装 Claude/Codex CLI 的环境中启动真实会话。
- 验证 node-pty/ConPTY 正常退出和重启。
- 验证 vault 写入、读取和应用重启后的可用性。
- 确认 Windows Defender/SmartScreen 的未签名提示和实际阻塞情况。

未完成上述真机验证前，交付结论只能是“Windows x64 便携验证包”，不能标记为已正式支持 Windows。

## 验收标准

1. `npm run package:win` 能从干净工作区生成新的时间戳目录。
2. 产物同时包含可运行目录和 `AgentDock-v0.1.0-windows-x64.zip`。
3. ZIP 中存在 `AgentDock.exe`、`resources/app.asar` 和 `resources/build-info.json`。
4. Windows node-pty win32-x64 `.node` 与必要 `.exe` 位于可执行的 unpacked 路径。
5. Windows 本地终端使用 PowerShell；macOS 本地终端行为不回归。
6. Windows Claude/Codex 启动不使用 Unix shell 语法。
7. Windows 不调用 macOS arm64 ccline fallback。
8. Windows 使用系统原生标题栏，最小化、最大化和关闭按钮可用。
9. 包内不包含 secret、本地 vault、`.env` 或用户数据。
10. `npm run workflow:doctor`、`npm test`、`npm run typecheck` 和 `npm run build` 全部通过。
11. macOS 交叉打包验证结果与未完成的 Windows 真机项目分别记录，不把静态包检查等同于真机可用。

## 文档更新

实现阶段需要同步：

- `README.md`：增加 Windows x64 便携验证包说明、解压运行方式、CLI 前置条件和未签名提示。
- `PROJECT_PROFILE.md`：增加 `npm run package:win`、Windows x64 输出路径和真实验证边界。
- `DECISIONS.md`：记录首个 Windows 版本采用便携 ZIP、不引入安装器依赖的决策。
- `.agent-workflow/state.md`：记录 L3 角色、测试、构建和真机未验证项。
- `.agent-workflow/verification/`：新增 Windows 打包验证记录。
- `.agent-workflow/delivery/`：新增交付报告。

## 回滚

Windows 支持采用独立脚本和平台分支实现。出现问题时：

1. 停止分发 Windows ZIP。
2. 保留 macOS `package:mac` 和运行路径不变。
3. 回滚 Windows 打包脚本、平台 shell 适配和对应文档/tests。
4. 不迁移或修改用户已有 Profile、Workspace、Session history 和 vault 数据。

## 后续方向

以下能力需要新的需求确认，不属于本设计：

- Windows CI 原生构建和自动上传产物。
- NSIS/MSI 安装器。
- Windows 代码签名。
- Windows arm64。
- Windows 版 CCometixLine 内置。
- 自动更新和版本升级策略。
