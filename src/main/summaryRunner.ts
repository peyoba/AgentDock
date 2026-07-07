import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ApiProfile, Workspace } from '../shared/agentdockTypes.js';
import type { KeychainAdapter } from './adapters/keychainAdapter.js';
import type { PtyAdapter, PtyExitEvent, PtySession } from './adapters/ptyAdapter.js';
import { buildLaunchEnvironment } from './launchEnvironment.js';
import { redactSummarySecrets } from './sessionSummaryStore.js';
import type { SummaryRunner, SummaryRunnerInput } from './summaryJobService.js';

type FileWriter = (filePath: string, content: string) => void | Promise<void>;
type DirectoryEnsurer = (directoryPath: string) => void | Promise<void>;

export type CreateProfileSummaryRunnerOptions = {
  profile: ApiProfile;
  keychain: KeychainAdapter;
  pty: PtyAdapter;
  appDataPath: string;
  homeDir?: string;
  ensureDirectory?: DirectoryEnsurer;
  writeTextFile?: FileWriter;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_CAPTURED_OUTPUT_CHARS = 200_000;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function buildCodexConfig(profile: ApiProfile, workspace: Workspace): string {
  return [
    `model = ${tomlString(profile.defaultModel ?? 'gpt-5-codex')}`,
    'model_provider = "agentdock"',
    '',
    '[model_providers.agentdock]',
    'name = "AgentDock"',
    `base_url = ${tomlString(profile.baseUrl)}`,
    'wire_api = "responses"',
    'env_key = "OPENAI_API_KEY"',
    '',
    `[projects.${tomlString(workspace.path)}]`,
    'trust_level = "trusted"',
    '',
  ].join('\n');
}

function buildEmptyClaudeMcpConfig(): string {
  return `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`;
}

async function defaultEnsureDirectory(directoryPath: string): Promise<void> {
  await mkdir(directoryPath, { recursive: true });
}

function defaultWriteTextFile(filePath: string, content: string): Promise<void> {
  return writeFile(filePath, content, 'utf-8');
}

function safeSessionId(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_');
}

function stripAnsi(value: string): string {
  return value.replace(
    // eslint-disable-next-line no-control-regex
    /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g,
    '',
  );
}

function appendCapturedOutput(currentOutput: string, data: string): string {
  const nextOutput = `${currentOutput}${data}`;
  return nextOutput.length > MAX_CAPTURED_OUTPUT_CHARS
    ? nextOutput.slice(-MAX_CAPTURED_OUTPUT_CHARS)
    : nextOutput;
}

function buildSummaryPrompt({
  session,
  workspace,
  previousSummary,
  redactedTranscriptTail,
  generatedAt,
  summaryProviderProfileId,
}: SummaryRunnerInput): string {
  return [
    'You are AgentDock summary runner.',
    'Create a concise Markdown handoff for another coding agent to continue this exact session.',
    'Return Markdown only. Do not wrap it in code fences.',
    'Do not include secrets, API keys, tokens, full environment variable dumps, or credentials.',
    'If a value is missing or uncertain, write Unknown.',
    '',
    'The output must use exactly this section structure:',
    '# AgentDock Session Summary',
    '## Current Goal',
    '## Decisions',
    '## Files And Areas Touched',
    '## Commands And Verification',
    '## Problems And Risks',
    '## Next Steps',
    '## Source',
    '',
    'Session metadata:',
    `- Session ID: ${session.id}`,
    `- Session title: ${session.title}`,
    `- Session command: ${session.command}`,
    `- Session status: ${session.status}`,
    `- Source profile ID: ${session.profileId}`,
    `- Summary provider profile ID: ${summaryProviderProfileId}`,
    `- Workspace ID: ${workspace.id}`,
    `- Workspace name: ${workspace.name}`,
    `- Workspace path: ${workspace.path}`,
    `- Generated at: ${generatedAt}`,
    '',
    'Previous summary, if available:',
    redactSummarySecrets(previousSummary?.trim() || 'None'),
    '',
    'Redacted terminal transcript tail:',
    redactSummarySecrets(redactedTranscriptTail || 'None'),
    '',
  ].join('\n');
}

function claudeSummaryCommand(prompt: string, mcpConfigPath: string): string {
  return [
    'claude',
    '--print',
    '--output-format text',
    '--no-session-persistence',
    '--permission-mode plan',
    '--effort high',
    '--setting-sources project,local',
    `--mcp-config ${shellQuote(mcpConfigPath)}`,
    '--strict-mcp-config',
    shellQuote(prompt),
  ].join(' ');
}

function codexSummaryCommand(prompt: string, workspace: Workspace): string {
  return [
    'codex exec',
    `--cd ${shellQuote(workspace.path)}`,
    '--sandbox read-only',
    '--skip-git-repo-check',
    '--ephemeral',
    '--color never',
    shellQuote(prompt),
  ].join(' ');
}

function commandForProfile(
  profile: ApiProfile,
  input: SummaryRunnerInput,
  options: { claudeMcpConfigPath?: string } = {},
): string {
  const prompt = buildSummaryPrompt(input);
  if (profile.toolType === 'claude') {
    if (!options.claudeMcpConfigPath) {
      throw new Error('Claude 摘要 MCP 配置不可用');
    }
    return claudeSummaryCommand(prompt, options.claudeMcpConfigPath);
  }

  if (profile.toolType === 'codex') {
    return codexSummaryCommand(prompt, input.workspace);
  }

  throw new Error('当前工具类型暂不支持自动总结');
}

function rejectSummaryCli(message: string): Error {
  return new Error(message);
}

async function runPtyToCompletion({
  pty,
  sessionId,
  command,
  cwd,
  env,
  timeoutMs,
}: {
  pty: PtyAdapter;
  sessionId: string;
  command: string;
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
}): Promise<string> {
  let ptySession: PtySession;
  try {
    ptySession = await pty.spawn({ sessionId, command, cwd, env });
  } catch {
    throw rejectSummaryCli('摘要 CLI 启动失败');
  }

  return new Promise((resolve, reject) => {
    let output = '';
    let settled = false;
    let unsubscribeData: (() => void) | undefined;
    let unsubscribeExit: (() => void) | undefined;
    let timeout: NodeJS.Timeout | undefined;

    const settle = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      unsubscribeData?.();
      unsubscribeExit?.();
      callback();
    };

    const handleExit = (event: PtyExitEvent): void => {
      settle(() => {
        if (event.exitCode !== 0) {
          reject(rejectSummaryCli(`摘要 CLI 执行失败: exit code ${event.exitCode}`));
          return;
        }

        const cleanedOutput = redactSummarySecrets(stripAnsi(output).trim());
        if (!cleanedOutput) {
          reject(rejectSummaryCli('摘要 CLI 未返回内容'));
          return;
        }

        resolve(cleanedOutput);
      });
    };

    timeout = setTimeout(() => {
      settle(() => {
        ptySession.kill();
        reject(rejectSummaryCli('摘要 CLI 执行超时'));
      });
    }, timeoutMs);

    unsubscribeData = ptySession.onData((data) => {
      output = appendCapturedOutput(output, data);
    });

    if (!ptySession.onExit) {
      settle(() => reject(rejectSummaryCli('摘要 CLI 无法监听退出状态')));
      return;
    }
    unsubscribeExit = ptySession.onExit(handleExit);
  });
}

async function prepareCodexHome({
  profile,
  workspace,
  env,
  ensureDirectory,
  writeTextFile,
}: {
  profile: ApiProfile;
  workspace: Workspace;
  env: Record<string, string>;
  ensureDirectory: DirectoryEnsurer;
  writeTextFile: FileWriter;
}): Promise<void> {
  if (profile.toolType !== 'codex' || !env.CODEX_HOME) {
    return;
  }

  await ensureDirectory(env.CODEX_HOME);
  await writeTextFile(
    path.join(env.CODEX_HOME, 'config.toml'),
    buildCodexConfig(profile, workspace),
  );
}

async function prepareClaudeLiteMcpConfig({
  profile,
  appDataPath,
  ensureDirectory,
  writeTextFile,
}: {
  profile: ApiProfile;
  appDataPath: string;
  ensureDirectory: DirectoryEnsurer;
  writeTextFile: FileWriter;
}): Promise<string | undefined> {
  if (profile.toolType !== 'claude') {
    return undefined;
  }

  const mcpConfigDirectory = path.join(appDataPath, 'claude-mcp');
  const mcpConfigPath = path.join(mcpConfigDirectory, 'empty.json');
  await ensureDirectory(mcpConfigDirectory);
  await writeTextFile(mcpConfigPath, buildEmptyClaudeMcpConfig());
  return mcpConfigPath;
}

export function createProfileSummaryRunner({
  profile,
  keychain,
  pty,
  appDataPath,
  homeDir,
  ensureDirectory = defaultEnsureDirectory,
  writeTextFile = defaultWriteTextFile,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: CreateProfileSummaryRunnerOptions): SummaryRunner {
  return async (input: SummaryRunnerInput): Promise<string> => {
    let secret: string;
    try {
      secret = await keychain.readSecret(profile.keychainService, profile.keychainAccount);
    } catch {
      throw rejectSummaryCli('无法读取摘要 Profile 的 API Key');
    }

    const env = buildLaunchEnvironment({ profile, secret, appDataPath, homeDir });
    await prepareCodexHome({
      profile,
      workspace: input.workspace,
      env,
      ensureDirectory,
      writeTextFile,
    });
    const claudeMcpConfigPath = await prepareClaudeLiteMcpConfig({
      profile,
      appDataPath,
      ensureDirectory,
      writeTextFile,
    });

    const command = commandForProfile(profile, input, { claudeMcpConfigPath });
    return runPtyToCompletion({
      pty,
      sessionId: `summary-${safeSessionId(profile.id)}-${safeSessionId(input.session.id)}`,
      command,
      cwd: input.workspace.path,
      env,
      timeoutMs,
    });
  };
}
