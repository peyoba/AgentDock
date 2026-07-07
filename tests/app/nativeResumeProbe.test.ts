import { describe, expect, it } from 'vitest';
import {
  buildClaudeNativeSessionCommand,
  detectClaudeResumeCapabilityFromHelp,
  detectCodexResumeCapabilityFromHelp,
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
});
