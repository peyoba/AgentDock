import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('main profile sanitize wiring', () => {
  it('keeps Grok auth mode and home when sanitizing profiles for save/list', () => {
    const source = readFileSync('src/main/main.ts', 'utf8');
    const sanitizeProfile = source.match(
      /function sanitizeProfile\(profile: ApiProfile\): ApiProfile \{[\s\S]*?\n\}/,
    )?.[0];

    expect(sanitizeProfile).toBeDefined();
    expect(sanitizeProfile).toMatch(/grokHome\s*:/);
    expect(sanitizeProfile).toMatch(/grokAuthMode\s*:/);
    expect(sanitizeProfile).toMatch(/validGrokAuthMode\(/);
    expect(sanitizeProfile).toMatch(/toolType === 'grok'/);

    expect(source).toMatch(
      /function validGrokAuthMode\(value: unknown\): GrokAuthMode \| undefined \{\s*return value === 'api-key' \|\| value === 'oauth' \? value : undefined;\s*\}/,
    );
  });
});
