const SENSITIVE_ENV_NAMES = new Set([
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
]);

export function maskSecret(secret: string): string {
  if (secret.length === 0) {
    return '未设置';
  }

  const suffix = secret.slice(-3);
  return `••••••${suffix}`;
}

export function redactEnvironmentPreview(
  env: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [
      key,
      SENSITIVE_ENV_NAMES.has(key) ? maskSecret(value) : value,
    ]),
  );
}
