import { describe, it, expect } from 'vitest';
import { buildCard, buildUnfurlResponse } from '../src/card-builder.js';
import type { CoreConfig } from '../src/config.js';
import type { Entity } from '../src/types.js';

const cfg: CoreConfig = {
  origin: 'https://gitlab.example.com',
  projectAllowlist: [],
  timeoutMs: 3000,
  maxResponseBytes: 262144,
};

const base: Entity = {
  kind: 'merge_request',
  title: 'Add the thing',
  state: 'opened',
  namespacePath: 'g/p',
  iid: 42,
  webUrl: 'https://gitlab.example.com/g/p/-/merge_requests/42',
  author: { name: 'Ada' },
  assignees: [{ name: 'Grace' }],
  labels: ['backend'],
  pipeline: { status: 'success' },
  createdAt: '2026-08-01T10:00:00Z',
  updatedAt: '2026-08-02T10:00:00Z',
};

const json = (value: unknown) => JSON.stringify(value);

describe('buildCard', () => {
  it('pins Adaptive Card version 1.3', () => {
    expect(buildCard(base, cfg)).toMatchObject({ type: 'AdaptiveCard', version: '1.3' });
  });

  it('leads with the sigil and number, then the title', () => {
    const serialised = json(buildCard(base, cfg));
    expect(serialised).toContain('!42');
    expect(serialised).toContain('Add the thing');
  });

  it('uses the issue sigil for issues', () => {
    expect(json(buildCard({ ...base, kind: 'issue' }, cfg))).toContain('#42');
  });

  it('uses the epic sigil for epics', () => {
    expect(json(buildCard({ ...base, kind: 'epic' }, cfg))).toContain('&42');
  });

  it('puts the project path on its own line', () => {
    const body = (buildCard(base, cfg) as { body: { text?: string }[] }).body;
    expect(body[1]!.text).toBe('g/p');
  });

  // The sigil already tells a GitLab user the type, so the label would
  // be a wasted line in a card people scan.
  it('carries no redundant type label', () => {
    const serialised = json(buildCard(base, cfg));
    expect(serialised).not.toContain('Merge request');
    expect(json(buildCard({ ...base, kind: 'issue' }, cfg))).not.toContain('"Issue"');
  });

  it('uses three body elements, not four', () => {
    const body = (buildCard(base, cfg) as { body: unknown[] }).body;
    expect(body).toHaveLength(3);
  });

  // I12: TextBlock renders markdown including links, so a hostile title
  // would otherwise become a clickable phishing link inside Teams.
  it('neutralises markdown link syntax in a hostile title', () => {
    const hostile: Entity = { ...base, title: '[Click here](https://evil.example)' };
    const serialised = json(buildCard(hostile, cfg));
    expect(serialised).not.toContain('](https://evil.example)');
    expect(serialised).not.toContain('evil.example');
  });

  it('strips a bare URL from a title, which Teams may autolink', () => {
    const hostile: Entity = { ...base, title: 'See https://evil.example/steal now' };
    expect(json(buildCard(hostile, cfg))).not.toContain('evil.example');
  });

  it.each(['javascript:alert(1)', 'data:text/html,x'])(
    'strips the %s scheme from a title',
    (scheme) => {
      const hostile: Entity = { ...base, title: `click ${scheme}` };
      expect(json(buildCard(hostile, cfg))).not.toContain(scheme);
    },
  );

  it('bounds an over-long title', () => {
    const long: Entity = { ...base, title: 'x'.repeat(1000) };
    expect(json(buildCard(long, cfg))).not.toContain('x'.repeat(300));
  });

  it('bounds the number of labels', () => {
    const many: Entity = {
      ...base,
      labels: Array.from({ length: 50 }, (_, index) => `label${index}`),
    };
    expect(json(buildCard(many, cfg))).not.toContain('label20');
  });

  it('bounds the number of assignees', () => {
    const many: Entity = {
      ...base,
      assignees: Array.from({ length: 20 }, (_, index) => ({ name: `person${index}` })),
    };
    expect(json(buildCard(many, cfg))).not.toContain('person15');
  });

  it('drops a webUrl that is not on the configured origin', () => {
    const evil: Entity = { ...base, webUrl: 'https://evil.example/x' };
    expect(json(buildCard(evil, cfg))).not.toContain('evil.example');
  });

  it.each(['javascript:alert(1)', 'data:text/html,x', 'http://gitlab.example.com/x'])(
    'drops the unsafe webUrl %s',
    (bad) => {
      expect(json(buildCard({ ...base, webUrl: bad }, cfg))).not.toContain(bad);
    },
  );

  it('keeps a safe webUrl as an open action', () => {
    expect(json(buildCard(base, cfg))).toContain('Action.OpenUrl');
  });

  it('includes no image element, because avatars are dropped in v1', () => {
    expect(json(buildCard(base, cfg))).not.toContain('"Image"');
  });
});

describe('buildUnfurlResponse', () => {
  const response = buildUnfurlResponse(base, cfg) as {
    composeExtension: {
      type: string;
      attachmentLayout: string;
      attachments: { contentType: string; preview?: unknown }[];
      suggestedActions: { actions: unknown[] };
    };
  };

  it('includes a preview attachment, without which Teams fails silently', () => {
    expect(response.composeExtension.attachments[0]!.preview).toBeDefined();
  });

  it('uses the result type and list layout', () => {
    expect(response.composeExtension).toMatchObject({
      type: 'result',
      attachmentLayout: 'list',
    });
  });

  // I9: a security control, not a freshness optimisation. Teams caches
  // unfurl results for 30 minutes and does not document the cache as
  // per-user, so a shared entry could serve one user's card to another.
  it('always sets no-cache', () => {
    expect(response.composeExtension.suggestedActions.actions[0]).toEqual({
      type: 'setCachePolicy',
      value: '{"type":"no-cache"}',
    });
  });

  it('keeps the full canonical reference in the compose-box preview', () => {
    const preview = (response.composeExtension.attachments[0] as unknown as {
      preview: { content: { text: string } };
    }).preview;
    expect(preview.content.text).toBe('g/p!42');
  });

  it('uses the adaptive card content type', () => {
    expect(response.composeExtension.attachments[0]!.contentType).toBe(
      'application/vnd.microsoft.card.adaptive',
    );
  });
});
