export type ContextPressureLevel = 'low' | 'medium' | 'high' | 'full';

export type ContextPressureInput = {
  historyBufferBytes: number;
  transcriptBytes: number;
  sharedContextBytes: number;
  recentOutputBytesPerMinute: number;
  historyLimitReached: boolean;
};

export type ContextPressure = {
  level: ContextPressureLevel;
  score: number;
};

const TRANSCRIPT_WARNING_BYTES = 2_500_000;
const SHARED_CONTEXT_WARNING_BYTES = 1_000_000;
const OUTPUT_RATE_WARNING_BYTES_PER_MINUTE = 60_000;

function normalizedScore(value: number, limit: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.min(100, Math.ceil((value / limit) * 100));
}

function pressureLevel(score: number): ContextPressureLevel {
  if (score >= 100) {
    return 'full';
  }
  if (score >= 80) {
    return 'high';
  }
  if (score >= 50) {
    return 'medium';
  }
  return 'low';
}

export function estimateContextPressure(input: ContextPressureInput): ContextPressure {
  const score = Math.max(
    normalizedScore(input.transcriptBytes, TRANSCRIPT_WARNING_BYTES),
    normalizedScore(input.sharedContextBytes, SHARED_CONTEXT_WARNING_BYTES),
    normalizedScore(input.recentOutputBytesPerMinute, OUTPUT_RATE_WARNING_BYTES_PER_MINUTE),
  );

  return { level: pressureLevel(score), score };
}
