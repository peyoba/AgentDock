import { describe, expect, it } from 'vitest';
import { maskSecret } from '../../src/shared/secretPreview';

describe('secretPreview', () => {
  it('masks non-empty secrets without exposing the original value', () => {
    const masked = maskSecret('local-development-secret');

    expect(masked).toMatch(/^••••/);
    expect(masked).not.toContain('local-development-secret');
  });

  it('fully masks short secrets instead of revealing the whole value via the suffix', () => {
    const masked = maskSecret('abc');

    expect(masked).not.toContain('abc');
    expect(masked).toBe('••••••');
  });

  it('reports unset secrets in Chinese', () => {
    expect(maskSecret('')).toBe('未设置');
  });
});
