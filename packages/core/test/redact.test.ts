import { describe, it, expect } from 'vitest';
import { hashProjectPath, safeLogFields } from '../src/redact.js';

describe('hashProjectPath', () => {
  it('is stable', () => {
    expect(hashProjectPath('a/b')).toBe(hashProjectPath('a/b'));
  });

  it('differs for different paths', () => {
    expect(hashProjectPath('a/b')).not.toBe(hashProjectPath('a/c'));
  });

  it('does not contain the original path', () => {
    expect(hashProjectPath('acquisition/project-x')).not.toContain('acquisition');
  });
});

describe('safeLogFields', () => {
  const fields = safeLogFields({
    ref: { kind: 'merge_request', namespacePath: 'acquisition/project-x', iid: 42 },
    origin: 'https://gitlab.example.com',
    outcome: 'ok',
    latencyMs: 182,
  });

  it('includes the permitted fields', () => {
    expect(fields).toMatchObject({
      entity: 'merge_request',
      host: 'gitlab.example.com',
      outcome: 'ok',
      latency_ms: 182,
    });
  });

  it('never includes the raw project path or the entity number', () => {
    const serialised = JSON.stringify(fields);
    expect(serialised).not.toContain('acquisition');
    expect(serialised).not.toContain('project-x');
    expect(serialised).not.toContain('42');
  });

  it('omits entity fields when there is no ref', () => {
    const bare = safeLogFields({
      origin: 'https://g.example.com',
      outcome: 'rejected',
      latencyMs: 1,
    });
    expect(bare.entity).toBeUndefined();
    expect(bare.namespace).toBeUndefined();
  });
});
