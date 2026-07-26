import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareGrokHome } from '../../src/main/grokHomePrep';

const tempRoots: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdock-grok-home-'));
  tempRoots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
});

describe('prepareGrokHome', () => {
  it('writes minimal config.toml defaults without secrets', async () => {
    const grokHome = await makeTempDir();
    const result = await prepareGrokHome({
      grokHome,
      authMode: 'api-key',
      defaultModel: 'grok-build',
    });

    expect(result.grokHome).toBe(grokHome);
    const config = await fs.readFile(path.join(grokHome, 'config.toml'), 'utf8');
    expect(config).toContain('[models]');
    expect(config).toContain('default = "grok-build"');
    expect(config).toContain('[terminal]');
    expect(config).toContain('alt_screen = "never"');
    expect(config).toContain('[ui]');
    expect(config).toContain('screen_mode = "minimal"');
    expect(config.toLowerCase()).not.toContain('xai-');
    expect(config.toLowerCase()).not.toContain('api_key');
  });

  it('merges managed config keys without wiping unrelated sections', async () => {
    const grokHome = await makeTempDir();
    await fs.writeFile(
      path.join(grokHome, 'config.toml'),
      '[hooks]\nenabled = true\n\n[models]\ndefault = "old-model"\n',
      'utf8',
    );

    await prepareGrokHome({
      grokHome,
      authMode: 'oauth',
      defaultModel: 'grok-build',
    });

    const config = await fs.readFile(path.join(grokHome, 'config.toml'), 'utf8');
    expect(config).toContain('[hooks]');
    expect(config).toContain('enabled = true');
    expect(config).toContain('default = "grok-build"');
  });

  it('renames auth.json in api-key mode and returns a safe notice', async () => {
    const grokHome = await makeTempDir();
    await fs.writeFile(path.join(grokHome, 'auth.json'), '{"access_token":"secret-token"}\n', 'utf8');

    const result = await prepareGrokHome({
      grokHome,
      authMode: 'api-key',
      defaultModel: 'grok-build',
      now: () => new Date('2026-07-19T00:00:00.000Z'),
    });

    await expect(fs.access(path.join(grokHome, 'auth.json'))).rejects.toThrow();
    const disabled = path.join(grokHome, 'auth.json.agentdock-disabled-2026-07-19T00-00-00-000Z');
    await expect(fs.access(disabled)).resolves.toBeUndefined();
    expect(result.notice).toContain('API Key');
    expect(result.notice?.toLowerCase()).not.toContain('secret-token');
  });

  it('leaves auth.json untouched in oauth mode', async () => {
    const grokHome = await makeTempDir();
    const authPath = path.join(grokHome, 'auth.json');
    await fs.writeFile(authPath, '{"access_token":"secret-token"}\n', 'utf8');

    const result = await prepareGrokHome({
      grokHome,
      authMode: 'oauth',
      defaultModel: 'grok-build',
    });

    expect(result.notice).toBeUndefined();
    expect(await fs.readFile(authPath, 'utf8')).toContain('secret-token');
  });
});
