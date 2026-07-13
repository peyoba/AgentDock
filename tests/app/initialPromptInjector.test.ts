import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialPromptInjector } from '../../src/main/initialPromptInjector';

afterEach(() => {
  vi.useRealTimers();
});

describe('createInitialPromptInjector', () => {
  it('waits for a chunk-split Codex prompt before writing once', async () => {
    const write = vi.fn();
    const injector = createInitialPromptInjector({
      tool: 'codex',
      prompt: 'test Codex restored memory',
      write,
    });

    injector.acceptOutput('╭─ >_ OpenAI Co');
    injector.acceptOutput('dex\nstarting tools');
    expect(write).not.toHaveBeenCalled();

    injector.acceptOutput('\n› ');
    injector.acceptOutput('\n› ');

    await expect(injector.completion).resolves.toBeUndefined();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('test Codex restored memory\r');
  });

  it('skips a chunk-split Codex update prompt before restoring memory once', async () => {
    const write = vi.fn();
    const injector = createInitialPromptInjector({
      tool: 'codex',
      prompt: 'test Codex restored memory',
      write,
    });

    injector.acceptOutput('╭─ >_ OpenAI Codex\nUpdate avail');
    injector.acceptOutput('able\n› 1. Update now\n  2. Sk');
    injector.acceptOutput('ip\n');
    injector.acceptOutput('Update available\n  1. Update now\n  2. Skip\nPress enter to continue\n');

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('\u001b[B\r');

    injector.acceptOutput('\n› ');
    injector.acceptOutput('\n› ');

    await expect(injector.completion).resolves.toBeUndefined();
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenNthCalledWith(2, 'test Codex restored memory\r');
  });

  it('recognizes the cursor-positioned Codex update menu emitted by the real PTY', () => {
    const write = vi.fn();
    const injector = createInitialPromptInjector({
      tool: 'codex',
      prompt: 'test Codex restored memory',
      write,
    });

    injector.acceptOutput('\u001b[2;1H✨ Update available! 0.144.3 -> 9.9.9\r');
    injector.acceptOutput('\u001b[6;1H› 1. Update now (runs `npm install -g @openai/codex`)');
    injector.acceptOutput('\u001b[7;3H2.\u001b[7;6HSkip\u001b[10;3HPress enter to continue');

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('\u001b[B\r');
    injector.cancel();
    void injector.completion.catch(() => undefined);
  });

  it('keeps the default Codex readiness window open beyond fifteen seconds', async () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const injector = createInitialPromptInjector({
      tool: 'codex',
      prompt: 'test slow Codex restored memory',
      write,
    });
    let outcome = 'pending';
    void injector.completion.then(
      () => { outcome = 'resolved'; },
      () => { outcome = 'rejected'; },
    );

    await vi.advanceTimersByTimeAsync(15_001);
    expect(outcome).toBe('pending');

    injector.acceptOutput('╭─ >_ OpenAI Codex\n› ');
    await expect(injector.completion).resolves.toBeUndefined();
    expect(write).toHaveBeenCalledWith('test slow Codex restored memory\r');
  });

  it('waits for a Claude input prompt before writing once', async () => {
    const write = vi.fn();
    const injector = createInitialPromptInjector({
      tool: 'claude',
      prompt: 'test Claude restored memory',
      write,
    });

    injector.acceptOutput('╭─── Cla');
    injector.acceptOutput('ude Code v-test\n');
    expect(write).not.toHaveBeenCalled();
    injector.acceptOutput('❯ ');
    injector.acceptOutput('❯ ');

    await expect(injector.completion).resolves.toBeUndefined();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('test Claude restored memory\r');
  });

  it('does not write when no initial prompt exists', async () => {
    const write = vi.fn();
    const injector = createInitialPromptInjector({
      tool: 'codex',
      prompt: '',
      write,
    });

    injector.acceptOutput('╭─ >_ OpenAI Codex\n› ');

    await expect(injector.completion).resolves.toBeUndefined();
    expect(write).not.toHaveBeenCalled();
  });

  it('rejects when the PTY exits before readiness', async () => {
    const write = vi.fn();
    const injector = createInitialPromptInjector({
      tool: 'codex',
      prompt: 'test restored memory',
      write,
    });

    injector.acceptOutput('╭─ >_ OpenAI Codex\nstarting');
    injector.exit();

    await expect(injector.completion).rejects.toThrow(/exit|ready/i);
    expect(write).not.toHaveBeenCalled();
  });

  it('rejects on readiness timeout without writing the prompt', async () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const injector = createInitialPromptInjector({
      tool: 'claude',
      prompt: 'test restored memory',
      write,
      timeoutMs: 5_000,
    });

    injector.acceptOutput('╭─── Claude Code\ninitializing');
    const completion = expect(injector.completion).rejects.toThrow(/timeout|ready/i);
    await vi.advanceTimersByTimeAsync(5_000);

    await completion;
    expect(write).not.toHaveBeenCalled();
  });

  it('settles cancellation as a recognizable non-success without writing', async () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const injector = createInitialPromptInjector({
      tool: 'codex',
      prompt: 'test cancelled restored memory',
      write,
      timeoutMs: 5_000,
    });

    injector.cancel();
    injector.acceptOutput('╭─ >_ OpenAI Codex\n› ');
    const outcome = await injector.completion.then(
      () => ({ status: 'resolved' as const }),
      (error: unknown) => ({ status: 'rejected' as const, error }),
    );

    expect(outcome.status).toBe('rejected');
    expect(outcome).toMatchObject({
      error: expect.objectContaining({ message: expect.stringMatching(/cancel/i) }),
    });
    expect(write).not.toHaveBeenCalled();
  });
});
