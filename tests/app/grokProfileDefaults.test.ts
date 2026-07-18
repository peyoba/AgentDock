import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GROK_BASE_URL,
  DEFAULT_GROK_MODEL,
  defaultGrokHomePath,
  isDefaultGrokBaseUrl,
} from '../../src/shared/grokProfileDefaults';

describe('grokProfileDefaults', () => {
  it('provides grok profile defaults', () => {
    expect(DEFAULT_GROK_BASE_URL).toBe('https://api.x.ai/v1');
    expect(DEFAULT_GROK_MODEL).toBe('grok-build');
    expect(defaultGrokHomePath('grok-work')).toBe('~/.agentdock/grok-profiles/grok-work');
    expect(isDefaultGrokBaseUrl('https://api.x.ai/v1')).toBe(true);
    expect(isDefaultGrokBaseUrl('https://api.x.ai/v1/')).toBe(true);
    expect(isDefaultGrokBaseUrl('https://proxy.example/v1')).toBe(false);
  });
});
