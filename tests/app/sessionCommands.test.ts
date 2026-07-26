import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GROK_COMMAND,
  LOCAL_SHELL_COMMAND,
  commandExecutableName,
  isLocalShellCommand,
  isSupportedSessionCommand,
  withGrokScrollbackFriendlyFlags,
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

  it('allows grok executables in the session command allowlist', () => {
    expect(isSupportedSessionCommand('grok --no-alt-screen')).toBe(true);
    expect(isSupportedSessionCommand('grok.exe --no-alt-screen')).toBe(true);
    expect(commandExecutableName('/Users/me/.local/bin/grok --resume abc')).toBe('grok');
  });

  it('upgrades grok commands to scrollback-friendly minimal mode', () => {
    expect(DEFAULT_GROK_COMMAND).toBe('grok --no-alt-screen --minimal');
    expect(withGrokScrollbackFriendlyFlags('grok --no-alt-screen')).toBe(
      'grok --no-alt-screen --minimal',
    );
    expect(withGrokScrollbackFriendlyFlags('grok --no-alt-screen --minimal')).toBe(
      'grok --no-alt-screen --minimal',
    );
    expect(withGrokScrollbackFriendlyFlags('grok --no-alt-screen --resume sess-1')).toBe(
      'grok --no-alt-screen --resume sess-1 --minimal',
    );
    expect(withGrokScrollbackFriendlyFlags('grok --fullscreen')).toBe('grok --fullscreen');
    expect(withGrokScrollbackFriendlyFlags('claude --dangerously-skip-permissions')).toBe(
      'claude --dangerously-skip-permissions',
    );
  });
});
