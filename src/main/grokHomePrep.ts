import fs from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_GROK_MODEL } from '../shared/grokProfileDefaults.js';
import type { GrokAuthMode } from '../shared/agentdockTypes.js';

export type PrepareGrokHomeInput = {
  grokHome: string;
  authMode?: GrokAuthMode;
  defaultModel?: string;
  now?: () => Date;
};

export type PrepareGrokHomeResult = {
  grokHome: string;
  notice?: string;
};

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function stamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function upsertTomlSection(content: string, section: string, entries: Record<string, string>): string {
  const sectionHeader = `[${section}]`;
  const bodyLines = Object.entries(entries).map(([key, value]) => `${key} = ${value}`);
  const sectionBlock = [sectionHeader, ...bodyLines].join('\n');

  const sectionPattern = new RegExp(
    `^\\[${section.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\][\\s\\S]*?(?=^\\[|\\Z)`,
    'm',
  );

  if (sectionPattern.test(content)) {
    return content.replace(sectionPattern, `${sectionBlock}\n\n`);
  }

  const trimmed = content.trim();
  if (!trimmed) {
    return `${sectionBlock}\n`;
  }
  return `${trimmed}\n\n${sectionBlock}\n`;
}

export async function prepareGrokHome({
  grokHome,
  authMode = 'api-key',
  defaultModel,
  now = () => new Date(),
}: PrepareGrokHomeInput): Promise<PrepareGrokHomeResult> {
  const resolvedHome = grokHome.trim();
  if (!resolvedHome) {
    throw new Error('GROK_HOME is required');
  }

  await fs.mkdir(resolvedHome, { recursive: true });

  const configPath = path.join(resolvedHome, 'config.toml');
  let existing = '';
  try {
    existing = await fs.readFile(configPath, 'utf8');
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || (error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  const model = (defaultModel?.trim() || DEFAULT_GROK_MODEL);
  let nextConfig = upsertTomlSection(existing, 'models', {
    default: tomlString(model),
  });
  nextConfig = upsertTomlSection(nextConfig, 'terminal', {
    alt_screen: tomlString('never'),
  });
  nextConfig = upsertTomlSection(nextConfig, 'ui', {
    screen_mode: tomlString('minimal'),
  });
  await fs.writeFile(configPath, nextConfig.endsWith('\n') ? nextConfig : `${nextConfig}\n`, 'utf8');

  let notice: string | undefined;
  if (authMode !== 'oauth') {
    const authPath = path.join(resolvedHome, 'auth.json');
    try {
      await fs.access(authPath);
      const disabledPath = path.join(
        resolvedHome,
        `auth.json.agentdock-disabled-${stamp(now())}`,
      );
      await fs.rename(authPath, disabledPath);
      notice =
        '[AgentDock] 已暂时停用该 Profile 的 Grok 登录态，改用 API Key 启动';
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || (error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  return { grokHome: resolvedHome, notice };
}
