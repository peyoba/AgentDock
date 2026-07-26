export const LOCAL_SHELL_COMMAND = 'local-shell';

/** Scrollback-native Grok UI: keeps chat history readable in AgentDock. */
export const DEFAULT_GROK_COMMAND = 'grok --no-alt-screen --minimal';

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
  'grok',
  'grok.exe',
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

/**
 * Ensure Grok interactive launches use scrollback-friendly rendering.
 * Existing sessions that only pass `--no-alt-screen` still get `--minimal`.
 */
export function withGrokScrollbackFriendlyFlags(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) {
    return DEFAULT_GROK_COMMAND;
  }
  const executable = commandExecutableName(trimmed).toLowerCase();
  if (executable !== 'grok' && executable !== 'grok.exe') {
    return trimmed;
  }
  if (/(?:^|\s)--minimal(?:\s|$)/i.test(trimmed)) {
    return trimmed;
  }
  // User explicitly chose fullscreen TUI — leave it alone.
  if (/(?:^|\s)--fullscreen(?:\s|$)/i.test(trimmed)) {
    return trimmed;
  }
  // Headless single-turn does not need TUI flags.
  if (/(?:^|\s)(?:--single|-p)(?:\s|$)/i.test(trimmed)) {
    return trimmed;
  }
  if (/(?:^|\s)--no-alt-screen(?:\s|$)/i.test(trimmed)) {
    return `${trimmed} --minimal`;
  }
  // Insert both preferred flags after executable when missing.
  return trimmed.replace(/^(grok(?:\.exe)?)/i, `$1 --no-alt-screen --minimal`);
}
