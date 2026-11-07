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
const opts = (fake, extra = {}) => ({ video: '/stage/reel.mp4', edl: EDL, out: '/stage/final.mp4', words: WORDS, tool: fake.tool, sleep: async () => {}, ...extra });
const names = (calls) => calls.map((c) => c.name);

test('the edit is plain tool calls: no colour grade is EVER applied (the black-and-white bug)', async () => {
  const fake = fakeEdits();
  await runEdit(opts(fake, { transliterate: async (l) => l.map((x) => x.map(() => 'w')) }));
  for (const banned of ['setColorGrade', 'applyAdjust', 'applyFilter', 'applyLUT', 'setHSL', 'setCurve', 'setColorWheel', 'addTransition'])
    assert.ok(!names(fake.calls).includes(banned), `${banned} must never be called`);
  assert.ok(names(fake.calls).includes('getAdjustState'), 'it verifies the clip has no adjustments');
});

test('imports the finished reel, never re-times it, and exports to the staged path at 1080x1920 / 20 Mbit/s', async () => {
  const fake = fakeEdits();
  const { report } = await runEdit(opts(fake));
  const n = names(fake.calls);
  assert.deepEqual(n.slice(0, 3), ['newProject', 'setAspectRatio', 'importMedia']);
  assert.equal(fake.calls[2].args.path, '/stage/reel.mp4');
  for (const banned of ['trim', 'trimClip', 'split', 'splitClip', 'move', 'setSpeed', 'delete']) assert.ok(!n.includes(banned), banned);
  const es = fake.calls.find((c) => c.name === 'setExportSettings').args;
  assert.equal(es.resolution, '1080x1920'); assert.equal(es.bitrate, 20_000_000); assert.equal(es.frameRate, 30);
  assert.equal(fake.calls.find((c) => c.name === 'export').args.path, '/stage/final.mp4');
  assert.ok(n.indexOf('export') < n.lastIndexOf('exportStatus'), 'waits for the export to finish');
  assert.ok(report.some((r) => /exported/.test(r)));
});

test('captions: generated from the video in the spoken language, split into ≤3-word lines at real word gaps', async () => {
  const fake = fakeEdits();
  await runEdit(opts(fake));
  const g = fake.calls.find((c) => c.name === 'generateCaptions').args;
  assert.deepEqual(g, { source: 'video', language: 'hi', curseWords: false });
  const splits = fake.calls.filter((c) => c.name === 'splitCaption');
  assert.equal(splits.length, 1, 'the 5-word caption becomes 3+2; the 2-word one is left alone');
  assert.equal(splits[0].args.time, +((WORDS[2].end + WORDS[3].start) / 2).toFixed(3), 'split in the silence between words 3 and 4');
  assert.ok(fake.caps().every((c) => c.tokens.length <= 3));
});

test('captions become Latin-script Hinglish: LLM words when the count matches, rule-based fallback otherwise', async () => {
  const fake = fakeEdits(); let seen;
  const { report } = await runEdit(opts(fake, { transliterate: async (lines) => { seen = lines; return [['O', 'bhai,', 'ye'], ['pura'], ['Claude', 'ne']]; } }));
  assert.deepEqual(seen, [['ओ', 'भाई,', 'ये'], ['पूरा', 'वीडियो'], ['Claude', 'ने']], 'one line per caption, original tokens');
  const texts = fake.caps().map((c) => c.tokens.map((t) => t.text).join(' '));
  assert.deepEqual(texts, ['O bhai, ye', 'poora veediyo', 'Claude ne'], 'line 2 had the wrong word count → deterministic fallback');
  assert.ok(fake.caps().every((c) => c.tokens.every((t) => !/\p{Script=Devanagari}/u.test(t.text))), 'no Devanagari survives');
  assert.ok(report.some((r) => /Hinglish \(1 line\(s\) via the rule-based fallback\)/.test(r)));
});

test('captions still become Latin when the transliteration call fails outright', async () => {
  const fake = fakeEdits();
  const { report } = await runEdit(opts(fake, { transliterate: async () => { throw new Error('budget exceeded'); } }));
  assert.ok(fake.caps().every((c) => c.tokens.every((t) => !/\p{Script=Devanagari}/u.test(t.text))));
  assert.ok(report.some((r) => /Hinglish transliteration: budget exceeded/.test(r)));
});

test('English captions are left as spoken (no transliteration call)', async () => {
  const fake = fakeEdits({ captions: [{ id: 'c1', startTime: 0.1, endTime: 1, tokens: ['Hello', 'there'] }] }); let called = false;
  await runEdit(opts(fake, { edl: { ...EDL, language: 'en' }, transliterate: async () => { called = true; return []; } }));
  assert.equal(called, false);
  assert.ok(!names(fake.calls).includes('editCaption'));
});

test('captions sit on the seam while a card shows (face stays clear), lower-middle otherwise', async () => {
  const fake = fakeEdits();
  await runEdit(opts(fake));
  const pos = Object.fromEntries(fake.calls.filter((c) => c.name === 'setTextPosition').map((c) => [c.args.id, c.args.y]));
  const byStart = fake.caps().map((c) => [c.startTime, pos[c.id]]);
  assert.deepEqual(byStart.map(([, y]) => y), [0.5, 0.5, 0.72], 'first two lines overlap the 0.1-2.6s card; the last does not');
});

test('captions use a readable style: an unreadable/unknown style from an older plan becomes Highlighter', async () => {
  const fake = fakeEdits();
  await runEdit(opts(fake));
  assert.deepEqual(fake.calls.filter((c) => c.name === 'setCaptionStyle').map((c) => c.args.style), ['Highlighter']);
  assert.ok(!fake.calls.some((c) => c.name === 'setCaptionHighlightColor'), 'white text on yellow was unreadable — keep the app default');
  const f2 = fakeEdits();
  await runEdit(opts(f2, { edl: { ...EDL, captions: { style: 'Default' } } }));
  assert.equal(f2.calls.find((c) => c.name === 'setCaptionStyle').args.style, 'Default');
});

test('caption generation is retried on a transient (cloud) error', async () => {
  const fake = fakeEdits({ failOnce: { generateCaptions: 'uploadFailed: Network is unreachable' } });
  await runEdit(opts(fake));
  assert.equal(fake.calls.filter((c) => c.name === 'generateCaptions').length, 2);
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
