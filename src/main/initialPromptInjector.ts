export type InitialPromptTool = 'claude' | 'codex';

type InitialPromptInjector = {
  acceptOutput(data: string): void;
  exit(): void;
  completion: Promise<void>;
  cancel(): void;
};

const MAX_STARTUP_OUTPUT_LENGTH = 32 * 1024;

function isReady(tool: InitialPromptTool, startupOutput: string): boolean {
  if (tool === 'codex') {
    const bannerIndex = startupOutput.indexOf('>_ OpenAI Codex');
    return bannerIndex >= 0 && startupOutput.indexOf('›', bannerIndex) >= 0;
  }

  const bannerIndex = startupOutput.indexOf('Claude Code');
  return bannerIndex >= 0 && startupOutput.indexOf('❯', bannerIndex) >= 0;
}

export function createInitialPromptInjector({
  tool,
  prompt,
  write,
  timeoutMs = 15_000,
}: {
  tool: InitialPromptTool;
  prompt: string;
  write(input: string): void;
  timeoutMs?: number;
}): InitialPromptInjector {
  const initialPrompt = prompt.trim();
  let startupOutput = '';
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

      startupOutput = `${startupOutput}${data}`.slice(-MAX_STARTUP_OUTPUT_LENGTH);
      if (!isReady(tool, startupOutput)) {
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
