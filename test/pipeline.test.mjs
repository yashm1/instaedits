import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { STEP_DEFS, createJob } from '../server/pipeline.mjs';
import { MODELS } from '../server/claude.mjs';
import { SCENE_KINDS } from '../server/catalog.mjs';

test('step order is fixed and creative decisions precede execution', () => {
  assert.deepEqual(STEP_DEFS('high').map((s) => s.key), ['probe', 'transcribe', 'tighten', 'direction', 'resolve', 'codegen', 'render', 'edit', 'verify']);
});

test('models: Opus directs, Sonnet codes, Sonnet/Haiku edit by quality', () => {
  const m = (q, k) => STEP_DEFS(q).find((s) => s.key === k).model;
  assert.equal(m('high', 'direction'), MODELS.opus);
  assert.equal(m('high', 'codegen'), MODELS.sonnet);
  assert.equal(m('high', 'edit'), MODELS.sonnet);
  assert.equal(m('fast', 'edit'), MODELS.haiku);
});

test('only direction, codegen and edit use an LLM', () => {
  const llm = STEP_DEFS('high').filter((s) => /claude/.test(s.model)).map((s) => s.key);
  assert.deepEqual(llm, ['direction', 'codegen', 'edit']);
});

test('createJob validates input before touching disk', () => {
  assert.throws(() => createJob({ script: '', video: '/x' }), /script is required/);
  assert.throws(() => createJob({ script: 'hi', video: '/definitely/not/here.mp4' }), /video not found/);
});

test('createJob sets budgets by quality and creates the job dir', () => {
  const tmp = fs.mkdtempSync('/tmp/ie-'); const v = path.join(tmp, 'v.mp4'); fs.writeFileSync(v, 'x');
  const id = `test-${Date.now()}`;
  const j = createJob({ script: 'hello', video: v, quality: 'fast', jobId: id });
  try {
    assert.equal(j.state.budgets.edit, 1.5);
    assert.ok(fs.existsSync(path.join(j.dir, 'state.json')));
    assert.equal(j.state.steps.length, 9);
  } finally { fs.rmSync(j.dir, { recursive: true, force: true }); fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('library docs and catalog cannot drift from the real Remotion components', () => {
  const src = fs.readFileSync('remotion/src/lib/index.tsx', 'utf8');
  const doc = fs.readFileSync('remotion/LIBRARY.md', 'utf8');
  for (const k of SCENE_KINDS) {
    assert.match(src, new RegExp(`export const ${k}\\b`), `${k} not exported by the library`);
    assert.match(doc, new RegExp('`' + k + ' \\{'), `${k} not documented in LIBRARY.md`);
  }
});

test('Remotion library typechecks (catches prop-type drift before a render does)', { timeout: 120000 }, () => {
  if (!fs.existsSync('remotion/src/Scenes.tsx')) fs.copyFileSync('remotion/src/Scenes.default.tsx', 'remotion/src/Scenes.tsx');
  execFileSync('npx', ['tsc', '--noEmit'], { cwd: 'remotion', stdio: 'pipe' });
});
