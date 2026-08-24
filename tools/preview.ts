/**
 * LOCAL PREVIEW TOOL — never part of a deployment.
 *
 * Fetches a real GitLab entity with YOUR token, builds the real card, and
 * writes an HTML page that renders it with Microsoft's own Adaptive Cards
 * renderer. Open the page to see exactly what Teams will show.
 *
 *   GITLAB_TOKEN=<read_api token> pnpm preview <gitlab-url>
 *
 * The token here is a developer convenience for local inspection. The
 * deployed application never uses one: it acts as the signed-in Teams user
 * via OAuth. See SECURITY-REVIEW.md.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildCard,
  buildUnfurlResponse,
  fetchEntity,
  loadCoreConfig,
  validateUrl,
  type Entity,
} from '../packages/core/src/index.js';

const arg = process.argv[2];
const token = process.env.GITLAB_TOKEN;

/** Offline sample, so the card can be seen with no token and no network. */
const SAMPLE: Entity = {
  kind: 'merge_request',
  title: 'Add rate limiting to the public API',
  state: 'opened',
  namespacePath: 'platform/api',
  iid: 412,
  webUrl: 'https://gitlab.com/platform/api/-/merge_requests/412',
  author: { name: 'Ada Lovelace' },
  assignees: [{ name: 'Grace Hopper' }, { name: 'Katherine Johnson' }],
  labels: ['backend', 'security', 'needs-review'],
  pipeline: { status: 'success' },
  createdAt: '2026-08-01T10:00:00Z',
  updatedAt: '2026-08-02T10:00:00Z',
};

if (arg === undefined) {
  console.error('Usage:');
  console.error('  pnpm preview --sample                       offline, no token');
  console.error('  GITLAB_TOKEN=<token> pnpm preview <url>     live GitLab data');
  process.exit(1);
}

let entity: Entity;
let config;

if (arg === '--sample') {
  config = loadCoreConfig({ GITLAB_ORIGIN: 'https://gitlab.com' });
  entity = SAMPLE;
  console.log('Rendering the offline sample. No token used, no network call.');
} else {
  config = loadCoreConfig({ GITLAB_ORIGIN: new URL(arg).origin });

  const validated = validateUrl(arg, config);
  if (!validated.ok) {
    console.error(`Rejected by the validator: ${validated.reason}`);
    console.error('That is the security control doing its job.');
    process.exit(1);
  }
  console.log(`Validated -> ${JSON.stringify(validated.ref)}`);

  if (token === undefined || token === '') {
    console.error('\nSet GITLAB_TOKEN (read_api) for live data, or use --sample.');
    process.exit(1);
  }

  const result = await fetchEntity(validated.ref, token, config);
  if (!result.ok) {
    console.error(`GitLab fetch failed: ${result.reason}`);
    process.exit(1);
  }
  entity = result.entity;
}

const card = buildCard(entity, config);
const response = buildUnfurlResponse(entity, config) as {
  composeExtension: { attachments: { preview: { content: { title: string; text: string } } }[] };
};
const preview = response.composeExtension.attachments[0]!.preview.content;

const escape = (value: string) =>
  value.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] ?? c);

const page = `<!doctype html>
<html><head><meta charset="utf-8"><title>Card preview</title>
<script src="https://unpkg.com/adaptivecards@3.0.4/dist/adaptivecards.min.js"></script>
<style>
  body { font-family: -apple-system, "Segoe UI", sans-serif; background:#f5f5f5; margin:0; padding:2rem; }
  h2 { font-size:.8rem; text-transform:uppercase; letter-spacing:.06em; color:#555; }
  .frame { background:#fff; border:1px solid #e1e1e1; border-radius:6px; padding:1rem; max-width:480px; margin-bottom:2rem; }
  .thumb { background:#fff; border:1px solid #e1e1e1; border-radius:6px; padding:.75rem 1rem; max-width:480px; margin-bottom:2rem; }
  .thumb .t { font-weight:600; } .thumb .s { color:#666; font-size:.85rem; }
  pre { background:#1e1e1e; color:#d4d4d4; padding:1rem; border-radius:6px; overflow:auto; max-width:900px; font-size:.72rem; }
</style></head><body>
<h2>Compose box preview — before you send</h2>
<div class="thumb"><div class="t">${escape(preview.title)}</div><div class="s">${escape(preview.text)}</div></div>
<h2>Full card — after you send</h2>
<div class="frame" id="card"></div>
<h2>Card JSON — paste into adaptivecards.io/designer to edit visually</h2>
<pre>${escape(JSON.stringify(card, null, 2))}</pre>
<script>
  const ac = new AdaptiveCards.AdaptiveCard();
  ac.hostConfig = new AdaptiveCards.HostConfig({ fontFamily: "Segoe UI, sans-serif" });
  ac.parse(${JSON.stringify(card)});
  document.getElementById('card').appendChild(ac.render());
</script></body></html>`;

const out = fileURLToPath(new URL('../preview.html', import.meta.url));
writeFileSync(out, page);
console.log(`\nWrote ${out}\nOpen it in a browser to see the rendered card.`);
