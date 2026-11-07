import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { STEP_DEFS, createJob } from '../server/pipeline.mjs';
import { MODELS } from '../server/claude.mjs';
import { SCENE_KINDS } from '../server/catalog.mjs';

test('step order is fixed and creative decisions precede execution', () => {
  assert.deepEqual(STEP_DEFS('high').map((s) => s.key), ['probe', 'transcribe', 'tighten', 'translate', 'direction', 'assets', 'resolve', 'captions', 'audio', 'graphics', 'composite', 'verify']);
});

test('models: Opus directs; rendering is local; the Edits edit is plain tool calls (a model only writes Hinglish)', () => {
  const m = (q, k) => STEP_DEFS(q).find((s) => s.key === k).model;
  assert.equal(m('high', 'direction'), MODELS.opus);
  assert.match(m('high', 'graphics'), /^local/); assert.match(m('high', 'composite'), /^local/);
  assert.equal(m('high', 'audio'), 'local (Edits tool calls)', 'the Edits step uses no model at all now');
  assert.equal(m('high', 'captions'), config.models.captions);
  assert.ok(m('high', 'verify').includes(config.models.reviewer), 'full QA: a model watches the export');
  assert.equal(m('fast', 'verify'), 'local (ffmpeg)');
});

test('no step generates code with an LLM any more (the reel is rendered from data)', () => {
  assert.ok(!STEP_DEFS('high').some((s) => s.key === 'codegen'));
  assert.ok(!fs.existsSync('remotion/src/Scenes.default.tsx'));
});

test('createJob validates input before touching disk', () => {
  assert.throws(() => createJob({ script: 'hi', video: '/definitely/not/here.mp4' }), /video not found/);
});

test('createJob sets budgets by quality and creates the job dir', () => {
  const tmp = fs.mkdtempSync('/tmp/ie-'); const v = path.join(tmp, 'v.mp4'); fs.writeFileSync(v, 'x');
  const id = `test-${Date.now()}`;
  const j = createJob({ script: 'hello', video: v, quality: 'fast', jobId: id });
  try {
    assert.equal(j.state.budgets.captions, config.budgets.captions);
    assert.ok(fs.existsSync(path.join(j.dir, 'state.json')));
    assert.equal(j.state.steps.length, 12);
    assert.deepEqual(j.state.terms, config.defaultTerms, 'no Terms → the default glossary');
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

test('every card kind the director may pick is rendered by Reel.tsx and has required-prop rules', async () => {
  const reel = fs.readFileSync('remotion/src/Reel.tsx', 'utf8');
  const kinds = reel.match(/const KINDS[^=]*= \{([^}]*)\}/)[1].split(',').map((x) => x.trim()).filter(Boolean);
  const g = fs.readFileSync('server/guardrails.mjs', 'utf8');
  for (const k of SCENE_KINDS) {
    assert.ok(kinds.includes(k), `${k} missing from Reel.tsx KINDS (it would silently render nothing)`);
    assert.match(g, new RegExp(`\\b${k}: \\[`), `${k} missing from REQUIRED in guardrails`);
  }
});

test('Remotion library typechecks (catches prop-type drift before a render does)', { timeout: 120000 }, () => {
  execFileSync('npx', ['tsc', '--noEmit'], { cwd: 'remotion', stdio: 'pipe' });
});

// ───────── validation, queueing and resume ─────────
import { runJob, startJob, resumeJob, getJob, STEPS_FOR_TEST, migrateSteps } from '../server/pipeline.mjs';
import { config } from '../server/config.mjs';

const tmpVideo = () => { const d = fs.mkdtempSync('/tmp/ie-'); const v = path.join(d, 'v.mp4'); fs.writeFileSync(v, 'x'); return { d, v }; };

test('createJob rejects traversal ids, bad quality, unknown or oversized budgets, bad video types', () => {
  const { d, v } = tmpVideo();
  try {
    assert.throws(() => createJob({ script: 's', video: v, jobId: '../../evil' }), /invalid job id/);
    assert.throws(() => createJob({ script: 's', video: v, quality: 'ultra' }), /quality/);
    assert.throws(() => createJob({ script: 's', video: v, budgets: { review: 999 } }), /between 0 and/);
    assert.throws(() => createJob({ script: 's', video: v, budgets: { captions: -1 } }), /between 0 and/);
    assert.throws(() => createJob({ script: 's', video: v, budgets: { evil: 1 } }), /unknown budget/);
    assert.throws(() => createJob({ script: 5, video: v }), /script must be text/);
    assert.throws(() => createJob({ script: 's', video: v, language: 'Hindi' }), /language must be/);
    assert.throws(() => createJob({ script: 's', video: v, language: 'AUTO' }), /language must be/);
    assert.throws(() => createJob({ script: 's', video: v, language: 'e' }), /language must be/);
    assert.throws(() => createJob({ script: 's', video: v, budgets: { translate: 50 } }), /between 0 and/);
    assert.throws(() => createJob({ script: 's', video: '/etc/hosts' }), /must be one of/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('createJob honours valid budget overrides but keeps other defaults', () => {
  const { d, v } = tmpVideo(); const id = `t-${Date.now()}`;
  const j = createJob({ script: 's', video: v, jobId: id, budgets: { review: 0.25 } });
  try {
    assert.equal(j.state.budgets.review, 0.25);
    assert.equal(j.state.budgets.direction, config.budgets.direction);
    assert.equal(j.state.status, 'queued');
  } finally { fs.rmSync(j.dir, { recursive: true, force: true }); fs.rmSync(d, { recursive: true, force: true }); }
});

test('budgets come from config; links and terms are validated and normalised', () => {
  const { d, v } = tmpVideo();
  const a = createJob({ script: 's', video: v, jobId: `th-${Date.now()}`, links: 'yashm1/instaedits, https://remotion.dev', terms: 'Kafka,  Redis' });
  try {
    assert.deepEqual(a.state.budgets, config.budgets);
    assert.deepEqual(a.state.links, ['https://github.com/yashm1/instaedits', 'https://remotion.dev']);
    assert.deepEqual(a.state.terms, ['Kafka', 'Redis']);
    assert.throws(() => createJob({ script: 's', video: v, links: ['http://insecure.example'] }), /https URL/);
    assert.throws(() => createJob({ script: 's', video: v, links: ['javascript:alert(1)'] }), /https URL/);
    assert.throws(() => createJob({ script: 's', video: v, links: Array(6).fill('https://a.dev') }), /at most 5/);
    assert.throws(() => createJob({ script: 's', video: v, terms: ['x'.repeat(41)] }), /at most 30 terms/);
  } finally { fs.rmSync(a.dir, { recursive: true, force: true }); fs.rmSync(d, { recursive: true, force: true }); }
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

test('the script is OPTIONAL: no script is fine, language defaults to auto-detect, provided flag is recorded', () => {
  const { d, v } = tmpVideo();
  const a = createJob({ video: v, jobId: `tn-a-${Date.now()}` });
  const b = createJob({ script: '  ', video: v, language: 'hi', jobId: `tn-b-${Date.now()}` });
  const c = createJob({ script: 'hello', video: v, jobId: `tn-c-${Date.now()}` });
  try {
    assert.equal(a.state.language, 'auto'); assert.equal(a.state.scriptProvided, false);
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

// ───────── real tool / repo visuals: the assets step and the resolver ─────────
const mkJobDir = (direction, extra = {}) => {
  const dir = fs.mkdtempSync('/tmp/ie-a-');
  fs.mkdirSync(path.join(dir, 'clips'));
  fs.writeFileSync(path.join(dir, 'direction.json'), JSON.stringify(direction));
  for (const [k, v] of Object.entries(extra)) fs.writeFileSync(path.join(dir, k), JSON.stringify(v));
  return { id: 'ja', dir, abort: new AbortController(), state: { language: 'en', duration: 20 } };
};
const sc = (id, kind, props) => ({ id, anchor: 'x', dur: 2, kind, props, transition_in: 'transition_blur', transition_out: 'transition_blur' });

test('assets step: skipped (and stale files removed) when nothing is referenced', async () => {
  const job = mkJobDir({ scenes: [sc('a1', 'Hook', {})] }, { 'assets.json': { repos: {} }, 'references.json': {} });
  try {
    const r = await STEPS_FOR_TEST().assets(job, { log: [] }, () => {});
    assert.match(r.skipped, /no tool, repo or screenshot/);
    assert.ok(!fs.existsSync(path.join(job.dir, 'assets.json')) && !fs.existsSync(path.join(job.dir, 'references.json')));
    assert.deepEqual(job.state.references, []);
  } finally { fs.rmSync(job.dir, { recursive: true, force: true }); }
});

test('assets step: invalid references are recorded as failed with a reason and never fetched', async () => {
  const job = mkJobDir({ scenes: [sc('a1', 'Repo', { repo: '../../etc/passwd' }), sc('a2', 'Site', { url: 'https://127.0.0.1:19501/mcp' })] });
  try {
    await STEPS_FOR_TEST().assets(job, { log: [] }, () => {});
    const st = JSON.parse(fs.readFileSync(path.join(job.dir, 'references.json'), 'utf8'));
    assert.equal(st.a1.ok, false); assert.match(st.a1.reason, /valid owner\/name/);
    assert.equal(st.a2.ok, false); assert.match(st.a2.reason, /private|ports/, 'the Edits MCP address must be refused');
    assert.equal(job.state.references.filter((r) => r.ok).length, 0);
  } finally { fs.rmSync(job.dir, { recursive: true, force: true }); }
});

const W2 = (w, start, end) => ({ w, start, end });
// continuous speech (no pauses to cut): "Hello friends." … "Kafka is fast." … "Redis too." … "Done now."
const talk = (() => {
  let t = 0.3; const out = []; const say = (txt) => txt.split(' ').forEach((w) => { out.push(W2(w, t, t + 0.4)); t += 0.4; });
  say('Hello friends.'); say('one two three four five six seven eight'); say('Kafka is fast.'); say('one two three four five six seven eight nine ten'); say('Redis too.'); say('one two three four five six'); say('Done now.');
  return out;
})();

test('resolve: a reference card is kept only when its visuals were verified; others are dropped with a logged reason', async () => {
  const dir = { scenes: [sc('a1', 'Hook', { text: 'Hi' }), sc('a2', 'Repo', { repo: 'apache/kafka' }), sc('a3', 'Site', { url: 'https://redis.io' })], zooms: [], sfx: [{ name: 'Whoosh (sharp)', volume: 0.3, on_scene: 'a3', edge: 'in' }], captions: { style: 'Short Pop', highlightColor: '#FFD84D', keywords: [] }, music: {}, grade: {}, remotion_brief: '' };
  dir.scenes[0].anchor = 'Hello friends'; dir.scenes[1].anchor = 'Kafka is fast'; dir.scenes[2].anchor = 'Redis too';
  const job = mkJobDir(dir, { 'transcript.json': { words: talk }, 'references.json': { a2: { ok: true, kind: 'Repo', ref: 'apache/kafka' }, a3: { ok: false, kind: 'Site', ref: 'https://redis.io', reason: 'navigation timed out' } } });
  const logs = [];
  try {
    await STEPS_FOR_TEST().resolve(job, { log: [] }, (m) => logs.push(m));
    const edl = JSON.parse(fs.readFileSync(path.join(job.dir, 'edl.json'), 'utf8'));
    assert.deepEqual(edl.scenes.map((s) => s.kind), ['Hook', 'Repo']);
    assert.ok(logs.some((l) => /dropped Site card a3: navigation timed out/.test(l)));
    assert.equal(edl.sfx.length, 0, 'sfx attached to a dropped card disappears with it');
    const reel = JSON.parse(fs.readFileSync(path.join(job.dir, 'reel.json'), 'utf8'));
    assert.deepEqual(reel.scenes.map((s) => s.kind), ['Hook', 'Repo'], 'Remotion renders exactly the EDL');
    assert.deepEqual(reel.scenes.map((s) => s.start), edl.scenes.map((s) => s.start), 'same seconds as the EDL — nothing re-times them');
    assert.equal(reel.video, 'tight.mp4');
  } finally { fs.rmSync(job.dir, { recursive: true, force: true }); }
});

test('resolve: with no references.json every reference card is dropped (never rendered without real data)', async () => {
  const dir = { scenes: [sc('a1', 'Repo', { repo: 'apache/kafka' })], zooms: [], sfx: [], captions: { style: 'Short Pop', highlightColor: '#FFD84D', keywords: [] }, music: {}, grade: {} };
  dir.scenes[0].anchor = 'Kafka is fast';
  const job = mkJobDir(dir, { 'transcript.json': { words: talk } }); const logs = [];
  try {
    await STEPS_FOR_TEST().resolve(job, { log: [] }, (m) => logs.push(m));
    assert.equal(JSON.parse(fs.readFileSync(path.join(job.dir, 'edl.json'), 'utf8')).scenes.length, 0);
    assert.ok(logs.some((l) => /visuals were not fetched/.test(l)));
  } finally { fs.rmSync(job.dir, { recursive: true, force: true }); }
});

// ───────── resuming jobs that predate a step ─────────
test('migrateSteps inserts steps added after the job was created, in canonical order, keeping existing results', () => {
  const full = STEP_DEFS('high').map((d) => ({ ...d, status: 'done', log: ['x'], cost: 0.5, tokens: { in: 1, out: 2 } }));
  const legacy = { quality: 'high', steps: full.filter((x) => x.key !== 'assets' && x.key !== 'translate') };
  assert.equal(migrateSteps(legacy), true);
  assert.deepEqual(legacy.steps.map((x) => x.key), STEP_DEFS('high').map((x) => x.key));
  const added = legacy.steps.filter((x) => ['assets', 'translate'].includes(x.key));
  assert.ok(added.every((x) => x.status === 'pending' && x.log.length === 0 && x.cost === 0));
  assert.ok(legacy.steps.filter((x) => !['assets', 'translate'].includes(x.key)).every((x) => x.status === 'done' && x.cost === 0.5), 'existing results untouched');
});

test('migrateSteps is a no-op for an up-to-date job and DROPS steps that no longer exist (e.g. codegen)', () => {
  const state = { quality: 'fast', steps: STEP_DEFS('fast').map((d) => ({ ...d, status: 'done', log: [], cost: 0, tokens: { in: 0, out: 0 } })) };
  assert.equal(migrateSteps(state), false);
  state.steps.splice(7, 0, { key: 'codegen', title: 'gone', status: 'done', log: [], cost: 0, tokens: { in: 0, out: 0 } });
  assert.equal(migrateSteps(state), true);
  assert.deepEqual(state.steps.map((x) => x.key), STEP_DEFS('fast').map((x) => x.key), 'resuming must never hit a step with no implementation');
});

test('resumeJob migrates a legacy job so the new step actually runs', () => {
  const { d, v } = tmpVideo(); const j = createJob({ script: 's', video: v, jobId: `tm-${Date.now()}` });
  try {
    j.state.status = 'error'; j.state.steps = j.state.steps.filter((x) => x.key !== 'assets'); // what getJob returns for a legacy job
    const resumed = resumeJob(j.id, 'probe'); resumed.abort.abort();
    assert.ok(resumed.state.steps.some((x) => x.key === 'assets'));
    assert.deepEqual(resumed.state.steps.map((x) => x.key), STEP_DEFS('high').map((x) => x.key));
  } finally { fs.rmSync(j.dir, { recursive: true, force: true }); fs.rmSync(d, { recursive: true, force: true }); }
});

test('audio (Edits) and graphics (Remotion) are one parallel group — and nothing else is', () => {
  const g = STEP_DEFS('high').filter((d) => d.group).map((d) => [d.key, d.group]);
  assert.deepEqual(g, [['audio', 'produce'], ['graphics', 'produce']]);
  const keys = STEP_DEFS('high').map((d) => d.key);
  assert.ok(keys.indexOf('captions') < keys.indexOf('graphics'), 'graphics need the caption lines');
  assert.ok(keys.indexOf('composite') > keys.indexOf('graphics') && keys.indexOf('composite') > keys.indexOf('audio'));
});

test('mode: "reuse" by default, "fresh" accepted, anything else refused', () => {
  const { d, v } = tmpVideo();
  const a = createJob({ script: 's', video: v, jobId: `tmo-a-${Date.now()}` });
  const b = createJob({ script: 's', video: v, jobId: `tmo-b-${Date.now()}`, mode: 'fresh' });
  try {
    assert.equal(a.state.mode, 'reuse'); assert.equal(b.state.mode, 'fresh');
    assert.throws(() => createJob({ script: 's', video: v, mode: 'yolo' }), /mode must be/);
  } finally { for (const j of [a, b]) fs.rmSync(j.dir, { recursive: true, force: true }); fs.rmSync(d, { recursive: true, force: true }); }
});
