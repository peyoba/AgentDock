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
