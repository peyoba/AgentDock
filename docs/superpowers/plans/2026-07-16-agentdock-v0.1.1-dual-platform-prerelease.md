# AgentDock v0.1.1 Windows x64 便携包与双平台预发布 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 AgentDock 增加最小 Windows x64 运行与便携 ZIP 打包能力，把项目版本升级到 `0.1.1`，并将同一干净提交生成的最新 macOS arm64 ZIP 和 Windows x64 ZIP 上传为 GitHub Pre-release。

**Architecture:** 用共享的会话命令合同把 Renderer/Main/SessionService 的本地 shell 语义统一为平台无关的 `local-shell`；PTY adapter 在运行时选择 Unix login shell 或 Windows PowerShell/ConPTY；Windows 禁用 macOS ccline fallback并使用系统原生标题栏。打包层复用现有 `@electron/packager`，新增 Windows 脚本并扩展 macOS ZIP 产物，不引入 npm 依赖；发布层先冻结干净构建提交，再打双平台包、建 annotated tag 和 GitHub Pre-release，最后补 README 的真实 SHA-256。

**Tech Stack:** Electron 37、React 19、TypeScript 5、xterm.js、node-pty、Vitest、npm、`@electron/packager`、Git、GitHub CLI。

---

## 风险与执行角色

本任务为 L3：涉及 Windows 构建产物、PowerShell/ConPTY、`node-pty` 原生模块、环境 PATH、安全命令白名单、版本/tag、GitHub Release 和部署回滚。

执行前按项目模板创建并登记以下任务卡；性能角色 SKIPPED，因为没有热路径、缓存或大规模数据处理变化：

- ①测试工程师：建立 Windows shell、打包和版本 RED 合同。
- ②开发工程师：完成最小实现，不修改测试语义。
- ③验收工程师：逐条核对书面 SPEC。
- ④质量工程师：检查平台边界、重复逻辑和 macOS 回归。
- ⑤安全工程师：检查命令注入、secret、环境变量和产物泄露。
- ⑩风险审查官：检查未签名 Windows 包、交叉构建和发布回滚。
- ⑦文档工程师：更新 README、PROJECT_PROFILE、DECISIONS 和交付文档。
- ⑧集成工程师：全量测试、双平台包、原生模块和产物扫描。
- ⑨部署工程师：tag、GitHub Pre-release、assets 和远端核验。

## 文件结构

### 新增

- `src/shared/sessionCommands.ts`：平台无关的本地 shell 标识、命令可执行名解析和本地 shell 判断。
- `scripts/package-support.mjs`：时间戳、版本、Git commit/dirty、构建信息写入和子进程失败处理。
- `scripts/package-win.mjs`：Windows x64 electron-packager、原生文件验证、build-info 和 ZIP。
- `tests/app/sessionCommands.test.ts`：共享命令合同。
- `tests/app/packageWindowsScript.test.ts`：Windows 打包静态合同。
- `.agent-workflow/verification/2026-07-16-agentdock-v0.1.1-dual-platform-prerelease.md`：真实构建和发布验证记录。
- `.agent-workflow/delivery/2026-07-16-agentdock-v0.1.1-dual-platform-prerelease-delivery-report.md`：最终交付报告。

### 修改

- `src/main/adapters/ptyAdapter.ts`：Windows PowerShell/ConPTY 参数、平台 PATH 和 `local-shell`。
- `src/main/sessionService.ts`：共享本地 shell 判断、Windows 跳过 ccline settings。
- `src/main/cclineLocator.ts`：非 macOS 返回不可用，不解析 macOS arm64 fallback。
- `src/main/main.ts`：共享命令白名单、本地 shell判断和 Windows 原生标题栏。
- `src/renderer/App.tsx`：发送 `local-shell`，用共享判断控制终端历史模式。
- `src/renderer/components/CommandBar.tsx`：用户文案改为“本地终端”。
- `scripts/package-mac.mjs`：使用共享构建信息并生成版本化 macOS ZIP。
- `package.json`：版本 `0.1.1` 和 `package:win` script；不改依赖集合。
- `package-lock.json`：仅同步根项目版本为 `0.1.1`。
- `src/preload/preload.cts`、`src/renderer/App.tsx`：同步无 Main API 时的可见 fallback 版本为 `0.1.1`。
- `tests/app/ptyAdapter.test.ts`：Windows spawn/PATH 与 macOS 回归。
- `tests/app/sessionServiceTerminal.test.ts`：`local-shell` 不读取 secret。
- `tests/app/App.test.tsx`：Renderer 发送平台无关命令和文案。
- `tests/app/cclineLocator.test.ts`：Windows 禁用 ccline fallback。
- `tests/app/sessionService.test.ts`：resolver 返回不可用时不写 statusLine。
- `tests/app/windowChrome.test.ts`：macOS hidden titlebar、Windows native titlebar 合同。
- `tests/app/packageMacScript.test.ts`：版本化 macOS ZIP 和共享 helper 合同。
- `tests/app/packageMacBuildInfo.test.ts`：改为直接验证共享 build-info helper。
- `README.md`、`PROJECT_PROFILE.md`、`DECISIONS.md`：v0.1.1 双平台使用和发布边界。

## Task 1：建立共享会话命令合同

**Files:**
- Create: `src/shared/sessionCommands.ts`
- Create: `tests/app/sessionCommands.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest';
import {
  LOCAL_SHELL_COMMAND,
  commandExecutableName,
  isLocalShellCommand,
  isSupportedSessionCommand,
} from '../../src/shared/sessionCommands';

describe('sessionCommands', () => {
  it('uses a platform-neutral local shell sentinel', () => {
    expect(LOCAL_SHELL_COMMAND).toBe('local-shell');
    expect(isLocalShellCommand('local-shell')).toBe(true);
    expect(isLocalShellCommand('/bin/zsh')).toBe(true);
    expect(isLocalShellCommand('powershell.exe')).toBe(true);
  });

  it('extracts executable names from Unix and Windows paths', () => {
    expect(commandExecutableName('/usr/local/bin/claude --resume abc')).toBe('claude');
    expect(commandExecutableName('C:\\Tools\\codex.exe --version')).toBe('codex.exe');
  });

  it('keeps the command allowlist narrow', () => {
    expect(isSupportedSessionCommand('claude --dangerously-skip-permissions')).toBe(true);
    expect(isSupportedSessionCommand('codex --no-alt-screen')).toBe(true);
    expect(isSupportedSessionCommand('local-shell')).toBe(true);
    expect(isSupportedSessionCommand('powershell.exe')).toBe(true);
    expect(isSupportedSessionCommand('curl https://example.invalid')).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npx vitest run tests/app/sessionCommands.test.ts`

Expected: FAIL，原因是 `src/shared/sessionCommands.ts` 尚不存在。

- [ ] **Step 3: 写最小实现**

```ts
export const LOCAL_SHELL_COMMAND = 'local-shell';

const LOCAL_SHELL_EXECUTABLES = new Set([
  LOCAL_SHELL_COMMAND,
  'zsh',
  'bash',
  'powershell',
  'powershell.exe',
  'pwsh',
  'pwsh.exe',
]);

const SUPPORTED_SESSION_EXECUTABLES = new Set([
  'claude',
  'claude.exe',
  'codex',
  'codex.exe',
  ...LOCAL_SHELL_EXECUTABLES,
]);

export function commandExecutableName(command: string): string {
  const executable = command.trim().split(/\s+/)[0] ?? '';
  const normalized = executable.replace(/\\/g, '/');
  return normalized.split('/').pop() ?? normalized;
}

export function isLocalShellCommand(command: string): boolean {
  return LOCAL_SHELL_EXECUTABLES.has(commandExecutableName(command).toLowerCase());
}

export function isSupportedSessionCommand(command: string): boolean {
  return SUPPORTED_SESSION_EXECUTABLES.has(
    commandExecutableName(command).toLowerCase(),
  );
}
```

- [ ] **Step 4: 运行测试并确认 GREEN**

Run: `npx vitest run tests/app/sessionCommands.test.ts`

Expected: `1 file / 3 tests passed`。

- [ ] **Step 5: 提交**

```bash
git add src/shared/sessionCommands.ts tests/app/sessionCommands.test.ts
git commit -m "feat: define cross-platform session commands"
```

## Task 2：让 PTY adapter 支持 PowerShell/ConPTY

**Files:**
- Modify: `src/main/adapters/ptyAdapter.ts`
- Modify: `tests/app/ptyAdapter.test.ts`

- [ ] **Step 1: 为 Windows spawn 和 PATH 写失败测试**

在 `tests/app/ptyAdapter.test.ts` 增加：

```ts
it('spawns agent commands through PowerShell on Windows without Unix syntax', async () => {
  const spawnCalls: SpawnCall[] = [];
  const adapter = createNodePtyAdapter({
    platform: 'win32',
    shell: 'powershell.exe',
    baseEnv: { Path: 'C:\\Windows\\System32', USERPROFILE: 'C:\\Users\\example' },
    ensureHelper: false,
    module: fakeNodePty(spawnCalls),
  });

  await adapter.spawn({
    sessionId: 'session-win-claude',
    command: 'claude --dangerously-skip-permissions',
    cwd: 'C:\\work\\AgentDock',
    env: {},
  });

  expect(spawnCalls[0]?.file).toBe('powershell.exe');
  expect(spawnCalls[0]?.args).toEqual([
    '-NoLogo',
    '-NoProfile',
    '-Command',
    'claude --dangerously-skip-permissions',
  ]);
  expect(spawnCalls[0]?.args.join(' ')).not.toContain('-lc');
  expect(spawnCalls[0]?.args.join(' ')).not.toContain('export PATH');
  expect(spawnCalls[0]?.options.env.Path).toBe('C:\\Windows\\System32');
  expect(spawnCalls[0]?.options.env.PATH).toBeUndefined();
});

it('opens the default PowerShell directly for local-shell on Windows', async () => {
  const spawnCalls: SpawnCall[] = [];
  const adapter = createNodePtyAdapter({
    platform: 'win32',
    shell: 'powershell.exe',
    baseEnv: { Path: 'C:\\Windows\\System32' },
    ensureHelper: false,
    module: fakeNodePty(spawnCalls),
  });

  await adapter.spawn({
    sessionId: 'session-win-shell',
    command: 'local-shell',
    cwd: 'C:\\work\\AgentDock',
    env: {},
  });

  expect(spawnCalls[0]?.file).toBe('powershell.exe');
  expect(spawnCalls[0]?.args).toEqual(['-NoLogo']);
});
```

把测试内重复的 fake node-pty 收敛为：

```ts
function fakeNodePty(spawnCalls: SpawnCall[]) {
  return {
    spawn(file: string, args: string[], options: SpawnCall['options']) {
      spawnCalls.push({ file, args, options });
      return {
        write() {}, resize() {}, kill() {},
        onData() { return { dispose() {} }; },
        onExit() { return { dispose() {} }; },
      };
    },
  };
}
```

- [ ] **Step 2: 运行 Windows 聚焦测试并确认 RED**

Run: `npx vitest run tests/app/ptyAdapter.test.ts -t "Windows|PowerShell"`

Expected: FAIL，`NodePtyAdapterOptions` 没有 `platform`，且当前实现仍生成 `-lc`/`export PATH`。

- [ ] **Step 3: 实现平台分支**

在 `NodePtyAdapterOptions` 增加：

```ts
platform?: NodeJS.Platform;
```

导入共享合同，并增加以下职责明确的函数：

```ts
import {
  LOCAL_SHELL_COMMAND,
  isLocalShellCommand,
} from '../../shared/sessionCommands.js';

function defaultShell(platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    return 'powershell.exe';
  }
  return process.env.SHELL ?? '/bin/zsh';
}

function pathEnvironmentKey(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
): string {
  if (platform !== 'win32') {
    return 'PATH';
  }
  return [...Object.keys(env)].reverse().find((key) => key.toLowerCase() === 'path') ?? 'Path';
}

function commonCliPaths(platform: NodeJS.Platform): string[] {
  return platform === 'win32' ? [] : COMMON_CLI_PATHS;
}

function shellSpawn(
  command: string,
  shell: string,
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
): { file: string; args: string[] } {
  if (isLocalShellCommand(command)) {
    const localShell = command === LOCAL_SHELL_COMMAND ? shell : command;
    return platform === 'win32'
      ? { file: localShell, args: ['-NoLogo'] }
      : { file: localShell, args: ['-l'] };
  }
  if (platform === 'win32') {
    return { file: shell, args: ['-NoLogo', '-NoProfile', '-Command', command] };
  }
  return { file: shell, args: ['-lc', commandWithPathExport(command, env)] };
}

function bridgeNodePtySession(
  sessionId: string,
  pty: NodePtyProcess,
): PtySession {
  return {
    id: sessionId,
    write(input) { pty.write(input); },
    resize(cols, rows) { pty.resize(cols, rows); },
    kill() { pty.kill(); },
    onData(listener) {
      const disposable = pty.onData(listener);
      return () => disposable.dispose();
    },
    onExit(listener) {
      const disposable = pty.onExit?.(listener);
      return () => disposable?.dispose();
    },
  };
}
```

`buildPtyEnvironment` 完整替换为平台感知版本，使用 `HOME ?? USERPROFILE`，只在非 Windows 注入 Unix 目录，并保留 `Path` 键大小写：

```ts
function buildPtyEnvironment(
  baseEnv: Record<string, string | undefined>,
  env: Record<string, string>,
  platform: NodeJS.Platform,
): Record<string, string | undefined> {
  const mergedEnv = { ...baseEnv, ...env };
  for (const key of MANAGED_AGENT_ENV_KEYS) {
    if (!(key in env)) {
      delete mergedEnv[key];
    }
  }

  const pathKey = pathEnvironmentKey(mergedEnv, platform);
  const originalPath = mergedEnv[pathKey] ?? '';
  const homeDir = mergedEnv.HOME ?? mergedEnv.USERPROFILE;
  for (const key of Object.keys(mergedEnv)) {
    if (key !== pathKey && key.toLowerCase() === 'path') {
      delete mergedEnv[key];
    }
  }
  mergedEnv[pathKey] = uniquePathEntries([
    ...(platform === 'win32' ? [] : userCliPaths(homeDir)),
    ...originalPath.split(path.delimiter),
    ...commonCliPaths(platform),
  ]).join(path.delimiter);
  return mergedEnv;
}
```

`createNodePtyAdapter` 固定本次 platform，并让 `spawn` 使用 `shellSpawn`：

```ts
export function createNodePtyAdapter({
  module = loadNodePty(),
  platform = process.platform,
  shell = defaultShell(platform),
  baseEnv = process.env,
  ensureHelper = true,
}: NodePtyAdapterOptions = {}): PtyAdapter {
  if (ensureHelper) {
    ensureNodePtySpawnHelperExecutable();
  }
  return {
    async spawn({ sessionId, command, cwd, env }) {
      const ptyEnv = buildPtyEnvironment(baseEnv, env, platform);
      const spawnRequest = shellSpawn(command, shell, platform, ptyEnv);
      const pty = module.spawn(spawnRequest.file, spawnRequest.args, {
        name: 'xterm-256color', cwd, env: ptyEnv,
      });
      return bridgeNodePtySession(sessionId, pty);
    },
  };
}
```

- [ ] **Step 4: 运行 PTY 测试**

Run: `npx vitest run tests/app/ptyAdapter.test.ts`

Expected: 全部通过；现有 macOS PATH 优先、zsh login shell 和 spawn-helper 测试不得回归。

- [ ] **Step 5: 提交**

```bash
git add src/main/adapters/ptyAdapter.ts tests/app/ptyAdapter.test.ts
git commit -m "feat: launch Windows sessions through PowerShell"
```

## Task 3：接入 `local-shell` 到 Renderer、Main 和 SessionService

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/components/CommandBar.tsx`
- Modify: `src/main/main.ts`
- Modify: `src/main/sessionService.ts`
- Modify: `tests/app/App.test.tsx`
- Modify: `tests/app/sessionServiceTerminal.test.ts`
- Modify: `tests/app/mainSessionLaunchWiring.test.ts`

- [ ] **Step 1: 更新测试为平台无关语义并确认 RED**

把 App 测试中的 `command: 'zsh'` 改为：

```ts
expect(api.launchSession).toHaveBeenCalledWith({
  profileId: 'profile-a',
  workspaceId: 'workspace-a',
  command: 'local-shell',
});
```

把 UI 文案断言改为：

```ts
expect(screen.getByLabelText('Claude 启动模式')).toHaveTextContent('本地终端');
expect(screen.getByLabelText('Claude 启动模式')).not.toHaveTextContent('zsh');
```

在 `sessionServiceTerminal.test.ts` 增加/修改：

```ts
it('launches local-shell without reading API secrets', async () => {
  // 复用现有 fake keychain/pty setup
  const session = await service.launch({ profile, workspace, command: 'local-shell' });
  expect(readSecretCalled).toBe(false);
  expect(spawnedCommands).toEqual(['local-shell']);
  expect(session.status).toBe('running');
});
```

Run: `npx vitest run tests/app/App.test.tsx tests/app/sessionServiceTerminal.test.ts`

Expected: FAIL，Renderer 仍发送 `zsh`，Main/SessionService 尚未共享合同。

- [ ] **Step 2: 替换重复判断**

`App.tsx` 导入：

```ts
import {
  LOCAL_SHELL_COMMAND,
  commandExecutableName,
  isLocalShellCommand,
} from '../shared/sessionCommands';
```

启动命令改为：

```ts
const command = launchMode === 'local-shell'
  ? LOCAL_SHELL_COMMAND
  : defaultCommandFor(selectedProfile);
```

终端历史模式改为：

```tsx
preserveHistory={activeSession ? !isLocalShellCommand(activeSession.command) : true}
```

删除 `App.tsx` 本地重复的 `commandExecutableName`。

`CommandBar.tsx` 的两个选项统一为：

```tsx
<option value="local-shell">本地终端</option>
```

`main.ts` 和 `sessionService.ts` 导入 `isLocalShellCommand`；`main.ts` 的命令校验使用 `isSupportedSessionCommand(command)`，保留现有 shell 控制字符扫描：

```ts
if (!isSupportedSessionCommand(command)) {
  throw new Error(`不支持的会话命令: ${commandExecutableName(command) || '(空)'}`);
}
```

- [ ] **Step 3: 运行聚焦测试**

Run: `npx vitest run tests/app/sessionCommands.test.ts tests/app/App.test.tsx tests/app/sessionServiceTerminal.test.ts tests/app/mainSessionLaunchWiring.test.ts`

Expected: PASS。

- [ ] **Step 4: 运行类型检查**

Run: `npm run typecheck`

Expected: PASS；不存在 Main/Renderer ESM import 扩展名错误。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/App.tsx src/renderer/components/CommandBar.tsx src/main/main.ts src/main/sessionService.ts tests/app/App.test.tsx tests/app/sessionServiceTerminal.test.ts tests/app/mainSessionLaunchWiring.test.ts
git commit -m "feat: use a platform-neutral local shell"
```

## Task 4：隔离 macOS ccline 并恢复 Windows 原生标题栏

**Files:**
- Modify: `src/main/cclineLocator.ts`
- Modify: `src/main/sessionService.ts`
- Modify: `src/main/main.ts`
- Modify: `tests/app/cclineLocator.test.ts`
- Modify: `tests/app/sessionService.test.ts`
- Modify: `tests/app/windowChrome.test.ts`

- [ ] **Step 1: 写 Windows RED 测试**

```ts
it('disables the macOS bundled fallback on Windows', () => {
  const command = resolveCclineCommand({
    platform: 'win32',
    homeDir: 'C:\\Users\\example',
    envPath: 'C:\\Tools',
    bundledPackageRoot: '/app/node_modules/@cometix/ccline-darwin-arm64',
    fileStats: statsFor({
      '/app/node_modules/@cometix/ccline-darwin-arm64/ccline': EXECUTABLE,
    }),
  });
  expect(command).toBeUndefined();
});
```

SessionService 测试：

```ts
it('omits statusLine when ccline is unavailable on the current platform', async () => {
  const service = createSessionService({
    ...options,
    resolveCclineCommand: () => undefined,
  });
  await service.launch({
    profile: { ...profile, claudeCclineStatusLineEnabled: true },
    workspace,
    command: 'claude',
  });
  expect(writtenFiles[0]?.content).not.toContain('statusLine');
});
```

Window 测试改为同时要求：

```ts
expect(mainSource).toMatch(
  /\.\.\.\(process\.platform === 'darwin' \? \{ titleBarStyle: 'hidden' \} : \{\}\)/,
);
expect(mainSource).not.toMatch(/^\s*titleBarStyle:\s*'hidden',/m);
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npx vitest run tests/app/cclineLocator.test.ts tests/app/sessionService.test.ts tests/app/windowChrome.test.ts`

Expected: FAIL，resolver 没有 platform，且 BrowserWindow 始终隐藏标题栏。

- [ ] **Step 3: 实现平台门控**

`ResolveCclineCommandInput` 增加：

```ts
platform?: NodeJS.Platform;
```

函数签名改为 `string | undefined`，开头增加：

```ts
platform = process.platform,
// ...
if (platform !== 'darwin') {
  return undefined;
}
```

`CreateSessionServiceOptions.resolveCclineCommand` 及正规化类型改为 `() => string | undefined`。`buildClaudeSettings` 仅在 resolver 返回字符串时写入：

```ts
if (profile.claudeCclineStatusLineEnabled === true) {
  const cclineCommand = resolveCclineCommand();
  if (cclineCommand) {
    settings.statusLine = {
      type: 'command',
      command: shellSafeStatusLineCommand(cclineCommand),
      padding: 0,
    };
  }
}
```

BrowserWindow options 改为：

```ts
const window = new BrowserWindow({
  width: 1280,
  height: 820,
  minWidth: 720,
  minHeight: 480,
  resizable: true,
  title: 'AgentDock 代理坞',
  ...(process.platform === 'darwin' ? { titleBarStyle: 'hidden' } : {}),
  backgroundColor: '#f6f7fb',
  // webPreferences 保持不变
});
```

- [ ] **Step 4: 运行聚焦测试和类型检查**

Run: `npx vitest run tests/app/cclineLocator.test.ts tests/app/sessionService.test.ts tests/app/windowChrome.test.ts && npm run typecheck`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/main/cclineLocator.ts src/main/sessionService.ts src/main/main.ts tests/app/cclineLocator.test.ts tests/app/sessionService.test.ts tests/app/windowChrome.test.ts
git commit -m "fix: isolate macOS-only runtime behavior"
```

## Task 5：增加共享打包支持和 Windows x64 ZIP

**Files:**
- Create: `scripts/package-support.mjs`
- Create: `scripts/package-win.mjs`
- Create: `tests/app/packageWindowsScript.test.ts`
- Modify: `scripts/package-mac.mjs`
- Modify: `tests/app/packageMacScript.test.ts`
- Modify: `tests/app/packageMacBuildInfo.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/preload/preload.cts`
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: 写 Windows/版本/双平台 ZIP RED 合同**

`tests/app/packageWindowsScript.test.ts`：

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Windows package script', () => {
  it('builds a timestamped win32 x64 portable zip without new dependencies', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
    const script = readFileSync('scripts/package-win.mjs', 'utf8');
    const preload = readFileSync('src/preload/preload.cts', 'utf8');
    const app = readFileSync('src/renderer/App.tsx', 'utf8');

    expect(packageJson.version).toBe('0.1.1');
    expect(lock.version).toBe('0.1.1');
    expect(lock.packages[''].version).toBe('0.1.1');
    expect(packageJson.scripts['package:win']).toBe(
      'npm run build && node scripts/package-win.mjs',
    );
    expect(script).toContain("'--platform=win32'");
    expect(script).toContain("'--arch=x64'");
    expect(script).toContain('*.node,*.exe');
    expect(script).toContain('@cometix/ccline-darwin-arm64');
    expect(script).toContain('AgentDock-v${version}-windows-x64.zip');
    expect(script).toContain('prebuilds/win32-x64');
    expect(preload).toContain("version: '0.1.1'");
    expect(app).toContain("version: '0.1.1'");
  });
});
```

扩展 `packageMacScript.test.ts`：

```ts
expect(script).toContain('AgentDock-v${version}-macos-arm64.zip');
expect(script).toContain("run('ditto'");
expect(script).toContain("from './package-support.mjs'");
```

`packageMacBuildInfo.test.ts` 的动态 import 改为：

```ts
const { createBuildInfo } = await import('../../scripts/package-support.mjs');
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npx vitest run tests/app/packageWindowsScript.test.ts tests/app/packageMacScript.test.ts tests/app/packageMacBuildInfo.test.ts`

Expected: FAIL，Windows 脚本不存在，版本仍为 `0.1.0`，macOS 尚不生成 ZIP。

- [ ] **Step 3: 创建共享打包 helper**

`scripts/package-support.mjs` 提供：

```js
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

export const DEFAULT_OUTPUT_ROOT = 'release/packages';

export function timestamp(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

export function createBuildInfo({ version, buildId, buildTime, commit, dirty }) {
  return {
    version,
    buildId,
    buildTime: buildTime.toISOString(),
    commit,
    commitShort: commit === 'unknown' ? 'unknown' : commit.slice(0, 7),
    dirty,
  };
}

export function packageVersion() {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
  if (typeof packageJson.version !== 'string' || !packageJson.version) {
    throw new Error('package.json version is missing');
  }
  return packageJson.version;
}

export function gitCommit() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : 'unknown';
}

export function gitDirty() {
  const result = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' });
  return result.status === 0 && result.stdout.trim().length > 0;
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status ?? 1}`);
  }
}

export function writeBuildInfo(filePath, buildInfo) {
  writeFileSync(filePath, `${JSON.stringify(buildInfo, null, 2)}\n`);
}
```

- [ ] **Step 4: 创建 Windows 打包脚本**

`scripts/package-win.mjs` 必须：

```js
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_OUTPUT_ROOT,
  createBuildInfo,
  gitCommit,
  gitDirty,
  packageVersion,
  run,
  timestamp,
  writeBuildInfo,
} from './package-support.mjs';

const outputRoot = process.env.AGENTDOCK_PACKAGE_OUT || DEFAULT_OUTPUT_ROOT;
const buildTime = new Date();
const buildId = timestamp(buildTime);
const version = packageVersion();
const outputDirectory = path.join(outputRoot, buildId);
const appDirectoryName = 'AgentDock-win32-x64';
const appDirectory = path.join(outputDirectory, appDirectoryName);
const resourcesDirectory = path.join(appDirectory, 'resources');
const archiveName = `AgentDock-v${version}-windows-x64.zip`;
const archivePath = path.join(outputDirectory, archiveName);

if (existsSync(outputDirectory)) {
  throw new Error(`Package output directory already exists: ${outputDirectory}`);
}
mkdirSync(outputDirectory, { recursive: true });

run('npx', [
  '--no-install', 'electron-packager', '.', 'AgentDock',
  '--platform=win32', '--arch=x64', `--out=${outputDirectory}`,
  '--prune=true', '--asar.unpack=**/{*.node,*.exe}',
  '--ignore=^/node_modules/@cometix/ccline-darwin-arm64(/|$)|^/(src|tests|docs|scripts|release|\\.agent-workflow|\\.agentdock|\\.claude|\\.git|\\.pytest_cache)(/|$)|^/\\.env(?:\\..*)?$|^/.*\\.log$',
]);

const buildInfo = createBuildInfo({
  version, buildId, buildTime, commit: gitCommit(), dirty: gitDirty(),
});
writeBuildInfo(path.join(resourcesDirectory, 'build-info.json'), buildInfo);

for (const requiredPath of [
  path.join(appDirectory, 'AgentDock.exe'),
  path.join(resourcesDirectory, 'app.asar'),
  path.join(resourcesDirectory, 'app.asar.unpacked', 'node_modules', 'node-pty', 'prebuilds', 'win32-x64', 'pty.node'),
  path.join(resourcesDirectory, 'app.asar.unpacked', 'node_modules', 'node-pty', 'prebuilds', 'win32-x64', 'conpty', 'OpenConsole.exe'),
]) {
  if (!existsSync(requiredPath)) {
    throw new Error(`Windows package is missing required file: ${requiredPath}`);
  }
}

run('zip', ['-qry', archiveName, appDirectoryName], { cwd: outputDirectory });
console.log(`AgentDock Windows package: ${archivePath}`);
```

- [ ] **Step 5: 扩展 macOS 脚本并升级版本**

`package-mac.mjs` 从 `package-support.mjs` 导入共享函数，保留 `resolveSigningIdentity`，签名成功后执行：

```js
const archivePath = path.join(
  outputDirectory,
  `AgentDock-v${buildInfo.version}-macos-arm64.zip`,
);
run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, archivePath]);
console.log(`AgentDock macOS package: ${archivePath}`);
```

使用 npm 自带版本同步，不创建 tag：

Run: `npm version 0.1.1 --no-git-tag-version`

然后在 `package.json` scripts 增加：

```json
"package:win": "npm run build && node scripts/package-win.mjs"
```

同步两个仅用于无 Main API/开发预览的 fallback：

```ts
// src/preload/preload.cts
version: '0.1.1',

// src/renderer/App.tsx fallbackBuildInfo
version: '0.1.1',
```

确认依赖对象与修改前完全一致。

- [ ] **Step 6: 运行打包合同测试和类型检查**

Run: `npx vitest run tests/app/packageWindowsScript.test.ts tests/app/packageMacScript.test.ts tests/app/packageMacBuildInfo.test.ts && npm run typecheck`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add scripts/package-support.mjs scripts/package-win.mjs scripts/package-mac.mjs tests/app/packageWindowsScript.test.ts tests/app/packageMacScript.test.ts tests/app/packageMacBuildInfo.test.ts package.json package-lock.json src/preload/preload.cts src/renderer/App.tsx
git commit -m "build: add v0.1.1 Windows portable packaging"
```

## Task 6：更新预发布文档并完成代码质量闸门

**Files:**
- Modify: `README.md`
- Modify: `PROJECT_PROFILE.md`
- Modify: `DECISIONS.md`
- Modify: `.agent-workflow/state.md`

- [ ] **Step 1: 更新 README 的发布前说明**

在生成真实 hash 前，README 写确定信息，不写占位 hash：

```markdown
## 下载与安装

最新预发布版本：v0.1.1

- macOS Apple Silicon：`AgentDock-v0.1.1-macos-arm64.zip`
- Windows 10/11 x64 便携验证包：`AgentDock-v0.1.1-windows-x64.zip`

下载地址：
https://github.com/peyoba/AgentDock/releases/tag/v0.1.1

Windows 包无安装向导、无代码签名；请完整解压后运行 `AgentDock.exe`。
Windows 真机验证矩阵尚未完成，首次版本按便携验证包发布。
```

SHA-256 小节先说明“以 v0.1.1 Release notes 为准”；真实值在 Task 9 发布后写回。

- [ ] **Step 2: 更新项目画像和决策**

`PROJECT_PROFILE.md` 增加：

```markdown
| Windows x64 打包 | `npm run package:win` | 输出便携目录与版本化 ZIP；不生成安装器 |
```

部署信息改为 `macOS arm64 + Windows x64 Preview`，并明确 Windows 真机验证仍为 PARTIAL。

`DECISIONS.md` 增加 2026-07-16 决策：

```markdown
| 2026-07-16 | v0.1.1 采用 macOS arm64 + Windows x64 便携 ZIP 双平台 Pre-release；Windows 不引入安装器依赖或签名 | 用户要求两个平台都上传且越简单越好；新 tag 保证新包不混入旧 v0.1.0 commit | 版本、打包、README、GitHub Release |
```

- [ ] **Step 3: 运行全量代码闸门**

Run:

```bash
npm run workflow:doctor
npm run test:workflow
npm test
npm run typecheck
npm run build
git diff --check
```

Expected: workflow doctor PASS；pytest 8 passed；Vitest 0 failures；typecheck/build exit 0；diff check 无输出。

- [ ] **Step 4: 执行安全扫描**

Run:

```bash
rg -n --hidden --glob '!node_modules/**' --glob '!release/**' --glob '!dist/**' '(sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY)' .
```

Expected: 无真实 secret；文档环境变量名称和测试固定假值需人工确认不是凭证。

- [ ] **Step 5: 提交并推送发布候选代码**

```bash
git add README.md PROJECT_PROFILE.md DECISIONS.md
git commit -m "docs: prepare v0.1.1 dual-platform preview"
git push origin main
```

`.agent-workflow/state.md` 按规则更新但保持本地忽略，不加入 Git。

## Task 7：从干净提交生成并验证双平台包

**Files:**
- Create: `.agent-workflow/verification/2026-07-16-agentdock-v0.1.1-dual-platform-prerelease.md`
- Output pattern: `release/packages/YYYYMMDD-HHMMSS/AgentDock-v0.1.1-macos-arm64.zip`
- Output pattern: `release/packages/YYYYMMDD-HHMMSS/AgentDock-v0.1.1-windows-x64.zip`

- [ ] **Step 1: 冻结构建 commit**

Run:

```bash
git fetch --prune
git status --short --branch
git rev-list --left-right --count HEAD...origin/main
git rev-parse HEAD
```

Expected: 工作区无 tracked/untracked 变更；ahead/behind 为 `0 0`。记录 `RELEASE_COMMIT`。

- [ ] **Step 2: 构建 Windows ZIP**

Run: `npm run package:win`

Expected: 新时间戳目录包含 `AgentDock-win32-x64/` 和 `AgentDock-v0.1.1-windows-x64.zip`；日志 build-info 显示 `dirty` 为 false。

- [ ] **Step 3: 构建 macOS ZIP**

Run: `npm run package:mac`

Expected: 新时间戳目录包含签名后的 `AgentDock.app` 和 `AgentDock-v0.1.1-macos-arm64.zip`。

- [ ] **Step 4: 验证 Windows 结构**

先解析本轮最新产物路径：

```bash
WIN_ARCHIVE=$(find release/packages -type f -name 'AgentDock-v0.1.1-windows-x64.zip' -print0 | xargs -0 ls -t | head -1)
WIN_OUTPUT=$(dirname "$WIN_ARCHIVE")
WIN_APP="$WIN_OUTPUT/AgentDock-win32-x64"
MAC_ARCHIVE=$(find release/packages -type f -name 'AgentDock-v0.1.1-macos-arm64.zip' -print0 | xargs -0 ls -t | head -1)
MAC_OUTPUT=$(dirname "$MAC_ARCHIVE")
MAC_APP="$MAC_OUTPUT/AgentDock-darwin-arm64/AgentDock.app"
test -n "$WIN_ARCHIVE" && test -n "$MAC_ARCHIVE"
```

Run:

```bash
file "$WIN_APP/AgentDock.exe"
unzip -l "$WIN_ARCHIVE" | rg 'AgentDock.exe|resources/app.asar$|build-info.json|node-pty/.*/win32-x64/.*(\.node|\.exe)$'
if npx --no-install asar list "$WIN_APP/resources/app.asar" | rg -q '@cometix/ccline-darwin-arm64'; then
  echo 'Windows app.asar unexpectedly contains macOS ccline' >&2
  exit 1
fi
```

Expected: `AgentDock.exe` 为 PE32+ x86-64；ZIP 有必需文件；asar 不含 macOS ccline 包。

- [ ] **Step 5: 验证 macOS 签名和 ZIP**

Run:

```bash
codesign --verify --deep --strict --verbose=2 "$MAC_APP"
unzip -t "$MAC_ARCHIVE"
```

Expected: codesign valid；ZIP test 无错误。

- [ ] **Step 6: 核对同源 build-info**

Run:

```bash
node -e "const fs=require('fs'); const a=JSON.parse(fs.readFileSync(process.argv[1])); const b=JSON.parse(fs.readFileSync(process.argv[2])); console.log({mac:a,win:b}); if(a.version!=='0.1.1'||b.version!=='0.1.1'||a.commit!==b.commit||a.dirty||b.dirty) process.exit(1)" \
  "$MAC_APP/Contents/Resources/build-info.json" \
  "$WIN_APP/resources/build-info.json"
```

Expected: 两者 version `0.1.1`、commit 等于 `RELEASE_COMMIT`、dirty false。

- [ ] **Step 7: 扫描产物并计算 hash**

Run:

```bash
MAC_SHA256=$(shasum -a 256 "$MAC_ARCHIVE" | awk '{print $1}')
WIN_SHA256=$(shasum -a 256 "$WIN_ARCHIVE" | awk '{print $1}')
printf 'MAC_SHA256=%s\nWIN_SHA256=%s\n' "$MAC_SHA256" "$WIN_SHA256"
if strings "$WIN_APP/resources/app.asar" | rg -q '/Users/peyoba|Desktop/web/AgentDock|BEGIN PRIVATE KEY'; then
  echo 'Windows package contains a forbidden local path or private key marker' >&2
  exit 1
fi
```

Expected: 得到两个 SHA-256；限定敏感路径/私钥扫描无输出。记录文件大小、buildId、commit、hash。

- [ ] **Step 8: 写真实验证记录**

使用 `.agent-workflow/templates/verification.md` 写明：

- 自动化、typecheck、build 结果。
- macOS codesign 和 ZIP 结果。
- Windows PE、node-pty win32-x64 原生文件、asar 排除结果。
- Windows GUI/ConPTY/中文输入/Ctrl+C/vault 真机验证为 PARTIAL，原因是当前宿主为 macOS。
- 两个平台的实际路径、大小、SHA-256 和 `RELEASE_COMMIT`。

## Task 8：创建 v0.1.1 tag 和 GitHub Pre-release

**Files:**
- Create: `.agent-workflow/release-notes/2026-07-16-v0.1.1.md`

- [ ] **Step 1: 创建 Release notes**

先重新解析产物、commit 和 hash，避免依赖上一条 shell 会话：

```bash
RELEASE_COMMIT=$(git rev-parse HEAD)
WIN_ARCHIVE=$(find release/packages -type f -name 'AgentDock-v0.1.1-windows-x64.zip' -print0 | xargs -0 ls -t | head -1)
MAC_ARCHIVE=$(find release/packages -type f -name 'AgentDock-v0.1.1-macos-arm64.zip' -print0 | xargs -0 ls -t | head -1)
MAC_SHA256=$(shasum -a 256 "$MAC_ARCHIVE" | awk '{print $1}')
WIN_SHA256=$(shasum -a 256 "$WIN_ARCHIVE" | awk '{print $1}')
test -n "$RELEASE_COMMIT" && test -n "$WIN_ARCHIVE" && test -n "$MAC_ARCHIVE"
```

内容必须直接写入 Task 7 计算出的实际 hash：

```markdown
# AgentDock v0.1.1

## 下载

- macOS Apple Silicon: `AgentDock-v0.1.1-macos-arm64.zip`
  - SHA-256: `${MAC_SHA256}`
- Windows 10/11 x64 portable preview: `AgentDock-v0.1.1-windows-x64.zip`
  - SHA-256: `${WIN_SHA256}`

## Windows 说明

Windows 包是首次便携验证版本：无安装向导、无代码签名。请完整解压后运行 `AgentDock.exe`，并确保 Claude/Codex CLI 已能在 PowerShell 中直接启动。

Windows GUI、ConPTY、Ctrl+C、中文输入、resize 和 vault 真机矩阵仍待 Windows 10/11 x64 复验；macOS arm64 包已完成构建与签名验证。
```

使用 `apply_patch` 创建文件时，把 `${MAC_SHA256}` 和 `${WIN_SHA256}` 写成 Task 7 命令刚刚输出的 64 位真实值；不要把变量名原样写入 Release notes。

- [ ] **Step 2: 最后检查 tag 不存在且 commit 正确**

Run:

```bash
git tag -l v0.1.1
git rev-parse HEAD
git status --short --branch
```

Expected: `v0.1.1` 无输出；HEAD 等于 `RELEASE_COMMIT`；工作区干净。

- [ ] **Step 3: 创建并推送 annotated tag**

```bash
git tag -a v0.1.1 -m "AgentDock v0.1.1 dual-platform preview"
git push origin v0.1.1
```

- [ ] **Step 4: 创建 GitHub Pre-release 并上传两个包**

在同一个 shell 调用中重新设置需要的变量：

```bash
RELEASE_COMMIT=$(git rev-parse v0.1.1^{})
WIN_ARCHIVE=$(find release/packages -type f -name 'AgentDock-v0.1.1-windows-x64.zip' -print0 | xargs -0 ls -t | head -1)
MAC_ARCHIVE=$(find release/packages -type f -name 'AgentDock-v0.1.1-macos-arm64.zip' -print0 | xargs -0 ls -t | head -1)
gh release create v0.1.1 \
  "$MAC_ARCHIVE#AgentDock v0.1.1 · macOS Apple Silicon" \
  "$WIN_ARCHIVE#AgentDock v0.1.1 · Windows x64 Portable Preview" \
  --repo peyoba/AgentDock \
  --title "AgentDock v0.1.1 (macOS arm64 + Windows x64 Preview)" \
  --notes-file .agent-workflow/release-notes/2026-07-16-v0.1.1.md \
  --prerelease \
  --target "$RELEASE_COMMIT"
```

- [ ] **Step 5: 远端核验**

Run:

```bash
gh release view v0.1.1 --repo peyoba/AgentDock --json tagName,isDraft,isPrerelease,publishedAt,targetCommitish,assets,url
git ls-remote origin refs/tags/v0.1.1 refs/tags/v0.1.1^{}
```

Expected:

- `isDraft=false`
- `isPrerelease=true`
- 两个 asset 的 `state=uploaded`
- asset 名称、大小与本地一致
- annotated tag peeled commit 等于 `RELEASE_COMMIT`

## Task 9：回填 README hash、完成交付和同步

**Files:**
- Modify: `README.md`
- Modify: `.agent-workflow/state.md`
- Create: `.agent-workflow/delivery/2026-07-16-agentdock-v0.1.1-dual-platform-prerelease-delivery-report.md`

- [ ] **Step 1: 回填 README 的真实 SHA-256**

把“以 Release notes 为准”替换为：

````markdown
`AgentDock-v0.1.1-macos-arm64.zip` SHA-256：

```text
${MAC_SHA256}
```

`AgentDock-v0.1.1-windows-x64.zip` SHA-256：

```text
${WIN_SHA256}
```

使用 `apply_patch` 更新 README 时，把上述变量表达式替换为 Task 7 输出的真实 64 位值，不能把 `${MAC_SHA256}` 或 `${WIN_SHA256}` 原样提交。
````

说明 README hash 提交发生在 release tag 之后；`v0.1.1` tag 仍必须固定指向实际构建 commit，不因 README 后续提交移动。

- [ ] **Step 2: 运行文档后最终验证**

Run:

```bash
npm run workflow:doctor
npm run typecheck
npm run build
git diff --check
```

Expected: 全部 PASS。

- [ ] **Step 3: 提交 README hash 并推送 main**

```bash
git add README.md
git commit -m "docs: publish v0.1.1 package checksums"
git push origin main
```

- [ ] **Step 4: 执行 delivery_hook**

使用 `.agent-workflow/templates/delivery-report.md`，至少记录：

- L3 角色与 handoff 结论。
- 修改文件清单。
- 全量测试、workflow、typecheck、build。
- macOS codesign 和两个 ZIP hash。
- Git tag、Release URL、asset 名称/大小/state。
- Windows 真机未验证项目，结论为“Windows x64 便携验证包，有条件交付”。
- 回滚方式：撤下 v0.1.1 Release；不删除 v0.1.0；远端 tag 删除必须再次获得用户授权。

- [ ] **Step 5: 最终同步核验**

Run:

```bash
git fetch --prune
git status --short --branch
git rev-list --left-right --count HEAD...origin/main
gh release view v0.1.1 --repo peyoba/AgentDock --json assets,url,isPrerelease
```

Expected: 工作区干净；main `0 ahead / 0 behind`；Release 仍有两个 uploaded assets。

## 计划审查结论

- SPEC 覆盖：Windows PowerShell/ConPTY、本地 shell、PATH、ccline、窗口标题栏、win32-x64 原生文件、版本、双平台同源构建、tag、Release、SHA-256、文档和回滚均有对应 Task。
- 依赖边界：不新增或升级 npm 依赖；仅增加 npm script 和项目版本字段。
- 发布顺序：构建提交先冻结并打 tag；README 真实 hash 在发布后单独提交，避免形成 hash/commit 循环。
- 真机边界：macOS 可证明交叉包结构，但不能替代 Windows GUI/ConPTY 真实验收；交付报告必须保留 PARTIAL。
