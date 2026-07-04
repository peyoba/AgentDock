import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

export type PtySpawnRequest = {
  sessionId: string;
  command: string;
  cwd: string;
  env: Record<string, string>;
};

export type PtyDataHandler = (data: string) => void;

export type PtyExitEvent = { exitCode: number; signal?: number };

export type PtyExitHandler = (event: PtyExitEvent) => void;

export type PtySession = {
  id: string;
  write(input: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(listener: PtyDataHandler): () => void;
  onExit?(listener: PtyExitHandler): () => void;
};

export type PtyAdapter = {
  spawn(request: PtySpawnRequest): Promise<PtySession>;
};

type NodePtyProcess = {
  write(input: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(listener: PtyDataHandler): { dispose(): void };
  onExit?(listener: PtyExitHandler): { dispose(): void };
};

export type NodePtyLike = {
  spawn(
    file: string,
    args: string[],
    options: {
      name: string;
      cwd: string;
      env: Record<string, string | undefined>;
    },
  ): NodePtyProcess;
};

export type NodePtyAdapterOptions = {
  module?: NodePtyLike;
  shell?: string;
  baseEnv?: Record<string, string | undefined>;
  ensureHelper?: boolean;
};

export type EnsureNodePtySpawnHelperInput = {
  packageRoot?: string;
  platform?: NodeJS.Platform;
  arch?: NodeJS.Architecture;
};

const COMMON_CLI_PATHS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
];

const MANAGED_AGENT_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'CODEX_HOME',
];

function loadNodePty(): NodePtyLike {
  return require('node-pty') as NodePtyLike;
}

function resolveNodePtyPackageRoot(): string {
  return path.dirname(require.resolve('node-pty/package.json'));
}

export function ensureNodePtySpawnHelperExecutable({
  packageRoot = resolveNodePtyPackageRoot(),
  platform = process.platform,
  arch = process.arch,
}: EnsureNodePtySpawnHelperInput = {}): void {
  if (platform !== 'darwin' && platform !== 'linux') {
    return;
  }

  const helperPath = path
    .join(packageRoot, 'prebuilds', `${platform}-${arch}`, 'spawn-helper')
    .replace('app.asar', 'app.asar.unpacked')
    .replace('node_modules.asar', 'node_modules.asar.unpacked');
  if (!fs.existsSync(helperPath)) {
    return;
  }

  const currentMode = fs.statSync(helperPath).mode;
  if ((currentMode & 0o111) === 0) {
    fs.chmodSync(helperPath, currentMode | 0o755);
  }
}

function defaultShell(): string {
  return process.env.SHELL ?? (process.platform === 'win32' ? 'powershell.exe' : '/bin/zsh');
}

function interactiveShellSpawn(command: string): { file: string; args: string[] } | undefined {
  const trimmedCommand = command.trim();
  const shellName = path.basename(trimmedCommand);

  if (shellName === 'zsh' || shellName === 'bash') {
    return { file: trimmedCommand, args: ['-l'] };
  }

  return undefined;
}

function uniquePathEntries(entries: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const uniqueEntries: string[] = [];

  for (const entry of entries) {
    if (!entry || seen.has(entry)) {
      continue;
    }

    seen.add(entry);
    uniqueEntries.push(entry);
  }

  return uniqueEntries;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function userCliPaths(homeDir: string | undefined): string[] {
  if (!homeDir) {
    return [];
  }

  return [
    path.join(homeDir, '.local', 'bin'),
    path.join(homeDir, '.npm-global', 'bin'),
    path.join(homeDir, '.claude', 'bin'),
    path.join(homeDir, '.codex', 'bin'),
    path.join(homeDir, '.opencode', 'bin'),
  ];
}

function buildPtyEnvironment(
  baseEnv: Record<string, string | undefined>,
  env: Record<string, string>,
): Record<string, string | undefined> {
  const mergedEnv = {
    ...baseEnv,
    ...env,
  };
  for (const key of MANAGED_AGENT_ENV_KEYS) {
    if (!(key in env)) {
      delete mergedEnv[key];
    }
  }
  const originalPath = mergedEnv.PATH ?? '';
  const homeDir = mergedEnv.HOME;
  mergedEnv.PATH = uniquePathEntries([
    ...userCliPaths(homeDir),
    ...originalPath.split(path.delimiter),
    ...COMMON_CLI_PATHS,
  ]).join(path.delimiter);

  return mergedEnv;
}

function commandWithPathExport(
  command: string,
  env: Record<string, string | undefined>,
): string {
  if (!env.PATH) {
    return command;
  }

  // 合成 PATH 放在最前保证用户级 CLI 优先，同时把登录 shell 初始化后的
  // "$PATH" 追加在尾部，避免丢失 .zprofile/path_helper 里追加的目录（如 nvm/fnm）
  return `export PATH=${shellQuote(env.PATH)}:"$PATH"; ${command}`;
}

export function createNodePtyAdapter({
  module = loadNodePty(),
  shell = defaultShell(),
  baseEnv = process.env,
  ensureHelper = true,
}: NodePtyAdapterOptions = {}): PtyAdapter {
  if (ensureHelper) {
    ensureNodePtySpawnHelperExecutable();
  }

  return {
    async spawn({ sessionId, command, cwd, env }: PtySpawnRequest): Promise<PtySession> {
      const interactiveShell = interactiveShellSpawn(command);
      const ptyEnv = buildPtyEnvironment(baseEnv, env);
      const ptyArgs = interactiveShell?.args ?? ['-lc', commandWithPathExport(command, ptyEnv)];
      const pty = module.spawn(interactiveShell?.file ?? shell, ptyArgs, {
        name: 'xterm-256color',
        cwd,
        env: ptyEnv,
      });

      return {
        id: sessionId,
        write(input: string): void {
          pty.write(input);
        },
        resize(cols: number, rows: number): void {
          pty.resize(cols, rows);
        },
        kill(): void {
          pty.kill();
        },
        onData(listener: PtyDataHandler): () => void {
          const disposable = pty.onData(listener);
          return () => disposable.dispose();
        },
        onExit(listener: PtyExitHandler): () => void {
          const disposable = pty.onExit?.(listener);
          return () => disposable?.dispose();
        },
      };
    },
  };
}

export function createUnavailablePtyAdapter(): PtyAdapter {
  return {
    async spawn(): Promise<PtySession> {
      throw new Error('PTY adapter is not available in Phase 1');
    },
  };
}
