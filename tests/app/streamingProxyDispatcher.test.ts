import { describe, expect, it } from 'vitest';
import { Agent } from 'undici';
import { streamingProxyDispatcher } from '../../src/main/streamingProxyDispatcher';

describe('streamingProxyDispatcher', () => {
  it('resolves to an undici Agent so long silent SSE turns are not aborted', async () => {
    const dispatcher = await streamingProxyDispatcher();
    // undici is a declared dependency, so the dispatcher must be available; a
    // missing dispatcher would silently re-enable the 5-minute idle abort that
    // stops long Claude turns mid-run.
    expect(dispatcher).toBeInstanceOf(Agent);
  });

  it('caches a single shared dispatcher across calls', async () => {
    const first = await streamingProxyDispatcher();
    const second = await streamingProxyDispatcher();
    expect(second).toBe(first);
  });
});
