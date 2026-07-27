import type { Dispatcher } from 'undici';

// Node's global fetch (undici) defaults both headersTimeout and bodyTimeout to
// 300_000 ms. The Claude/Codex compat proxies forward long-lived SSE turns where
// the upstream relay can legitimately stay silent past 5 minutes (extended
// thinking, slow tool turns). The default abort then drops the connection
// mid-run — undici raises UND_ERR_HEADERS_TIMEOUT / UND_ERR_BODY_TIMEOUT — and
// the CLI stops as if the model quit. Codex's native-responses mode talks to the
// upstream directly (no proxy) so it never hits this, which is why Codex keeps
// running while Claude stalls.
//
// We forward through a dispatcher with both timeouts disabled (0) so only a real
// socket error or the client disconnecting (handled via response 'close' ->
// AbortController) ends the stream.

type UndiciAgentConstructor = new (options: {
  headersTimeout?: number;
  bodyTimeout?: number;
}) => Dispatcher;

let dispatcherPromise: Promise<Dispatcher | undefined> | undefined;

async function createStreamingDispatcher(): Promise<Dispatcher | undefined> {
  try {
    const undici = (await import('undici')) as { Agent: UndiciAgentConstructor };
    // headersTimeout: 0 -> never abort while waiting for the first response byte.
    // bodyTimeout: 0    -> never abort on a silent gap between SSE chunks.
    return new undici.Agent({ headersTimeout: 0, bodyTimeout: 0 });
  } catch {
    // undici is not resolvable (e.g. pruned from a packaged build). Fall back to
    // the default global fetch: sessions still work, only the 5-minute idle cap
    // remains. This keeps the proxy functional rather than failing to start.
    return undefined;
  }
}

/**
 * Lazily creates and caches a shared undici dispatcher that disables the request
 * timeouts which would otherwise abort long, silent streaming proxy turns.
 * Resolves to `undefined` when undici cannot be loaded so callers can fall back
 * to the default fetch behaviour.
 */
export function streamingProxyDispatcher(): Promise<Dispatcher | undefined> {
  dispatcherPromise ??= createStreamingDispatcher();
  return dispatcherPromise;
}
