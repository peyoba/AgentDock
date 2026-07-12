import {
  createStreamingSecretRedactor,
  type StreamingSecretRedactorOptions,
} from './streamingSecretRedactor.js';
import { createStreamingTerminalTextSanitizer } from './streamingTerminalTextSanitizer.js';

export type StreamingPersistenceSanitizer = {
  push(chunk: string): string;
  flush(): string;
  end(): string;
};

export type StreamingPersistenceSanitizerOptions = StreamingSecretRedactorOptions;

export function createStreamingPersistenceSanitizer(
  options: StreamingPersistenceSanitizerOptions = {},
): StreamingPersistenceSanitizer {
  const terminalTextSanitizer = createStreamingTerminalTextSanitizer();
  const secretRedactor = createStreamingSecretRedactor(options);
  let streamEnded = false;

  return {
    push(chunk: string): string {
      if (streamEnded) {
        return '';
      }
      return secretRedactor.push(terminalTextSanitizer.push(chunk));
    },
    flush(): string {
      if (streamEnded) {
        return '';
      }
      return secretRedactor.push(terminalTextSanitizer.flush()) + secretRedactor.flush();
    },
    end(): string {
      if (streamEnded) {
        return '';
      }
      streamEnded = true;
      return secretRedactor.push(terminalTextSanitizer.end()) + secretRedactor.end();
    },
  };
}
