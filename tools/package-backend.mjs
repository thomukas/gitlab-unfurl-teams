#!/usr/bin/env node
import { build } from 'esbuild';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'artifacts');
const stage = join(out, 'backend');
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
const result = await build({
  absWorkingDir: root, entryPoints: ['hosts/azure/src/index.ts'], outfile: join(stage, 'app.mjs'),
  bundle: true, platform: 'node', target: 'node22', format: 'esm', metafile: true,
  legalComments: 'linked', banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
writeFileSync(join(stage, 'package.json'), JSON.stringify({ name: 'gitlab-unfurl-teams-runtime', private: true, type: 'module', engines: { node: '>=22' }, scripts: { start: 'node app.mjs' } }, null, 2));
writeFileSync(join(stage, 'build.json'), JSON.stringify({ commit, nodeTarget: '22', previewDefault: 'link' }, null, 2));
copyFileSync(join(root, 'LICENSE'), join(stage, 'LICENSE'));
const components = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  if (!input.includes('node_modules/')) continue;
  let dir = dirname(resolve(root, input));
  while (dir !== root && dir !== dirname(dir)) {
    const file = join(dir, 'package.json');
    if (existsSync(file)) {
      const pkg = JSON.parse(readFileSync(file, 'utf8'));
      if (pkg.name && pkg.version) {
        const purl = `pkg:npm/${pkg.name.split('/').map(encodeURIComponent).join('/')}@${encodeURIComponent(pkg.version)}`;
        components.set(purl, { type: 'library', name: pkg.name, version: pkg.version, purl, 'bom-ref': purl });
        break;
      }
    }
    dir = dirname(dir);
  }
}
writeFileSync(join(out, 'backend.cdx.json'), JSON.stringify({ bomFormat: 'CycloneDX', specVersion: '1.5', serialNumber: `urn:uuid:${randomUUID()}`, version: 1,
  metadata: { timestamp: new Date().toISOString(), component: { type: 'application', name: 'gitlab-unfurl-teams', version: commit } },
  components: [...components.values()].sort((a, b) => a.name.localeCompare(b.name)),
}, null, 2));
const zip = join(out, 'gitlab-unfurl-backend.zip');
rmSync(zip, { force: true });
execFileSync('zip', ['-q', '-r', zip, '.'], { cwd: stage });
const filenames = ['gitlab-unfurl-backend.zip', 'backend.cdx.json'];
writeFileSync(join(out, 'SHA256SUMS'), filenames.map((name) => `${createHash('sha256').update(readFileSync(join(out, name))).digest('hex')}  ${name}`).join('\n') + '\n');
console.log(`Built ${zip} at commit ${commit}`);
