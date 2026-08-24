import type { CoreConfig } from './config.js';
import type { Entity } from './types.js';

const MAX_TITLE = 200;
const MAX_NAME = 60;
const MAX_LABEL = 30;
const MAX_LABELS = 8;
const MAX_ASSIGNEES = 5;
const MAX_PROJECT_PATH = 120;
const MAX_STATE = 30;

/** scheme://rest, plus the two schemes that carry a payload without a slash. */
const URL_LIKE = /\b[a-z][a-z0-9+.-]*:\/\/\S+|\bjavascript:\S*|\bdata:\S*/gi;

/** Markdown control characters that Adaptive Card TextBlock interprets. */
const MARKDOWN_DELIMITERS = /[[\]()]/g;
const MARKDOWN_EMPHASIS = /[*_`~|>#\\]/g;

/**
 * GitLab's own reference sigils. A GitLab user reads `!412` as merge
 * request 412 without being told, which is why the card carries no
 * separate "Merge request" label.
 */
const SIGIL: Readonly<Record<Entity['kind'], string>> = {
  merge_request: '!',
  issue: '#',
  epic: '&',
};

/**
 * Adaptive Card TextBlock renders a markdown subset INCLUDING links, so
 * a hostile GitLab title such as `[Click here](https://evil.example)`
 * would become a clickable phishing link inside Teams. See invariant I12
 * in SECURITY-REVIEW.md.
 *
 * URL-like substrings are removed outright rather than escaped, because
 * Teams may autolink a bare URL even without markdown syntax. A title
 * that legitimately contains a URL loses it, which is an acceptable
 * trade for removing the vector.
 */
function text(value: string, max: number): string {
  const flattened = value
    .replace(URL_LIKE, ' ')
    .replace(MARKDOWN_DELIMITERS, ' ')
    .replace(MARKDOWN_EMPHASIS, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return flattened.length > max ? `${flattened.slice(0, max - 1)}…` : flattened;
}

/** Only an https URL on the configured origin may enter a card. */
function safeUrl(raw: string, config: CoreConfig): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    if (url.username !== '' || url.password !== '') return null;
    if (url.origin !== config.origin) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function buildCard(entity: Entity, config: CoreConfig): object {
  const url = safeUrl(entity.webUrl, config);

  const facts: { title: string; value: string }[] = [
    { title: 'State', value: text(entity.state, MAX_STATE) },
    { title: 'Author', value: text(entity.author.name, MAX_NAME) },
  ];

  if (entity.assignees.length > 0) {
    facts.push({
      title: 'Assignees',
      value: entity.assignees
        .slice(0, MAX_ASSIGNEES)
        .map((assignee) => text(assignee.name, MAX_NAME))
        .join(', '),
    });
  }

  if (entity.labels.length > 0) {
    facts.push({
      title: 'Labels',
      value: entity.labels
        .slice(0, MAX_LABELS)
        .map((label) => text(label, MAX_LABEL))
        .join(', '),
    });
  }

  if (entity.pipeline !== undefined) {
    facts.push({ title: 'Pipeline', value: text(entity.pipeline.status, MAX_STATE) });
  }

  const headline = `${SIGIL[entity.kind]}${entity.iid}  ·  ${text(entity.title, MAX_TITLE)}`;

  return {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.3',
    body: [
      { type: 'TextBlock', text: headline, weight: 'Bolder', size: 'Medium', wrap: true },
      {
        type: 'TextBlock',
        text: text(entity.namespacePath, MAX_PROJECT_PATH),
        isSubtle: true,
        spacing: 'None',
        wrap: false,
      },
      { type: 'FactSet', facts },
    ],
    ...(url === null ? {} : { actions: [{ type: 'Action.OpenUrl', title: 'Open in GitLab', url }] }),
  };
}

function buildPreview(entity: Entity): object {
  return {
    contentType: 'application/vnd.microsoft.card.thumbnail',
    content: {
      title: text(entity.title, MAX_TITLE),
      text: `${text(entity.namespacePath, MAX_PROJECT_PATH)}${SIGIL[entity.kind]}${entity.iid}`,
    },
  };
}

/**
 * The full invoke response.
 *
 * `preview` is mandatory: without it Teams fails silently and shows
 * nothing, with no error anywhere.
 *
 * `no-cache` is a SECURITY control (I9), not a freshness optimisation.
 * Teams caches unfurl results for 30 minutes and does not document the
 * cache as keyed per user. With per-user tokens, a shared entry could
 * serve one user's card to another who has no access to that project.
 * Do not remove this for performance.
 */
export function buildUnfurlResponse(entity: Entity, config: CoreConfig): object {
  return {
    composeExtension: {
      type: 'result',
      attachmentLayout: 'list',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: buildCard(entity, config),
          preview: buildPreview(entity),
        },
      ],
      suggestedActions: {
        actions: [{ type: 'setCachePolicy', value: '{"type":"no-cache"}' }],
      },
    },
  };
}
