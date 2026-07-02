import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNodePtyAdapter, ensureNodePtySpawnHelperExecutable } from '../../src/main/adapters/ptyAdapter';
import type { PtyDataHandler } from '../../src/main/adapters/ptyAdapter';

type SpawnCall = {
  file: string;
  args: string[];
  options: {
    name: string;
    cwd: string;
    env: Record<string, string | undefined>;
  };
};

describe('createNodePtyAdapter', () => {
  it('spawns a shell command through a node-pty-compatible module and bridges IO', async () => {
    const dataListeners = new Set<PtyDataHandler>();
    const writes: string[] = [];
    const resizes: Array<{ cols: number; rows: number }> = [];
    let killed = false;
    const spawnCalls: unknown[] = [];

    const adapter = createNodePtyAdapter({
      module: {
        spawn(file, args, options) {
          spawnCalls.push({ file, args, options });
          return {
            write(input: string) {
              writes.push(input);
            },
            resize(cols: number, rows: number) {
              resizes.push({ cols, rows });
            },
            kill() {
              killed = true;
            },
            onData(listener: PtyDataHandler) {
              dataListeners.add(listener);
              return { dispose: () => dataListeners.delete(listener) };
            },
          };
        },
      },
      shell: '/bin/zsh',
      baseEnv: { PATH: '/usr/bin', HOME: '/tmp/home' },
      ensureHelper: false,
    });

    const session = await adapter.spawn({
      sessionId: 'session-1',
      command: 'printf safe-output',
      cwd: '/tmp',
      env: { AGENTDOCK_TEST_SECRET: 'not-a-real-api-key' },
    });
    const outputs: string[] = [];
    const unsubscribe = session.onData((data) => outputs.push(data));

    session.write('input');
    session.resize(100, 30);
    for (const listener of dataListeners) {
      listener('safe-output');
    }
    unsubscribe();
    for (const listener of dataListeners) {
      listener('ignored');
    }
    session.kill();

    expect(session.id).toBe('session-1');
    expect(spawnCalls).toHaveLength(1);
    const [spawnCall] = spawnCalls as [SpawnCall];
    expect(spawnCall.file).toBe('/bin/zsh');
    expect(spawnCall.args).toEqual(['-lc', 'printf safe-output']);
    expect(spawnCall.options.name).toBe('xterm-256color');
    expect(spawnCall.options.cwd).toBe('/tmp');
    expect(spawnCall.options.env.HOME).toBe('/tmp/home');
    expect(spawnCall.options.env.AGENTDOCK_TEST_SECRET).toBe('not-a-real-api-key');
    expect(spawnCall.options.env.PATH?.split(path.delimiter)).toEqual(
      expect.arrayContaining(['/usr/bin', '/tmp/home/.npm-global/bin', '/opt/homebrew/bin']),
    );
    expect(writes).toEqual(['input']);
    expect(resizes).toEqual([{ cols: 100, rows: 30 }]);
    expect(outputs).toEqual(['safe-output']);
    expect(killed).toBe(true);
  });

  it('spawns zsh as an interactive shell instead of wrapping it in shell -lc', async () => {
    const spawnCalls: unknown[] = [];
    const adapter = createNodePtyAdapter({
      module: {
        spawn(file, args, options) {
          spawnCalls.push({ file, args, options });
          return {
            write() {},
            resize() {},
            kill() {},
            onData() {
              return { dispose() {} };
            },
          };
        },
      },
      shell: '/bin/zsh',
      baseEnv: { PATH: '/usr/bin' },
      ensureHelper: false,
    });

    await adapter.spawn({
      sessionId: 'session-shell',
      command: 'zsh',
      cwd: '/tmp',
      env: {},
    });

    expect(spawnCalls).toHaveLength(1);
    const [spawnCall] = spawnCalls as [SpawnCall];
    expect(spawnCall.file).toBe('zsh');
    expect(spawnCall.args).toEqual(['-l']);
    expect(spawnCall.options.name).toBe('xterm-256color');
    expect(spawnCall.options.cwd).toBe('/tmp');
    expect(spawnCall.options.env.PATH?.split(path.delimiter)).toContain('/usr/bin');
  });

  it('adds common user CLI directories to PATH for packaged app launches', async () => {
    let spawnedPath = '';
    const adapter = createNodePtyAdapter({
      module: {
        spawn(_file, _args, options) {
          spawnedPath = options.env.PATH ?? '';
          return {
            write() {},
            resize() {},
            kill() {},
            onData() {
              return { dispose() {} };
            },
          };
        },
      },
      shell: '/bin/zsh',
      baseEnv: { PATH: '/usr/bin:/bin', HOME: '/Users/example' },
      ensureHelper: false,
    });

    await adapter.spawn({
      sessionId: 'session-codex',
      command: 'codex',
      cwd: '/tmp',
      env: {},
    });

    expect(spawnedPath.split(path.delimiter)).toEqual(
      expect.arrayContaining([
        '/Users/example/.npm-global/bin',
        '/Users/example/.local/bin',
        '/Users/example/.codex/bin',
        '/opt/homebrew/bin',
        '/usr/local/bin',
      ]),
    );
  });

});


  it('ensures the packaged Unix spawn-helper is executable', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdock-pty-helper-'));
    const helperDir = path.join(tempDir, 'prebuilds', 'darwin-arm64');
    fs.mkdirSync(helperDir, { recursive: true });
    const helperPath = path.join(helperDir, 'spawn-helper');
    fs.writeFileSync(helperPath, '#!/bin/sh\nexit 0\n', { mode: 0o644 });

    ensureNodePtySpawnHelperExecutable({
      packageRoot: tempDir,
      platform: 'darwin',
      arch: 'arm64',
    });

    expect(fs.statSync(helperPath).mode & 0o111).not.toBe(0);
  });


  it('maps app.asar helper paths to app.asar.unpacked before chmod', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdock-asar-helper-'));
    const asarPackageRoot = path.join(tempDir, 'AgentDock.app', 'Contents', 'Resources', 'app.asar', 'node_modules', 'node-pty');
    const unpackedPackageRoot = asarPackageRoot.replace('app.asar', 'app.asar.unpacked');
    const helperDir = path.join(unpackedPackageRoot, 'prebuilds', 'darwin-arm64');
    fs.mkdirSync(helperDir, { recursive: true });
    const helperPath = path.join(helperDir, 'spawn-helper');
    fs.writeFileSync(helperPath, '#!/bin/sh\nexit 0\n', { mode: 0o644 });

    ensureNodePtySpawnHelperExecutable({
      packageRoot: asarPackageRoot,
      platform: 'darwin',
      arch: 'arm64',
    });

    expect(fs.statSync(helperPath).mode & 0o111).not.toBe(0);
  });
