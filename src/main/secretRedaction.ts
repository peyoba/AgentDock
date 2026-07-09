// 终端输出落盘前的密钥脱敏。
// 模式匹配只能覆盖常见前缀（sk-*），第三方兼容站的密钥格式任意，
// 因此会话启动时会把已知 secret 明文注册进来做精确替换。
const knownSecrets = new Set<string>();

const MIN_KNOWN_SECRET_LENGTH = 8;

export function registerKnownSecret(secret: string | undefined): void {
  if (secret && secret.length >= MIN_KNOWN_SECRET_LENGTH) {
    knownSecrets.add(secret);
  }
}

export function redactSecrets(value: string): string {
  let result = value
    .replace(/local-development-secret/g, '[REDACTED]')
    .replace(/sk-ant-[A-Za-z0-9_-]{16,}/g, '[REDACTED]')
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, '[REDACTED]')
    .replace(/\b(ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY|OPENAI_API_KEY)=\S*/g, '$1=[REDACTED]');

  for (const secret of knownSecrets) {
    if (result.includes(secret)) {
      result = result.split(secret).join('[REDACTED]');
    }
  }
  return result;
}
