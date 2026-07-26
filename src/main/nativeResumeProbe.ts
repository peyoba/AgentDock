export type NativeResumeCapability =
  | {
      tool: 'claude';
      status: 'verified-capability';
      supportsProvidedSessionId: boolean;
      supportsResumeById: boolean;
    }
  | {
      tool: 'codex';
      status: 'needs-runtime-probe';
      supportsProvidedSessionId: false;
      supportsResumeById: boolean;
    };

export function detectClaudeResumeCapabilityFromHelp(help: string): NativeResumeCapability {
  return {
    tool: 'claude',
    status: 'verified-capability',
    supportsProvidedSessionId: /(?:^|\s)--session-id(?:\s+<[^>]+>)?/m.test(help),
    supportsResumeById: /(?:^|\s)--resume(?:\s+(?:\[[^\]]+\]|<[^>]+>))?/m.test(help),
  };
}

export function detectCodexResumeCapabilityFromHelp(help: string): NativeResumeCapability {
  return {
    tool: 'codex',
    status: 'needs-runtime-probe',
    supportsProvidedSessionId: false,
    supportsResumeById:
      /Usage:\s+codex(?:\s+exec)?\s+resume\b/i.test(help) ||
      /^\s*resume\s+Resume\b/im.test(help) ||
      /Resume a previous interactive session/i.test(help),
  };
}

export function buildClaudeNativeSessionCommand(command: string, sessionUuid: string): string {
  return `${command.trimEnd()} --session-id ${sessionUuid}`;
}

export type GrokResumeCapability = {
  tool: 'grok';
  status: 'partial-capability' | 'verified-capability';
  supportsContinue: boolean;
  supportsResumeById: boolean;
};

export function detectGrokResumeCapabilityFromHelp(help: string): GrokResumeCapability {
  const supportsContinue =
    /(?:^|\s)-c(?:,|\s)/m.test(help) ||
    /(?:^|\s)--continue/m.test(help) ||
    /Continue the most recent session/i.test(help);
  const supportsResumeById =
    /(?:^|\s)-r(?:,|\s)/m.test(help) ||
    /(?:^|\s)--resume/m.test(help) ||
    /Resume a session by ID/i.test(help);

  return {
    tool: 'grok',
    status: supportsResumeById ? 'verified-capability' : 'partial-capability',
    supportsContinue,
    supportsResumeById,
  };
}

export function buildGrokContinueCommand(baseCommand = 'grok --no-alt-screen --minimal'): string {
  return `${baseCommand.trimEnd()} --continue`;
}

export function buildGrokResumeCommand(
  sessionId: string,
  baseCommand = 'grok --no-alt-screen --minimal',
): string {
  const normalizedId = sessionId.trim();
  if (!normalizedId) {
    throw new Error('Grok session id is required for resume');
  }
  return `${baseCommand.trimEnd()} --resume ${normalizedId}`;
}

export function resolveGrokNativeResumeState({
  grokHomeExists,
  sessionId,
  checkedAt,
}: {
  grokHomeExists: boolean;
  sessionId?: string;
  checkedAt?: string;
}): {
  tool: 'grok';
  status: 'verified' | 'partial' | 'unavailable';
  sessionId?: string;
  resumeCommand?: string;
  checkedAt?: string;
  reason?: string;
} {
  const normalizedSessionId = sessionId?.trim();
  if (normalizedSessionId) {
    return {
      tool: 'grok',
      status: 'verified',
      sessionId: normalizedSessionId,
      resumeCommand: buildGrokResumeCommand(normalizedSessionId),
      checkedAt,
    };
  }
  if (grokHomeExists) {
    return {
      tool: 'grok',
      status: 'partial',
      resumeCommand: buildGrokContinueCommand(),
      checkedAt,
      reason: '仅确认可使用 --continue，未解析到 session id',
    };
  }
  return {
    tool: 'grok',
    status: 'unavailable',
    checkedAt,
    reason: 'GROK_HOME 不存在或无可恢复会话',
  };
}
