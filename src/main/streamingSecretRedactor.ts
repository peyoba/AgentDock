export type StreamingSecretRedactor = {
  push(chunk: string): string;
  flush(): string;
  end(): string;
};

export type StreamingSecretRedactorOptions = {
  knownSecrets?: string[];
};

const REDACTED_VALUE = '[REDACTED]';
const MIN_KNOWN_SECRET_LENGTH = 8;
const PATTERN_LOOKBEHIND_LENGTH = 96;

const sensitiveValueStartPattern =
  /\b(?:[A-Za-z_][A-Za-z0-9_]*(?:API_KEY|AUTH_TOKEN|TOKEN|SECRET|PASSWORD)[A-Za-z0-9_]*\s*=\s*|authorization\s*:\s*bearer\s+)/i;
const genericSecretStartPattern = /\b(?:sk-ant-|sk-)[A-Za-z0-9_-]{16}/i;
const STATIC_SENSITIVE_PREFIXES = [
  'authorization: bearer ',
  'local-development-secret',
  'sk-ant-',
  'sk-',
];

type DiscardedValueState = {
  quote: '"' | "'" | undefined;
};

function earliestMatch(
  value: string,
  patterns: RegExp[],
): { index: number; matchedText: string } | undefined {
  let earliest: { index: number; matchedText: string } | undefined;

  for (const pattern of patterns) {
    const match = pattern.exec(value);
    if (match && (!earliest || match.index < earliest.index)) {
      earliest = { index: match.index, matchedText: match[0] };
    }
  }

  return earliest;
}

export function createStreamingSecretRedactor(
  options: StreamingSecretRedactorOptions = {},
): StreamingSecretRedactor {
  const knownSecrets = Array.from(
    new Set(
      (options.knownSecrets ?? []).filter(
        (secret) => secret.length >= MIN_KNOWN_SECRET_LENGTH,
      ),
    ),
  ).sort((firstSecret, secondSecret) => secondSecret.length - firstSecret.length);
  const retainedTailLength = Math.max(
    PATTERN_LOOKBEHIND_LENGTH,
    ...knownSecrets.map((secret) => secret.length - 1),
  );
  let pendingText = '';
  let discardedValueState: DiscardedValueState | undefined;
  let streamEnded = false;

  const consumeDiscardedValue = (value: string): { output: string; remainder: string } => {
    if (!discardedValueState) {
      return { output: '', remainder: value };
    }

    if (discardedValueState.quote) {
      const closingQuoteIndex = value.indexOf(discardedValueState.quote);
      if (closingQuoteIndex === -1) {
        return { output: '', remainder: '' };
      }
      discardedValueState = undefined;
      return {
        output: value[closingQuoteIndex],
        remainder: value.slice(closingQuoteIndex + 1),
      };
    }

    const boundaryIndex = value.search(/\s/u);
    if (boundaryIndex === -1) {
      return { output: '', remainder: '' };
    }
    discardedValueState = undefined;
    return {
      output: value[boundaryIndex],
      remainder: value.slice(boundaryIndex + 1),
    };
  };

  const redactKnownSecrets = (value: string): string => {
    let redactedValue = value;
    for (const secret of knownSecrets) {
      redactedValue = redactedValue.split(secret).join(REDACTED_VALUE);
    }
    return redactedValue;
  };

  const possibleSensitiveSuffixStart = (value: string): number | undefined => {
    let earliestStart: number | undefined;
    const candidatePrefixes = [...knownSecrets, ...STATIC_SENSITIVE_PREFIXES];

    for (let startIndex = Math.max(0, value.length - retainedTailLength);
      startIndex < value.length;
      startIndex += 1) {
      const suffix = value.slice(startIndex);
      const normalizedSuffix = suffix.toLowerCase();
      const matchesPrefix = candidatePrefixes.some((candidatePrefix) =>
        candidatePrefix.toLowerCase().startsWith(normalizedSuffix),
      );
      if (matchesPrefix) {
        earliestStart = startIndex;
        break;
      }
    }

    const possibleEnvironmentAssignment =
      /(?:^|[^A-Za-z0-9_])([A-Z_][A-Z0-9_]*(?:\s*=\s*)?)$/u.exec(value);
    if (possibleEnvironmentAssignment) {
      const environmentStart = possibleEnvironmentAssignment.index
        + possibleEnvironmentAssignment[0].length
        - possibleEnvironmentAssignment[1].length;
      earliestStart = earliestStart === undefined
        ? environmentStart
        : Math.min(earliestStart, environmentStart);
    }

    return earliestStart;
  };

  const processPendingText = (releaseTail: boolean): string => {
    let output = '';

    while (pendingText.length > 0) {
      if (discardedValueState) {
        const consumedValue = consumeDiscardedValue(pendingText);
        output += consumedValue.output;
        pendingText = consumedValue.remainder;
        if (discardedValueState) {
          pendingText = '';
          return output;
        }
        continue;
      }

      pendingText = redactKnownSecrets(pendingText)
        .replace(/local-development-secret/gu, REDACTED_VALUE);

      const sensitiveStart = earliestMatch(pendingText, [
        sensitiveValueStartPattern,
        genericSecretStartPattern,
      ]);
      if (sensitiveStart) {
        const valueStartIndex = sensitiveStart.index + sensitiveStart.matchedText.length;
        const possibleQuote = pendingText[valueStartIndex];
        output += `${pendingText.slice(0, sensitiveStart.index)}${REDACTED_VALUE}`;
        discardedValueState = {
          quote: possibleQuote === '"' || possibleQuote === "'" ? possibleQuote : undefined,
        };
        pendingText = pendingText.slice(
          valueStartIndex + (discardedValueState.quote ? 1 : 0),
        );
        continue;
      }

      if (releaseTail) {
        output += pendingText;
        pendingText = '';
        return output;
      }

      const sensitiveSuffixStart = possibleSensitiveSuffixStart(pendingText);
      const releasableLength = sensitiveSuffixStart ?? pendingText.length;
      if (releasableLength <= 0) {
        return output;
      }
      output += pendingText.slice(0, releasableLength);
      pendingText = pendingText.slice(releasableLength);
    }

    return output;
  };

  return {
    push(chunk: string): string {
      if (streamEnded || chunk.length === 0) {
        return '';
      }
      pendingText += chunk;
      return processPendingText(false);
    },
    flush(): string {
      return streamEnded ? '' : processPendingText(false);
    },
    end(): string {
      if (streamEnded) {
        return '';
      }
      streamEnded = true;
      const output = processPendingText(true);
      pendingText = '';
      discardedValueState = undefined;
      return output;
    },
  };
}
