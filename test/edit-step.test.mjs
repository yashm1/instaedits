import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Runs the REAL edit step against a fake `claude` and a temp staging dir (never touches ~/Movies).
let tmp, stage, rec, pipe, cfg;
before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-edit-'));
  stage = path.join(tmp, 'stage'); rec = path.join(tmp, 'rec.json');
  const fake = path.join(tmp, 'claude');
  fs.writeFileSync(fake, `#!/usr/bin/env node
let prompt = ''; process.stdin.on('data', (d) => (prompt += d)); process.stdin.on('end', () => {
  require('fs').writeFileSync('${rec}', JSON.stringify({ argv: process.argv.slice(2), prompt }));
  console.log(JSON.stringify({ type: 'result', result: 'Exported to /x/final.mp4\\n\\nDeviations:\\n- Codec: HEVC only', total_cost_usd: 0.19, usage: { input_tokens: 10, output_tokens: 5 } }));
});`, { mode: 0o755 });
  process.env.CLAUDE_BIN = fake; process.env.INSTAEDITS_STAGING_DIR = stage;
  pipe = await import('../server/pipeline.mjs'); cfg = (await import('../server/config.mjs')).config;
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const job = () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'job-')); const id = 'je-' + path.basename(dir).slice(-6).replace(/[^A-Za-z0-9]/g, 'x');
  fs.mkdirSync(path.join(dir, 'clips')); fs.writeFileSync(path.join(dir, 'tight.mp4'), 'T'); fs.writeFileSync(path.join(dir, 'clips', 's1.mp4'), 'C1'); fs.writeFileSync(path.join(dir, 'clips', 's2.mp4'), 'C2');
  fs.writeFileSync(path.join(dir, 'edl.json'), JSON.stringify({ duration: 20, language: 'en', scenes: [{ id: 's1', start: 0.1, dur: 2, kind: 'Hook', tin: 'transition_blur', tout: 'transition_blur' }, { id: 's2', start: 5, dur: 3, kind: 'Flow' }], zooms: [], sfx: [{ at: 0.05, name: 'Whoosh (sharp)', volume: 0.3 }], captions: { style: 'Short Pop', highlightColor: '#FFD84D', keywords: ['Kafka'] }, music: { query: 'minimal tech', fallbacks: [], volume: 0.12, duckedVolume: 0.07, fadeIn: 0.6, fadeOut: 1.2 }, grade: { note: 'x' } }));
  return { id, dir, abort: new AbortController(), state: { quality: 'fast', budgets: { edit: 0.5 } } };
};

test('edit step stages tight.mp4 and the cards into the sandbox-friendly folder and tells the editor to use THOSE paths', async () => {
  const j = job();
  await pipe.STEPS_FOR_TEST().edit(j, { model: 'haiku-x' }, () => {});
  const staged = path.join(stage, j.id);
  assert.ok(fs.existsSync(path.join(staged, 'tight.mp4'))); assert.ok(fs.existsSync(path.join(staged, 'clips', 's1.mp4'))); assert.ok(fs.existsSync(path.join(staged, 'clips', 's2.mp4')));
  const { prompt, argv } = JSON.parse(fs.readFileSync(rec, 'utf8'));
  assert.ok(prompt.includes(path.join(staged, 'tight.mp4'))); assert.ok(prompt.includes(path.join(staged, 'clips', 's1.mp4')));
  assert.ok(prompt.includes(path.join(staged, 'final.mp4')), 'export target is inside the staging folder');
  assert.ok(!prompt.includes(j.dir), 'the jobs/ folder (not readable by the sandboxed app) must never be handed to the editor');
  assert.equal(argv[argv.indexOf('--max-budget-usd') + 1], '0.5'); assert.equal(argv[argv.indexOf('--model') + 1], 'haiku-x');
});

test('edit step keeps the editor\'s full report (deviations!) on the job state, and logs it beyond 300 chars', async () => {
  const j = job(); const logs = [];
  const r = await pipe.STEPS_FOR_TEST().edit(j, { model: 'm' }, (m) => logs.push(m));
  assert.match(j.state.editorReport, /Deviations:\n- Codec: HEVC only/);
  assert.ok(logs.some((l) => l.startsWith('↩') && /HEVC only/.test(l)));
  assert.equal(r.cost, 0.19);
});

test('edit step removes a stale export from a previous attempt before asking the editor to export', async () => {
  const j = job(); const staged = path.join(stage, j.id); fs.mkdirSync(staged, { recursive: true }); fs.writeFileSync(path.join(staged, 'final.mp4'), 'OLD');
  await pipe.STEPS_FOR_TEST().edit(j, { model: 'm' }, () => {});
  assert.ok(!fs.existsSync(path.join(staged, 'final.mp4')), 'a stale final.mp4 would make verify pass without a real export');
});

test('verify looks for the export in the staging folder, and fails loudly when it is missing', async () => {
  const j = job();
  await assert.rejects(() => pipe.STEPS_FOR_TEST().verify(j, {}, () => {}), (e) => e.message.includes(path.join(stage, j.id, 'final.mp4')) && /did not land/.test(e.message));
});
