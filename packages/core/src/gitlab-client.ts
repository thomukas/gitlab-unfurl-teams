import type { CoreConfig } from './config.js';
import { SCOPE_OF } from './types.js';
import type { Entity, GitLabRef } from './types.js';

export type FetchFailure = 'not-found' | 'timeout' | 'too-large' | 'network' | 'bad-response';

export type FetchResult =
  | { readonly ok: true; readonly entity: Entity }
  | { readonly ok: false; readonly reason: FetchFailure };

const API_SEGMENT: Readonly<Record<GitLabRef['kind'], string>> = {
  merge_request: 'merge_requests',
  issue: 'issues',
  epic: 'epics',
};

/** Epics are read from /groups/:id/epics/:iid, everything else from /projects. */
const API_ROOT: Readonly<Record<'project' | 'group', string>> = {
  project: 'projects',
  group: 'groups',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Reads at most `max` bytes, cancelling the stream as soon as the cap is
 * passed (I13). A declared content-length over the cap short-circuits
 * before any body is read at all.
 */
async function readCapped(response: Response, max: number): Promise<string | null> {
  const declared = response.headers.get('content-length');
  if (declared !== null && Number.isFinite(Number(declared)) && Number(declared) > max) {
    return null;
  }

  const body = response.body;
  if (body === null) return '';

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

function readName(value: unknown): string {
  return isRecord(value) && typeof value.name === 'string' ? value.name : '';
}

function toEntity(ref: GitLabRef, raw: unknown): Entity | null {
  if (!isRecord(raw)) return null;

  const { title, state, web_url: webUrl, created_at: createdAt, updated_at: updatedAt } = raw;
  if (typeof title !== 'string' || typeof state !== 'string' || typeof webUrl !== 'string') {
    return null;
  }

  const assignees = Array.isArray(raw.assignees)
    ? raw.assignees.map((entry) => ({ name: readName(entry) }))
    : [];

  const labels = Array.isArray(raw.labels)
    ? raw.labels.filter((label): label is string => typeof label === 'string')
    : [];

  const rawPipeline = raw.head_pipeline ?? raw.pipeline;
  const pipeline =
    isRecord(rawPipeline) && typeof rawPipeline.status === 'string'
      ? { status: rawPipeline.status }
      : undefined;

  return {
    kind: ref.kind,
    title,
    state,
    namespacePath: ref.namespacePath,
    iid: ref.iid,
    webUrl,
    author: { name: readName(raw.author) },
    assignees,
    labels,
    ...(pipeline === undefined ? {} : { pipeline }),
    createdAt: typeof createdAt === 'string' ? createdAt : '',
    updatedAt: typeof updatedAt === 'string' ? updatedAt : '',
  };
}

/**
 * One request, to the configured origin only, with redirects refused.
 *
 * The ref supplies WHAT to fetch. The config supplies WHERE. A pasted
 * URL therefore cannot move the bearer token to another host (I2, I3).
 *
 * 403 and 404 collapse to a single reason so that callers cannot use the
 * application to enumerate private projects (I10).
 */
export async function fetchEntity(
  ref: GitLabRef,
  token: string,
  config: CoreConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<FetchResult> {
  const namespace = encodeURIComponent(ref.namespacePath);
  const root = API_ROOT[SCOPE_OF[ref.kind]];
  const url = `${config.origin}/api/v4/${root}/${namespace}/${API_SEGMENT[ref.kind]}/${ref.iid}`;

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, config.timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    });

    if (response.status === 403 || response.status === 404) {
      return { ok: false, reason: 'not-found' };
    }
    if (!response.ok) return { ok: false, reason: 'bad-response' };

    const text = await readCapped(response, config.maxResponseBytes);
    if (text === null) return { ok: false, reason: 'too-large' };

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, reason: 'bad-response' };
    }

    const entity = toEntity(ref, parsed);
    return entity === null ? { ok: false, reason: 'bad-response' } : { ok: true, entity };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, reason: 'timeout' };
    }
    // A refused redirect surfaces here too. Both are failures that must
    // never produce a card.
    return { ok: false, reason: 'network' };
  } finally {
    clearTimeout(timer);
  }
}
