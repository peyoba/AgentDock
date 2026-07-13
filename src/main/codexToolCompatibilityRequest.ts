export const CODEX_COMPATIBILITY_BODY_LIMIT_BYTES = 8 * 1024 * 1024;

export function createCodexInternalModelAlias(sessionId: string): string {
  return `agentdock-tool-runtime-${sessionId.replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

export function rewriteCodexCompatibilityRequest({
  bodyText,
  internalModel,
  upstreamModel,
}: {
  bodyText: string;
  internalModel: string;
  upstreamModel: string;
}): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText) as unknown;
  } catch {
    throw new Error('Codex compatibility request must be a JSON object');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Codex compatibility request must be a JSON object');
  }

  const body = parsed as Record<string, unknown>;
  if (body.model !== internalModel) {
    throw new Error('Codex compatibility request model does not match this session');
  }

  return { ...body, model: upstreamModel };
}
