#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'gitlab-unfurl-package-'));
const probe = createServer();
probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = probe.address().port;
await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
let child;
try {
  execFileSync('unzip', ['-q', join(root, 'artifacts/gitlab-unfurl-backend.zip'), '-d', temp]);
  assert.equal(JSON.parse(readFileSync(join(temp, 'package.json'), 'utf8')).scripts.start, 'node app.mjs');
  child = spawn(process.execPath, ['app.mjs'], { cwd: temp, stdio: ['ignore', 'pipe', 'pipe'], env: {
    PORT: String(port), BOT_ID: '11111111-1111-4111-8111-111111111111',
    BOT_TENANT_ID: '22222222-2222-4222-8222-222222222222', PREVIEW_MODE: 'link',
    GITLAB_ORIGIN: 'https://gitlab.example.com',
  } });
  const startup = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Packaged server did not start')), 5000);
    child.once('error', reject);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Packaged server exited: ${code}`)); });
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('listening')) { clearTimeout(timer); resolve(); }
    });
  });
  await startup;
  assert.equal((await fetch(`http://127.0.0.1:${port}/healthz`)).status, 200);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/messages`, { method: 'POST', body: '{}' })).status, 401);
  const sbom = JSON.parse(readFileSync(join(root, 'artifacts/backend.cdx.json'), 'utf8'));
  assert.equal(sbom.bomFormat, 'CycloneDX');
  for (const dependency of ['hono', '@hono/node-server', 'jose']) assert(sbom.components.some((item) => item.name === dependency));
  console.log('Packaged server starts without node_modules; liveness and unauthenticated denial verified.');
} finally {
  if (child && child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
  rmSync(temp, { recursive: true, force: true });
}
