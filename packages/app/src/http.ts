/** Errors carry a fixed category only: upstream bodies/URLs may contain secrets. */
export class BoundaryError extends Error {
  constructor(readonly category: 'timeout' | 'too-large' | 'upstream' | 'bad-json') {
    super(category);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Counts actual streamed bytes, even when content-length is absent or dishonest. */
export async function readBounded(
  body: ReadableStream<Uint8Array> | null, max: number, signal: AbortSignal,
): Promise<string> {
  if (!body) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    for (;;) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      total += value.byteLength;
      if (total > max) throw new BoundaryError('too-large');
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    signal.removeEventListener('abort', cancel);
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function requestJson(
  url: URL | string, init: RequestInit, fetchImpl: typeof fetch = fetch,
  parentSignal?: AbortSignal,
): Promise<{ status: number; value: unknown }> {
  const signal = AbortSignal.any([AbortSignal.timeout(2000), ...(parentSignal ? [parentSignal] : [])]);
  try {
    const response = await fetchImpl(url, { ...init, redirect: 'error', signal });
    const text = await readBounded(response.body, 256 * 1024, signal);
    if (!response.ok && response.status !== 404) throw new BoundaryError('upstream');
    if (response.status === 404 || response.status === 204 || text === '') return { status: response.status, value: null };
    try { return { status: response.status, value: JSON.parse(text) as unknown }; }
    catch { throw new BoundaryError('bad-json'); }
  } catch (error) {
    if (error instanceof BoundaryError) throw error;
    throw new BoundaryError(signal.aborted ? 'timeout' : 'upstream');
  }
}
