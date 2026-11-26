import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runEdit } from '../server/editor.mjs';

// A fake Edits app: records every call, keeps a tiny caption model so split/edit/position behave like the real app.
function fakeEdits({ captions, failOnce = {}, exportStates = ['running', 'completed'] } = {}) {
  const calls = [];
  let caps = (captions ?? [
    { id: 'c1', startTime: 0.1, endTime: 2.3, tokens: ['ओ', 'भाई,', 'ये', 'पूरा', 'वीडियो'] },
    { id: 'c2', startTime: 2.4, endTime: 3.4, tokens: ['Claude', 'ने'] },
  ]).map((c) => ({ ...c, tokens: c.tokens.map((t) => ({ text: t })) }));
  let n = 0; const states = [...exportStates];
  const tool = async (name, args = {}) => {
    calls.push({ name, args });
    if (failOnce[name]) { const e = failOnce[name]; delete failOnce[name]; throw new Error(e); }
    switch (name) {
      case 'importMedia': return { id: 'CLIP', ok: true };
      case 'getAdjustState': return { isDefault: true, saturation: 0 };
      case 'captions': return { captions: caps };
      case 'splitCaption': {
        const i = caps.findIndex((c) => c.id === args.id); const c = caps[i];
        const k = Math.max(1, Math.round(((args.time - c.startTime) / (c.endTime - c.startTime)) * c.tokens.length));
        caps.splice(i, 1, { id: `${c.id}a${++n}`, startTime: c.startTime, endTime: args.time, tokens: c.tokens.slice(0, k) }, { id: `${c.id}b${n}`, startTime: args.time, endTime: c.endTime, tokens: c.tokens.slice(k) });
        return { ok: true };
      }
      case 'editCaption': { const c = caps.find((x) => x.id === args.id); const w = args.text.split(' '); c.tokens = c.tokens.map((t, i) => ({ text: w[i] ?? t.text })); return { ok: true }; }
      case 'searchMusic': return { results: [{ title: 'Minimal Tech', relevant: true }] };
      case 'getMusicTrackDetails': return { audioAssetId: '639' };
      case 'addSongToComposition': return { id: 'SONG', ok: true };
      case 'addSoundEffect': return { id: `SFX${calls.length}`, added: true };
      case 'exportStatus': return { state: states.shift() ?? 'completed', progress: 1 };
      default: return { ok: true };
    }
  };
  return { tool, calls, caps: () => caps };
}

const EDL = {
  duration: 10, language: 'hi',
  scenes: [{ id: 's1', start: 0.1, dur: 2.5, kind: 'Hook' }],
  sfx: [{ at: 0.05, name: 'Whoosh (sharp)', volume: 0.38 }, { at: 5, name: 'Riser (short) 2', volume: 0.28 }],
  captions: { style: 'Word Highlight Box' }, // an old plan's condensed style → must be corrected to a readable one
  music: { query: 'minimal tech', fallbacks: ['lofi focus'], volume: 0.12, duckedVolume: 0.072, fadeIn: 0.6, fadeOut: 1.2 },
};
const WORDS = [[0.1, 0.4], [0.45, 0.8], [0.85, 1.2], [1.25, 1.7], [1.75, 2.3], [2.4, 2.9], [2.95, 3.4]].map(([start, end]) => ({ start, end }));
const opts = (fake, extra = {}) => ({ video: '/stage/reel.mp4', edl: EDL, out: '/stage/final.mp4', tool: fake.tool, sleep: async () => {}, ...extra });
const names = (calls) => calls.map((c) => c.name);

test('the edit is plain tool calls: no colour grade is EVER applied (the black-and-white bug)', async () => {
  const fake = fakeEdits();
  await runEdit(opts(fake));
  for (const banned of ['setColorGrade', 'applyAdjust', 'applyFilter', 'applyLUT', 'setHSL', 'setCurve', 'setColorWheel', 'addTransition'])
    assert.ok(!names(fake.calls).includes(banned), `${banned} must never be called`);
  assert.ok(names(fake.calls).includes('getAdjustState'), 'it verifies the clip has no adjustments');
});

test('imports the speaker clip, never re-times it, and exports (for its audio) to the staged path', async () => {
  const fake = fakeEdits();
  const { report } = await runEdit(opts(fake));
  const n = names(fake.calls);
  assert.deepEqual(n.slice(0, 4), ['newProject', 'setAspectRatio', 'setFrameRate', 'importMedia']);
  for (const banned of ['generateCaptions', 'captions', 'splitCaption', 'editCaption', 'setCaptionStyle', 'setTextPosition']) assert.ok(!n.includes(banned), `${banned}: captions come from the transcript now (no round trips)`);
  assert.equal(fake.calls[2].args.fps, 30, 'the camera\'s frame rate (the app defaulted to a 60 fps export)');
  assert.equal(fake.calls[3].args.path, '/stage/reel.mp4');
  for (const banned of ['trim', 'trimClip', 'split', 'splitClip', 'move', 'setSpeed', 'delete']) assert.ok(!n.includes(banned), banned);
  const es = fake.calls.find((c) => c.name === 'setExportSettings').args;
  assert.deepEqual(es, { quality: 'High', frameRate: 30, resolution: '720x1280', resolutionType: '720p', aspectRatio: 'nineBySixteen', dynamicRange: 'SDR', bitrate: 2_000_000 }, 'only the audio is used: a small, fast, COMPLETE preset');
  assert.equal(fake.calls.find((c) => c.name === 'export').args.path, '/stage/final.mp4');
  assert.ok(n.indexOf('export') < n.lastIndexOf('exportStatus'), 'waits for the export to finish');
  assert.ok(report.some((r) => /exported/.test(r)));
});

test('music: exact volume, fades and ducking; SFX: seek to the exact second, then set the exact volume', async () => {
  const fake = fakeEdits();
  await runEdit(opts(fake));
  const arg = (n) => fake.calls.filter((c) => c.name === n).map((c) => c.args);
  assert.deepEqual(arg('addSongToComposition')[0], { track: 'Minimal Tech', audioAssetId: '639' });
  assert.ok(arg('setVolume').some((a) => a.id === 'SONG' && a.volume === 0.12));
  assert.deepEqual(arg('setFade')[0], { id: 'SONG', fadeIn: 0.6, fadeOut: 1.2 });
  assert.deepEqual(arg('setDucking')[0], { id: 'SONG', behavior: 'video', level: 0.072 });
  const i = fake.calls.findIndex((c) => c.name === 'addSoundEffect' && c.args.effect === 'Riser (short) 2');
  assert.deepEqual(fake.calls[i - 1], { name: 'seek', args: { seconds: 5 } });
  assert.equal(fake.calls[i + 1].name, 'setVolume'); assert.equal(fake.calls[i + 1].args.volume, 0.28);
});

test('optional extras (voice enhance, a missing SFX) degrade to a note; a failed export is fatal', async () => {
  const fake = fakeEdits({ failOnce: { setVoiceEnhance: 'panel not presented', addSoundEffect: 'not found' } });
  const { report } = await runEdit(opts(fake));
  assert.ok(report.some((r) => /voice enhance: panel not presented/.test(r)));
  assert.ok(report.some((r) => /sfx Whoosh \(sharp\) @0\.05s: not found/.test(r)));
  await assert.rejects(() => runEdit(opts(fakeEdits({ exportStates: ['running', 'failed'] }))), /export failed/);
});

test('a clip that arrives with adjustments is reported (colour must stay the camera\'s)', async () => {
  const fake = fakeEdits(); const orig = fake.tool;
  const { report } = await runEdit(opts(fake, { tool: async (n, a) => (n === 'getAdjustState' ? { isDefault: false, saturation: -96 } : orig(n, a)) }));
  assert.ok(report.some((r) => /non-default adjustments \(saturation -96\)/.test(r)));
});

// ───────── verify step (pipeline) ─────────
test('verify looks for the export in the staging folder, and fails loudly when it is missing', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-v-'));
  process.env.INSTAEDITS_STAGING_DIR = path.join(tmp, 'stage');
  const pipe = await import('../server/pipeline.mjs');
  const stage = (await import('../server/config.mjs')).config.stagingDir;
  const j = { id: 'jv-1', dir: tmp, abort: new AbortController(), state: { quality: 'fast' } };
  try {
    await assert.rejects(() => pipe.STEPS_FOR_TEST().verify(j, {}, () => {}), (e) => e.message.includes(path.join(stage, j.id, 'final.mp4')) && /did not land/.test(e.message));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('a lagging playhead is retried before an SFX is given up', async () => {
  const fake = fakeEdits(); const orig = fake.tool; let n = 0;
  const { report } = await runEdit(opts(fake, { tool: async (name, a) => (name === 'seek' && a.seconds === 5 && n++ < 2 ? Promise.reject(new Error('seek: playhead did not reach 5s')) : orig(name, a)) }));
  assert.equal(fake.calls.filter((c) => c.name === 'addSoundEffect').length, 2, 'both SFX placed');
  assert.ok(!report.some((r) => /sfx/.test(r)));
});

test('voice enhance survives one dropped connection (it is idempotent)', async () => {
  const fake = fakeEdits({ failOnce: { selectById: 'fetch failed' } });
  const { report } = await runEdit(opts(fake));
  assert.equal(fake.calls.filter((c) => c.name === 'selectById').length, 2);
  assert.ok(fake.calls.some((c) => c.name === 'setVoiceEnhance'));
  assert.ok(!report.some((r) => /voice enhance/.test(r)));
});
