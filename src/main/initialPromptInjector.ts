import { terminalOutputToPlainText } from '../shared/terminalText.js';

export type InitialPromptTool = 'claude' | 'codex' | 'grok';

type InitialPromptInjector = {
  acceptOutput(data: string): void;
  exit(): void;
  completion: Promise<void>;
  cancel(): void;
};

const MAX_STARTUP_OUTPUT_LENGTH = 32 * 1024;
const DEFAULT_READINESS_TIMEOUT_MS = 60_000;

function hasCodexUpdateHeading(rawStartupOutput: string): boolean {
  return rawStartupOutput.includes('Update available');
}

function hasCompleteCodexUpdatePrompt(rawStartupOutput: string): boolean {
  return (
    hasCodexUpdateHeading(rawStartupOutput) &&
    rawStartupOutput.includes('Update now') &&
    rawStartupOutput.includes('2.') &&
    rawStartupOutput.includes('Skip') &&
    rawStartupOutput.includes('Press enter to continue')
  );
}

function isReady(
  tool: InitialPromptTool,
  startupOutput: string,
  bannerSeen: boolean,
): boolean {
  if (tool === 'codex') {
    return bannerSeen && startupOutput.includes('›');
  }
  if (tool === 'grok') {
    // Grok TUI prompt varies by theme; accept common prompt markers after banner.
    return (
      bannerSeen &&
      (startupOutput.includes('›') ||
        startupOutput.includes('❯') ||
        startupOutput.includes('> ') ||
        /(?:^|\n)\s*\/\s*$/m.test(startupOutput))
    );
  }

  return bannerSeen && startupOutput.includes('❯');
}

export function createInitialPromptInjector({
  tool,
  prompt,
  write,
  timeoutMs = DEFAULT_READINESS_TIMEOUT_MS,
}: {
  tool: InitialPromptTool;
  prompt: string;
  write(input: string): void;
  timeoutMs?: number;
}): InitialPromptInjector {
  const initialPrompt = prompt.trim();
  let rawStartupOutput = '';
  let startupOutput = '';
  let bannerSeen = false;
  let codexUpdatePromptSkipped = false;
  let settled = false;
  let resolveCompletion!: () => void;
  let rejectCompletion!: (error: Error) => void;

  const completion = new Promise<void>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });

  const timer = initialPrompt
    ? setTimeout(() => {
        rejectOnce(new Error('Initial prompt readiness timeout'));
      }, timeoutMs)
    : undefined;

  function clearReadinessTimer(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }

  function resolveOnce(): void {
    if (settled) {
      return;
    }
    settled = true;
    clearReadinessTimer();
    resolveCompletion();
  }

  function rejectOnce(error: Error): void {
    if (settled) {
      return;
    }
    settled = true;
    clearReadinessTimer();
    rejectCompletion(error);
  }

  if (!initialPrompt) {
    resolveOnce();
  }

  return {
    acceptOutput(data: string): void {
      if (settled || !data) {
        return;
      }

      rawStartupOutput = `${rawStartupOutput}${data}`.slice(-MAX_STARTUP_OUTPUT_LENGTH);
      startupOutput = terminalOutputToPlainText(rawStartupOutput);
      bannerSeen = bannerSeen || (
        tool === 'codex'
          ? startupOutput.includes('>_ OpenAI Codex')
          : tool === 'grok'
            ? /Grok/i.test(startupOutput) || startupOutput.includes('grok')
            // Newer Claude banners lay out "Claude" and "Code" with cursor
            // positioning rather than a literal space, so the stripped text can
            // read "ClaudeCode"; tolerate optional whitespace between the words.
            : /Claude\s*Code/.test(startupOutput)
      );

      if (tool === 'codex' && hasCodexUpdateHeading(rawStartupOutput)) {
        if (hasCompleteCodexUpdatePrompt(rawStartupOutput)) {
          if (!codexUpdatePromptSkipped) {
            codexUpdatePromptSkipped = true;
            try {
              write('\u001b[B\r');
            } catch {
              rejectOnce(new Error('Codex update prompt skip failed'));
              return;
            }
          }
          rawStartupOutput = '';
          startupOutput = '';
        }
        return;
      }

      if (!isReady(tool, startupOutput, bannerSeen)) {
        return;
      }

      settled = true;
      clearReadinessTimer();
      try {
        write(`${initialPrompt}\r`);
        resolveCompletion();
      } catch {
        rejectCompletion(new Error('Initial prompt write failed'));
      }
    },

    exit(): void {
      rejectOnce(new Error('PTY exited before the initial prompt was ready'));
    },

    completion,

    cancel(): void {
      rejectOnce(new Error('Initial prompt injection cancelled'));
    },
  };
}
