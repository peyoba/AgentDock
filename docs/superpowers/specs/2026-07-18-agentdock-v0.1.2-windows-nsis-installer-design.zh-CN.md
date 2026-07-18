# AgentDock v0.1.2 Windows NSIS 安装器设计

## 1. 目标

为 Windows 10/11 x64 用户提供可直接双击安装的单文件 `.exe`，不再要求用户先理解便携 ZIP 的目录结构。

固定产物名称：

```text
AgentDock-Setup-v0.1.2-windows-x64.exe
```

## 2. 当前问题

`v0.1.1` Windows 产物是便携 ZIP。ZIP 内的 `AgentDock.exe` 依赖同目录中的 `resources`、Electron 运行文件和 `node-pty` 原生文件，不能作为独立文件上传和运行。

GitHub 当前不存在公开的 `v0.1.1` Release，但远端 `v0.1.1` tag 已存在。为避免改写已推送 tag，本次发布新版本 `v0.1.2`。

## 3. 方案

采用 `electron-builder` 的 NSIS target：

- 增加 `electron-builder` 开发依赖和 Windows 安装器配置。
- 复用现有 Electron、React、TypeScript 构建结果和 Windows x64 原生依赖。
- 使用按当前用户安装的 one-click NSIS 安装器，不要求管理员权限。
- 安装后创建开始菜单入口；不默认创建桌面快捷方式。
- 保留便携 ZIP 作为备用产物，但 Release 的主下载项是安装器 `.exe`。
- 不增加自动更新、MSI、代码签名、证书购买或 Windows ARM64 支持。

## 4. 版本与发布

- 项目版本从 `0.1.1` 升级为 `0.1.2`。
- 新建 annotated tag `v0.1.2`，不得移动或删除 `v0.1.0`、`v0.1.1` tag。
- 创建 GitHub Pre-release `AgentDock v0.1.2 Windows Installer Preview`。
- 上传：
  - `AgentDock-Setup-v0.1.2-windows-x64.exe`
  - `AgentDock-v0.1.2-windows-x64.zip`
  - 同一干净提交构建的 macOS arm64 ZIP。
- Release notes 记录三个文件的 SHA-256，并明确 Windows 未签名和真机验证边界。

## 5. 安全与运行边界

- 安装器和应用均不得包含 API Key、endpoint 私有配置、本机 vault、登录状态或 `.env`。
- Windows 安装器暂不签名，SmartScreen 可能显示未知发布者；文档必须提示用户核对 SHA-256。
- macOS 交叉构建不能证明 Windows GUI、PowerShell/ConPTY、中文输入、Ctrl+C、resize、真实 CLI 和 vault 重启可用，这些项目继续标记为 `PARTIAL`。

## 6. 验证

至少执行：

```bash
npm run workflow:doctor
npm run test:workflow
npm test
npm run typecheck
npm run build
npm run package:win
npm run package:win:installer
npm run package:mac
```

安装器验收还必须确认：

- 文件格式为 Windows PE x86-64 可执行文件。
- 安装器内包含 `node-pty` 的 win32-x64 原生文件。
- 不包含 macOS ccline 包、源码、测试、文档、日志、`.env` 或私有配置。
- 产物 `build-info.json` 指向同一个干净提交，`dirty=false`。
- 三个归档/安装器的 SHA-256 与 GitHub Release 服务端 digest 一致。

Windows 真机安装、卸载和运行未实际执行前，发布定位保持 Preview。

## 7. 回滚

- 安装器构建失败时保留 `v0.1.1` tag 和现有便携包代码，不移动旧 tag。
- 发布后发现问题时将 `v0.1.2` Release 设为 draft 或撤下资产；删除远端 tag 必须再次获得用户明确授权。
