import { describe, expect, it } from 'vitest';
import { estimateContextPressure } from '../../src/main/contextBudgetEstimator';

describe('estimateContextPressure', () => {
  it('returns low pressure for small local context', () => {
    expect(estimateContextPressure({
      historyBufferBytes: 20_000,
      transcriptBytes: 30_000,
      sharedContextBytes: 10_000,
      recentOutputBytesPerMinute: 1_000,
      historyLimitReached: false,
    })).toMatchObject({ level: 'low', score: 2 });
  });

  it('returns medium and high pressure from normalized continuation material signals', () => {
    expect(estimateContextPressure({
      historyBufferBytes: 2_750_000,
      transcriptBytes: 1_300_000,
      sharedContextBytes: 120_000,
      recentOutputBytesPerMinute: 5_000,
      historyLimitReached: false,
    }).level).toBe('medium');

    expect(estimateContextPressure({
      historyBufferBytes: 4_500_000,
      transcriptBytes: 2_000_000,
      sharedContextBytes: 800_000,
      recentOutputBytesPerMinute: 50_000,
      historyLimitReached: false,
    }).level).toBe('high');
  });

  it('does not report model context as full when only local terminal history reaches its save limit', () => {
    expect(estimateContextPressure({
      historyBufferBytes: 5_000_000,
      transcriptBytes: 100,
      sharedContextBytes: 100,
      recentOutputBytesPerMinute: 0,
      historyLimitReached: true,
    })).toMatchObject({ level: 'low' });
  });
});
