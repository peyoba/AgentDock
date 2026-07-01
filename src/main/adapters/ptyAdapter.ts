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

export type PtySession = {
  id: string;
  write(input: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(listener: PtyDataHandler): () => void;
};

export type PtyAdapter = {
  spawn(request: PtySpawnRequest): Promise<PtySession>;
};

type NodePtyProcess = {
  write(input: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(listener: PtyDataHandler): { dispose(): void };
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

  const helperPath = path.join(packageRoot, 'prebuilds', `${platform}-${arch}`, 'spawn-helper');
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
      const pty = module.spawn(shell, ['-lc', command], {
        name: 'xterm-256color',
        cwd,
        env: {
          ...baseEnv,
          ...env,
        },
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
