import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { STEP_DEFS, createJob } from '../server/pipeline.mjs';
import { MODELS } from '../server/claude.mjs';
import { SCENE_KINDS } from '../server/catalog.mjs';

test('step order is fixed and creative decisions precede execution', () => {
  assert.deepEqual(STEP_DEFS('high').map((s) => s.key), ['probe', 'transcribe', 'tighten', 'translate', 'direction', 'resolve', 'codegen', 'render', 'edit', 'verify']);
});

test('models: Opus directs, Sonnet codes, Sonnet/Haiku edit by quality', () => {
  const m = (q, k) => STEP_DEFS(q).find((s) => s.key === k).model;
  assert.equal(m('high', 'direction'), MODELS.opus);
  assert.equal(m('high', 'codegen'), MODELS.sonnet);
  assert.equal(m('high', 'edit'), MODELS.sonnet);
  assert.equal(m('fast', 'edit'), MODELS.haiku);
});

test('only translate, direction, codegen and edit use an LLM', () => {
  const llm = STEP_DEFS('high').filter((s) => /claude/.test(s.model)).map((s) => s.key);
  assert.deepEqual(llm, ['translate', 'direction', 'codegen', 'edit']);
});

test('createJob validates input before touching disk', () => {
  assert.throws(() => createJob({ script: 'hi', video: '/definitely/not/here.mp4' }), /video not found/);
});

test('createJob sets budgets by quality and creates the job dir', () => {
  const tmp = fs.mkdtempSync('/tmp/ie-'); const v = path.join(tmp, 'v.mp4'); fs.writeFileSync(v, 'x');
  const id = `test-${Date.now()}`;
  const j = createJob({ script: 'hello', video: v, quality: 'fast', jobId: id });
  try {
    assert.equal(j.state.budgets.edit, 1.5);
    assert.ok(fs.existsSync(path.join(j.dir, 'state.json')));
    assert.equal(j.state.steps.length, 10);
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

// ───────── validation, queueing and resume ─────────
import { runJob, startJob, resumeJob, getJob } from '../server/pipeline.mjs';
import { config } from '../server/config.mjs';

const tmpVideo = () => { const d = fs.mkdtempSync('/tmp/ie-'); const v = path.join(d, 'v.mp4'); fs.writeFileSync(v, 'x'); return { d, v }; };

test('createJob rejects traversal ids, bad quality, unknown or oversized budgets, bad video types', () => {
  const { d, v } = tmpVideo();
  try {
    assert.throws(() => createJob({ script: 's', video: v, jobId: '../../evil' }), /invalid job id/);
    assert.throws(() => createJob({ script: 's', video: v, quality: 'ultra' }), /quality/);
    assert.throws(() => createJob({ script: 's', video: v, budgets: { edit: 999 } }), /between 0 and/);
    assert.throws(() => createJob({ script: 's', video: v, budgets: { edit: -1 } }), /between 0 and/);
    assert.throws(() => createJob({ script: 's', video: v, budgets: { evil: 1 } }), /unknown budget/);
    assert.throws(() => createJob({ script: 5, video: v }), /script must be text/);
    assert.throws(() => createJob({ script: 's', video: v, language: 'Hindi' }), /language must be/);
    assert.throws(() => createJob({ script: 's', video: v, language: 'e' }), /language must be/);
    assert.throws(() => createJob({ script: 's', video: v, budgets: { translate: 50 } }), /between 0 and/);
    assert.throws(() => createJob({ script: 's', video: '/etc/hosts' }), /must be one of/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('createJob honours valid budget overrides but keeps other defaults', () => {
  const { d, v } = tmpVideo(); const id = `t-${Date.now()}`;
  const j = createJob({ script: 's', video: v, jobId: id, budgets: { edit: 0.25 } });
  try {
    assert.equal(j.state.budgets.edit, 0.25);
    assert.equal(j.state.budgets.direction, config.budgets.direction);
    assert.equal(j.state.status, 'queued');
  } finally { fs.rmSync(j.dir, { recursive: true, force: true }); fs.rmSync(d, { recursive: true, force: true }); }
});

test('budgets by quality come from config', () => {
  const { d, v } = tmpVideo();
  const a = createJob({ script: 's', video: v, quality: 'high', jobId: `th-${Date.now()}` });
  const b = createJob({ script: 's', video: v, quality: 'fast', jobId: `tf-${Date.now()}` });
  try { assert.equal(a.state.budgets.edit, config.budgets.editHigh); assert.equal(b.state.budgets.edit, config.budgets.editFast); }
  finally { for (const j of [a, b]) fs.rmSync(j.dir, { recursive: true, force: true }); fs.rmSync(d, { recursive: true, force: true }); }
});

test('runJob/startJob refuse unknown steps; resumeJob refuses bad ids, missing jobs', async () => {
  const { d, v } = tmpVideo();
  const j = createJob({ script: 's', video: v, jobId: `ts-${Date.now()}` });
  try {
    await assert.rejects(() => runJob(j, { from: 'nope' }), /unknown step/);
    assert.throws(() => startJob(j, { from: 'nope' }), /unknown step/);
    assert.throws(() => resumeJob('../x'), /invalid job id/);
    assert.throws(() => resumeJob('does-not-exist-123'), /no such job/);
    assert.throws(() => resumeJob(j.id), /already queued/, 'a queued job cannot be resumed twice');
    assert.equal(getJob('../../etc'), null);
  } finally { fs.rmSync(j.dir, { recursive: true, force: true }); fs.rmSync(d, { recursive: true, force: true }); }
});

test('a job cancelled before it starts never runs a step', async () => {
  const { d, v } = tmpVideo();
  const j = createJob({ script: 's', video: v, jobId: `tc-${Date.now()}` });
  try {
    j.abort.abort();
    await runJob(j);
    assert.equal(j.state.status, 'cancelled');
    assert.ok(j.state.steps.every((s) => s.status === 'pending'));
  } finally { fs.rmSync(j.dir, { recursive: true, force: true }); fs.rmSync(d, { recursive: true, force: true }); }
});

import { recoverStaleJobs } from '../server/pipeline.mjs';
test('recoverStaleJobs marks interrupted jobs as resumable errors, leaves finished ones alone', () => {
  const { d, v } = tmpVideo();
  const a = createJob({ script: 's', video: v, jobId: `tr-a-${Date.now()}` }); // queued
  const b = createJob({ script: 's', video: v, jobId: `tr-b-${Date.now()}` });
  b.state.status = 'done'; fs.writeFileSync(path.join(b.dir, 'state.json'), JSON.stringify(b.state));
  a.state.status = 'running'; a.state.steps[1].status = 'running';
  fs.writeFileSync(path.join(a.dir, 'state.json'), JSON.stringify(a.state));
  try {
    assert.ok(recoverStaleJobs() >= 1);
    const disk = JSON.parse(fs.readFileSync(path.join(a.dir, 'state.json'), 'utf8'));
    assert.equal(disk.status, 'error'); assert.equal(disk.interrupted, true);
    assert.equal(disk.steps[1].status, 'error'); assert.match(disk.steps[1].error, /interrupted/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(b.dir, 'state.json'), 'utf8')).status, 'done');
    // now it can be resumed (it would have been stuck "running" forever before)
    assert.doesNotThrow(() => { const j = resumeJob(a.id, 'probe'); j.abort.abort(); });
  } finally { for (const j of [a, b]) fs.rmSync(j.dir, { recursive: true, force: true }); fs.rmSync(d, { recursive: true, force: true }); }
});

test('the script is OPTIONAL: no script is fine, language defaults to en, provided flag is recorded', () => {
  const { d, v } = tmpVideo();
  const a = createJob({ video: v, jobId: `tn-a-${Date.now()}` });
  const b = createJob({ script: '  ', video: v, language: 'hi', jobId: `tn-b-${Date.now()}` });
  const c = createJob({ script: 'hello', video: v, jobId: `tn-c-${Date.now()}` });
  try {
    assert.equal(a.state.language, 'en'); assert.equal(a.state.scriptProvided, false);
    assert.equal(b.state.language, 'hi'); assert.equal(b.state.scriptProvided, false);
    assert.equal(c.state.scriptProvided, true);
    assert.ok(!fs.existsSync(path.join(a.dir, 'script.txt')), 'no empty script file');
    assert.ok(fs.existsSync(path.join(c.dir, 'script.txt')));
    assert.equal(a.state.budgets.translate, config.budgets.translate);
    assert.equal(a.state.steps.find((s) => s.key === 'translate').model, config.models.translator);
  } finally { for (const j of [a, b, c]) fs.rmSync(j.dir, { recursive: true, force: true }); fs.rmSync(d, { recursive: true, force: true }); }
});

test('re-running a step clears its previous error (no stale error on a successful run)', async () => {
  const { d, v } = tmpVideo();
  const j = createJob({ script: 's', video: v, jobId: `te-${Date.now()}` });
  try {
    j.state.steps[0].error = 'old failure'; j.state.steps[0].status = 'error';
    await runJob(j, { from: 'probe' }).catch(() => {}); // probe fails on a fake file, which is fine: we only check the old error is gone
    assert.notEqual(j.state.steps[0].error, 'old failure');
  } finally { fs.rmSync(j.dir, { recursive: true, force: true }); fs.rmSync(d, { recursive: true, force: true }); }
});
