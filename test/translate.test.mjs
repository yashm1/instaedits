import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Fake `claude`: records args + prompt, returns a structured translation ("EN <n>") for every "#n:" line it was sent.
let tmp, fake, rec, mode, mod, pipe, cfg;
before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-tr-'));
  fake = path.join(tmp, 'claude'); rec = path.join(tmp, 'rec.json'); mode = path.join(tmp, 'mode');
  fs.writeFileSync(mode, 'ok');
  fs.writeFileSync(fake, `#!/usr/bin/env node
const fs = require('fs');
let prompt = ''; process.stdin.on('data', (d) => (prompt += d)); process.stdin.on('end', () => {
  const calls = fs.existsSync('${rec}') ? JSON.parse(fs.readFileSync('${rec}', 'utf8')) : [];
  calls.push({ argv: process.argv.slice(2), prompt }); fs.writeFileSync('${rec}', JSON.stringify(calls));
  const m = fs.readFileSync('${mode}', 'utf8');
  let ns = [...prompt.matchAll(/^#(\\d+):/gm)].map((x) => +x[1]);
  if (m === 'missing') ns = ns.slice(0, -1);
  console.log(JSON.stringify({ type: 'result', result: '', structured_output: { sentences: ns.map((n) => ({ n, en: 'EN ' + n + ' kafka is fast' })) }, total_cost_usd: 0.02, usage: { input_tokens: 100, output_tokens: 40 } }));
});`, { mode: 0o755 });
  process.env.CLAUDE_BIN = fake;
  pipe = await import('../server/pipeline.mjs'); cfg = (await import('../server/config.mjs')).config;
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const W = (w, start, end) => ({ w, start, end });
const HI = [W('नमस्ते', 0.4, 0.8), W('दोस्तों।', 0.8, 1.3), W('Kafka', 1.5, 1.9), W('तेज़', 1.9, 2.3), W('है।', 2.3, 2.7), W('चलिए', 4.5, 5.0), W('शुरू', 5.0, 5.4), W('करते', 5.4, 5.8), W('हैं।', 5.8, 6.2)];
const mkJob = (language, script = '') => {
  const dir = fs.mkdtempSync(path.join(tmp, 'job-'));
  fs.writeFileSync(path.join(dir, 'transcript.json'), JSON.stringify({ words: HI }));
  return { id: 'j', dir, abort: new AbortController(), state: { language, script, duration: 7, budgets: { translate: 0.25 } } };
};
const step = () => ({ log: [] });
const calls = () => (fs.existsSync(rec) ? JSON.parse(fs.readFileSync(rec, 'utf8')) : []);

test('English speech: translation is skipped (no LLM call)', async () => {
  fs.rmSync(rec, { force: true });
  const r = await pipe.STEPS_FOR_TEST().translate(mkJob('en'), step(), () => {});
  assert.match(r.skipped, /English/);
  assert.equal(calls().length, 0);
});

test('Hindi: translates every numbered sentence, writes sentences.json + script.en.txt, records cost', async () => {
  fs.rmSync(rec, { force: true });
  const job = mkJob('hi', 'rough english draft about kafka'); const logs = [];
  const r = await pipe.STEPS_FOR_TEST().translate(job, step(), (m) => logs.push(m));
  const merged = JSON.parse(fs.readFileSync(path.join(job.dir, 'sentences.json'), 'utf8'));
  assert.equal(merged.length, 3);
  assert.deepEqual(merged.map((x) => x.n), [1, 2, 3]);
  assert.equal(merged[0].text, 'नमस्ते दोस्तों।'); assert.match(merged[1].en, /^EN 2/);
  assert.ok(merged.every((x) => typeof x.t === 'number' && x.t >= 0));
  assert.equal(fs.readFileSync(path.join(job.dir, 'script.en.txt'), 'utf8').split('\n').length, 3);
  assert.match(job.state.scriptEn, /EN 1.*EN 2.*EN 3/);
  assert.equal(r.cost, 0.02); assert.deepEqual(r.tokens, { in: 100, out: 40 });
  assert.ok(logs.some((l) => /3 sentences → English/.test(l)));
  const [c] = calls();
  assert.ok(c.argv.includes(cfg.models.translator)); assert.ok(c.argv.includes('--json-schema'));
  assert.equal(c.argv[c.argv.indexOf('--max-budget-usd') + 1], '0.25', 'uses the job translate budget');
  assert.match(c.prompt, /#1: नमस्ते दोस्तों।/); assert.match(c.prompt, /rough english draft/);
});

test('the alt transcript is sent to the translator as ALT lines, and is not persisted in sentences.json', async () => {
  fs.rmSync(rec, { force: true });
  const job = mkJob('hi');
  fs.writeFileSync(path.join(job.dir, 'transcript.alt.json'), JSON.stringify({ words: [W('99.99%', 1.55, 1.9), W('Kafka', 4.6, 5.0)] }));
  await pipe.STEPS_FOR_TEST().translate(job, step(), () => {});
  const [c] = calls();
  assert.match(c.prompt, /ALT: 99\.99%/); assert.match(c.prompt, /ALT: Kafka/);
  const merged = JSON.parse(fs.readFileSync(path.join(job.dir, 'sentences.json'), 'utf8'));
  assert.ok(merged.every((x) => !('alt' in x)));
});

test('translation is cached across runs: the same speech again makes no LLM call (0 tokens) and restores scriptEn', async () => {
  process.env.INSTAEDITS_CACHE = 'on'; process.env.INSTAEDITS_CACHE_DIR_UNUSED = '';
  const { config: c } = await import('../server/config.mjs'); const saved = c.cacheDir; c.cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-cache-'));
  try {
    const s = pipe.STEPS_FOR_TEST();
    await s.translate(mkJob('hi'), step(), () => {});
    const n = calls().length;
    const job2 = mkJob('hi'); // a NEW job, same speech
    const r = await s.translate(job2, step(), () => {});
    assert.equal(calls().length, n, 'no second LLM call');
    assert.equal(r.cost, 0); assert.equal(r.cached, true);
    assert.match(job2.state.scriptEn, /EN 1/);
  } finally { fs.rmSync(c.cacheDir, { recursive: true, force: true }); c.cacheDir = saved; process.env.INSTAEDITS_CACHE = 'off'; }
});

test('a translation that drops a sentence fails loudly and writes nothing', async () => {
  fs.writeFileSync(mode, 'missing');
  const job = mkJob('hi');
  await assert.rejects(() => pipe.STEPS_FOR_TEST().translate(job, step(), () => {}), /missing sentence\(s\) 3/);
  assert.ok(!fs.existsSync(path.join(job.dir, 'sentences.json')));
  fs.writeFileSync(mode, 'ok');
});
