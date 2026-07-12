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

const SENSITIVE_COMMAND_ENV_PATTERN =
  /\b[A-Za-z_][A-Za-z0-9_]*(?:API_KEY|AUTH_TOKEN|TOKEN|SECRET|PASSWORD)[A-Za-z0-9_]*\s*=\s*(?:"[^"]*"|'[^']*'|\S+)/gi;
const SENSITIVE_COMMAND_OPTION_PATTERN =
  /--(api[-_]?key|auth[-_]?token|token|secret|password)(?:\s+|=)(?:"[^"]*"|'[^']*'|\S+)/gi;
const SENSITIVE_AUTHORIZATION_PATTERN =
  /authorization\s*:\s*bearer\s+(?:"[^"]*"|'[^']*'|\S+)/gi;

export function containsSensitiveCommandValue(command: string): boolean {
  return (
    new RegExp(SENSITIVE_COMMAND_ENV_PATTERN.source, 'i').test(command) ||
    new RegExp(SENSITIVE_COMMAND_OPTION_PATTERN.source, 'i').test(command) ||
    new RegExp(SENSITIVE_AUTHORIZATION_PATTERN.source, 'i').test(command)
  );
}

export function redactCommandSecrets(command: string): string {
  return redactSecrets(command)
    .replace(SENSITIVE_COMMAND_ENV_PATTERN, '[REDACTED]')
    .replace(SENSITIVE_COMMAND_OPTION_PATTERN, '--$1 [REDACTED]')
    .replace(SENSITIVE_AUTHORIZATION_PATTERN, 'Authorization: Bearer [REDACTED]');
}
