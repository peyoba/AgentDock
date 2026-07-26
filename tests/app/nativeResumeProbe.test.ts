import { describe, expect, it } from 'vitest';
import {
  buildClaudeNativeSessionCommand,
  buildGrokContinueCommand,
  buildGrokResumeCommand,
  detectClaudeResumeCapabilityFromHelp,
  detectCodexResumeCapabilityFromHelp,
  detectGrokResumeCapabilityFromHelp,
  resolveGrokNativeResumeState,
} from '../../src/main/nativeResumeProbe';

describe('nativeResumeProbe', () => {
  it('detects Claude session-id and resume support from help output', () => {
    const result = detectClaudeResumeCapabilityFromHelp(`
      --session-id <uuid> Use a specific session ID
      -r, --resume [value] Resume a conversation by session ID
    `);

    expect(result).toEqual({
      tool: 'claude',
      status: 'verified-capability',
      supportsProvidedSessionId: true,
      supportsResumeById: true,
    });
  });

  it('accepts Claude help argument labels that are not literally uuid', () => {
    const result = detectClaudeResumeCapabilityFromHelp(`
      --session-id <id> Use a specific session ID
      --resume <session> Resume a conversation
    `);

    expect(result.supportsProvidedSessionId).toBe(true);
    expect(result.supportsResumeById).toBe(true);
  });

  it('appends a generated Claude session id without changing the base command', () => {
    expect(
      buildClaudeNativeSessionCommand(
        'claude --dangerously-skip-permissions',
        '123e4567-e89b-12d3-a456-426614174000',
      ),
    ).toBe(
      'claude --dangerously-skip-permissions --session-id 123e4567-e89b-12d3-a456-426614174000',
    );
  });

  it('marks Codex as needing runtime probe because startup session-id is not exposed', () => {
    const result = detectCodexResumeCapabilityFromHelp(`
      Usage: codex [OPTIONS] [PROMPT]
      Commands:
        resume Resume a previous interactive session
    `);

    expect(result).toEqual({
      tool: 'codex',
      status: 'needs-runtime-probe',
      supportsProvidedSessionId: false,
      supportsResumeById: true,
    });
  });

  it('detects Grok continue/resume support from help output', () => {
    const result = detectGrokResumeCapabilityFromHelp(`
      -c, --continue Continue the most recent session for the current working directory
      -r, --resume [SESSION_ID] Resume a session by ID
    `);
    expect(result).toEqual({
      tool: 'grok',
      status: 'verified-capability',
      supportsContinue: true,
      supportsResumeById: true,
    });
  });

  it('builds Grok continue and resume commands', () => {
    expect(buildGrokContinueCommand()).toBe('grok --no-alt-screen --minimal --continue');
    expect(buildGrokResumeCommand('sess-123')).toBe('grok --no-alt-screen --minimal --resume sess-123');
  });

  it('resolves Grok native resume metadata from home/session hints', () => {
    expect(
      resolveGrokNativeResumeState({
        grokHomeExists: true,
        sessionId: 'sess-123',
        checkedAt: '2026-07-19T00:00:00.000Z',
      }),
    ).toEqual({
      tool: 'grok',
      status: 'verified',
      sessionId: 'sess-123',
      resumeCommand: 'grok --no-alt-screen --minimal --resume sess-123',
      checkedAt: '2026-07-19T00:00:00.000Z',
    });

    expect(
      resolveGrokNativeResumeState({
        grokHomeExists: true,
        checkedAt: '2026-07-19T00:00:00.000Z',
      }).status,
    ).toBe('partial');
  });
});
