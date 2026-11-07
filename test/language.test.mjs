import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The transcribe STEP with a pre-seeded transcript (so no Edits calls) and a temp staging dir.
let tmp, pipe;
before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-lang-'));
  process.env.INSTAEDITS_STAGING_DIR = path.join(tmp, 'stage');
  pipe = await import('../server/pipeline.mjs');
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const W = (w, i) => ({ w, start: i * 0.4, end: i * 0.4 + 0.35 });
const HI = 'नमस्ते दोस्तों आज हम Kafka समझेंगे'.split(' ').map(W);
const EN = 'hello friends today we learn Kafka'.split(' ').map(W);
const run = async (language, words) => {
  const dir = fs.mkdtempSync(path.join(tmp, 'job-')); const video = path.join(tmp, 'v.mp4'); fs.writeFileSync(video, 'x');
  fs.writeFileSync(path.join(dir, 'transcript.json'), JSON.stringify({ words }));
  const job = { id: 'jl-' + path.basename(dir).slice(-6).replace(/[^A-Za-z0-9]/g, 'x'), dir, abort: new AbortController(), state: { language, video } }; const logs = [];
  await pipe.STEPS_FOR_TEST().transcribe(job, { log: [] }, (m) => logs.push(m));
  return { st: job.state, logs };
};

test('auto + Hindi speech → switches to hi, flags it, and says so in the log', async () => {
  const { st, logs } = await run('auto', HI);
  assert.equal(st.language, 'hi'); assert.equal(st.languageDetected, true);
  assert.ok(logs.some((l) => /speech is hi, not English — switching to translate-to-English mode/.test(l)));
});

test('auto + English speech → en (no switch flag)', async () => {
  const { st } = await run('auto', EN);
  assert.equal(st.language, 'en'); assert.ok(!st.languageDetected);
});

test('the reported case: the dashboard said English but the speech is Hindi → corrected to hi', async () => {
  const { st } = await run('en', HI);
  assert.equal(st.language, 'hi'); assert.equal(st.languageDetected, true);
});

test('an explicit hi is never downgraded, even if the transcript looks Latin (romanised Hinglish)', async () => {
  const { st } = await run('hi', EN);
  assert.equal(st.language, 'hi'); assert.ok(!st.languageDetected);
});

test('explicit en with English speech stays en', async () => {
  const { st } = await run('en', EN);
  assert.equal(st.language, 'en');
});
