const FULL_MASK = '••••••';
const MIN_SUFFIX_REVEAL_LENGTH = 8;

export function maskSecret(secret: string): string {
  if (secret.length === 0) {
    return '未设置';
  }

  // 过短的密钥展示尾部等于全量泄露，直接全遮蔽
  if (secret.length < MIN_SUFFIX_REVEAL_LENGTH) {
    return FULL_MASK;
  }

  const suffix = secret.slice(-3);
  return `${FULL_MASK}${suffix}`;
}
