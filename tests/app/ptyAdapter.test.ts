import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNodePtyAdapter, ensureNodePtySpawnHelperExecutable } from '../../src/main/adapters/ptyAdapter';
import type { PtyDataHandler } from '../../src/main/adapters/ptyAdapter';

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
    expect(spawnCalls).toEqual([
      {
        file: '/bin/zsh',
        args: ['-lc', 'printf safe-output'],
        options: {
          name: 'xterm-256color',
          cwd: '/tmp',
          env: {
            PATH: '/usr/bin',
            HOME: '/tmp/home',
            AGENTDOCK_TEST_SECRET: 'not-a-real-api-key',
          },
        },
      },
    ]);
    expect(writes).toEqual(['input']);
    expect(resizes).toEqual([{ cols: 100, rows: 30 }]);
    expect(outputs).toEqual(['safe-output']);
    expect(killed).toBe(true);
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
