import { describe, expect, it } from 'vitest';
import { createStreamingPersistenceSanitizer } from '../../src/main/streamingPersistenceSanitizer';

const TEST_KNOWN_SECRET = 'test-profile-secret-Zx91-safe-fixture';

function createSanitizer(knownSecrets: string[] = [TEST_KNOWN_SECRET]) {
  return createStreamingPersistenceSanitizer({ knownSecrets });
}

function sanitizeChunks(chunks: string[], knownSecrets: string[] = [TEST_KNOWN_SECRET]): string {
  const sanitizer = createSanitizer(knownSecrets);
  return chunks.map((chunk) => sanitizer.push(chunk)).join('') + sanitizer.end();
}

describe('streamingPersistenceSanitizer', () => {
  it('redacts a known profile secret at every two-chunk split point', () => {
    for (let splitIndex = 1; splitIndex < TEST_KNOWN_SECRET.length; splitIndex += 1) {
      const persistedOutput = sanitizeChunks([
        `before:${TEST_KNOWN_SECRET.slice(0, splitIndex)}`,
        `${TEST_KNOWN_SECRET.slice(splitIndex)}:after`,
      ]);

      expect(persistedOutput, `split index ${splitIndex}`).toBe('before:[REDACTED]:after');
      expect(persistedOutput, `split index ${splitIndex}`).not.toContain(TEST_KNOWN_SECRET);
    }
  });

  it('removes split CSI and OSC sequences before redacting a secret containing them', () => {
    const persistedOutput = sanitizeChunks([
      'start test-profile-',
      'secret-\u001b[3',
      '1mZx91\u001b[0m-safe-\u001b]0;private title',
      '\u0007fixture end',
    ]);

    expect(persistedOutput).toBe('start [REDACTED] end');
    expect(persistedOutput).not.toContain(TEST_KNOWN_SECRET);
    expect(persistedOutput).not.toMatch(/[\u001b\u0007]/u);
  });

  it('removes an OSC sequence terminated by a split ST sequence', () => {
    const persistedOutput = sanitizeChunks([
      'visible\u001b]8;;https://example.invalid/private',
      '\u001b',
      '\\text',
    ]);

    expect(persistedOutput).toBe('visibletext');
    expect(persistedOutput).not.toContain('example.invalid');
    expect(persistedOutput).not.toContain('\u001b');
  });

  it('keeps a possible known-secret prefix pending across flush', () => {
    const sanitizer = createSanitizer();
    const firstOutput = sanitizer.push('safe test-profile-secret-');
    const flushedOutput = sanitizer.flush();
    const secondOutput = sanitizer.push('Zx91-safe-fixture done');
    const endedOutput = sanitizer.end();
    const persistedOutput = firstOutput + flushedOutput + secondOutput + endedOutput;

    expect(firstOutput + flushedOutput).toBe('safe ');
    expect(persistedOutput).toBe('safe [REDACTED] done');
    expect(persistedOutput).not.toContain(TEST_KNOWN_SECRET);
  });

  it('releases an ordinary Unicode tail only when the stream ends', () => {
    const sanitizer = createSanitizer();
    const pushedOutput = sanitizer.push('普通尾部🙂');
    const flushedOutput = sanitizer.flush();
    const endedOutput = sanitizer.end();

    expect(pushedOutput + flushedOutput + endedOutput).toBe('普通尾部🙂');
    expect(endedOutput).not.toContain('\uFFFD');
  });

  it.each([
    ['sensitive environment value', ['ANTHROPIC_AUTH_TOKEN=test-unclosed-', 'environment-value']],
    ['Bearer value', ['Authorization: Bearer test-unclosed-', 'bearer-value']],
  ])('fails closed for an unterminated %s at end', (_label, chunks) => {
    const persistedOutput = sanitizeChunks(chunks, []);

    expect(persistedOutput).toContain('[REDACTED]');
    expect(persistedOutput).not.toContain(chunks.join('').split('=').at(-1));
    expect(persistedOutput).not.toContain('test-unclosed-');
  });

  it('keeps pending secret state isolated between sanitizer instances', () => {
    const firstSession = createSanitizer(['session-a-private-value']);
    const secondSession = createSanitizer(['session-b-private-value']);

    const firstOutput = firstSession.push('A session-a-') + firstSession.end();
    const secondOutput =
      secondSession.push('B session-b-private-') +
      secondSession.push('value complete') +
      secondSession.end();

    expect(firstOutput).toBe('A session-a-');
    expect(secondOutput).toBe('B [REDACTED] complete');
    expect(secondOutput).not.toContain('session-a-');
    expect(secondOutput).not.toContain('session-b-private-value');
  });

  it('preserves Chinese and emoji split at every UTF-16 boundary', () => {
    const readableText = '开始中文🙂继续🚀结束\n';

    for (let splitIndex = 1; splitIndex < readableText.length; splitIndex += 1) {
      const persistedOutput = sanitizeChunks(
        [readableText.slice(0, splitIndex), readableText.slice(splitIndex)],
        [],
      );

      expect(persistedOutput, `UTF-16 split index ${splitIndex}`).toBe(readableText);
      expect(persistedOutput, `UTF-16 split index ${splitIndex}`).not.toContain('\uFFFD');
    }
  });

  it('fails closed before an unbounded Bearer value can remain pending', () => {
    const sanitizer = createSanitizer([]);
    const emittedOutput: string[] = [sanitizer.push('Authorization: Bearer ')];

    for (let chunkIndex = 0; chunkIndex < 2_048; chunkIndex += 1) {
      emittedOutput.push(sanitizer.push('x'.repeat(1_024)));
    }

    const outputBeforeEnd = emittedOutput.join('');
    const persistedOutput = outputBeforeEnd + sanitizer.end();

    expect(outputBeforeEnd).toContain('[REDACTED]');
    expect(persistedOutput.match(/\[REDACTED\]/gu)).toHaveLength(1);
    expect(persistedOutput).not.toContain('x'.repeat(1_024));
    expect(persistedOutput.length).toBeLessThan(256);
  });
});
