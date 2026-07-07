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
