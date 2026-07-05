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

  it('returns medium and high pressure from normalized local size signals', () => {
    expect(estimateContextPressure({
      historyBufferBytes: 2_750_000,
      transcriptBytes: 500_000,
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

  it('returns full pressure when history limit is reached', () => {
    expect(estimateContextPressure({
      historyBufferBytes: 100,
      transcriptBytes: 100,
      sharedContextBytes: 100,
      recentOutputBytesPerMinute: 0,
      historyLimitReached: true,
    })).toMatchObject({ level: 'full', score: 100 });
  });
});
