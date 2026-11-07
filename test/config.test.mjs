import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { config } from '../server/config.mjs';
import { canvas } from '../remotion/src/lib/theme.ts';

test('defaults: models by role, localhost-only server, sane budgets', () => {
  assert.deepEqual(config.models, { director: 'claude-opus-5-5', coder: 'claude-sonnet-5-5', translator: 'claude-sonnet-5-5', editorHigh: 'claude-sonnet-5-5', editorFast: 'claude-haiku-5-5' });
  assert.equal(config.server.host, '127.0.0.1');
  assert.ok(config.budgetCeiling >= config.budgets.editHigh);
  for (const v of Object.values(config.budgets)) assert.ok(v > 0 && v <= config.budgetCeiling);
});

test('env vars override models, port and jobs dir', () => {
  const out = execFileSync('node', ['-e', "import('./server/config.mjs').then(m=>console.log(JSON.stringify([m.config.models.director,m.config.server.port,m.config.jobsDir])))"], {
    env: { ...process.env, INSTAEDITS_MODEL_DIRECTOR: 'x-model', PORT: '5555', INSTAEDITS_JOBS_DIR: '/tmp/jx' }, encoding: 'utf8',
  });
  assert.deepEqual(JSON.parse(out), ['x-model', 5555, '/tmp/jx']);
});

test('server canvas equals the Remotion canvas (single source of truth)', () => {
  assert.deepEqual(config.canvas, canvas);
});

test('no model ids hardcoded outside config.mjs', () => {
  for (const f of fs.readdirSync('server').filter((x) => x.endsWith('.mjs') && x !== 'config.mjs')) {
    assert.doesNotMatch(fs.readFileSync(`server/${f}`, 'utf8'), /claude-(opus|sonnet|haiku)-/, f);
  }
});

test('.env.example documents every env override config.mjs reads', () => {
  const src = fs.readFileSync('server/config.mjs', 'utf8');
  const ex = fs.readFileSync('.env.example', 'utf8');
  for (const name of new Set([...src.matchAll(/env\.([A-Z_]+)/g)].map((m) => m[1]))) assert.ok(ex.includes(name), `${name} missing from .env.example`);
});
