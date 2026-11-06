import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../server/prompts.mjs';
import * as C from '../server/catalog.mjs';
import { LIMITS } from '../server/guardrails.mjs';

const props = P.DIRECTOR_SCHEMA.properties;

test('director schema enums are exactly the verified catalog', () => {
  assert.deepEqual(props.scenes.items.properties.kind.enum, C.SCENE_KINDS);
  assert.deepEqual(props.scenes.items.properties.transition_in.enum, C.TRANSITIONS);
  assert.deepEqual(props.sfx.items.properties.name.enum, C.SFX);
  assert.deepEqual(props.captions.properties.style.enum, C.CAPTION_STYLES);
  assert.deepEqual(props.music.properties.query.enum, C.MUSIC_QUERIES);
});

test('schema requires every section the resolver reads', () => {
  for (const k of ['scenes', 'zooms', 'sfx', 'captions', 'music', 'grade', 'remotion_brief']) assert.ok(P.DIRECTOR_SCHEMA.required.includes(k), k);
});

test('doctrine text agrees with the enforced guardrail numbers', () => {
  const t = P.DIRECTOR_SYSTEM;
  assert.match(t, /≤4 words/);
  assert.match(t, /never >0\.16/);
  assert.equal(LIMITS.musicMax, 0.16);
  assert.match(t, /108-114%/);
  assert.ok(LIMITS.zoomMin >= 1.06 && LIMITS.zoomMax <= 1.14);
  assert.match(t, /at most 10% of the words/);
  assert.match(t, /NOVELTY/);
  assert.match(t, /sound OFF/);
});

test('director prompt carries sentences with timestamps and the library', () => {
  const p = P.directorPrompt({ script: 'x', sentences: [{ t: 1.234, text: 'Hello world.' }], duration: 20, library: '- `Hook`' });
  assert.match(p, /\[1\.2\] Hello world\./);
  assert.match(p, /20\.0s/);
  assert.match(p, /- `Hook`/);
});

const edl = {
  duration: 20.5,
  scenes: [{ id: 's1', start: 0.1, dur: 2, kind: 'Hook', tin: 'transition_blur', tout: 'transition_blur' }, { id: 's2', start: 5, dur: 3, kind: 'Flow', tin: 'transition_blur', tout: 'transition_blur' }],
  zooms: [{ start: 9, dur: 1, scale: 1.1 }],
  sfx: [{ at: 0.05, name: 'Whoosh (sharp)', volume: 0.3 }],
  captions: { style: 'Short Pop', highlightColor: '#FFD84D', keywords: ['Kafka', 'uptime'] },
  music: { query: 'minimal tech', fallbacks: ['lofi focus'], volume: 0.12, duckedVolume: 0.07, fadeIn: 0.6, fadeOut: 1.2 },
  grade: { note: 'subtle lift' },
};
const ep = (q = 'high') => P.editPrompt({ tight: '/j/tight.mp4', clipsDir: '/j/clips', edl, out: '/j/final.mp4', quality: q });

test('edit prompt contains every EDL decision verbatim', () => {
  const t = ep();
  for (const s of ['/j/tight.mp4', '/j/clips/s1.mp4', '/j/clips/s2.mp4', '0.1s +2s', 'Whoosh (sharp)', 'vol 0.3', 'Short Pop', '#FFD84D', 'Kafka, uptime', 'minimal tech', 'volume 0.12', '0.07', '110%', '-14 LUFS', '/j/final.mp4', '20.5s'])
    assert.ok(t.includes(s), `missing ${s}`);
});

test('edit prompt places captions at ~68% height inside safe zones, 2-3 words per line', () => {
  const t = ep();
  assert.match(t, /68%/); assert.match(t, /2-3 words/); assert.match(t, /top 14% and bottom 20%/);
});

test('high quality adds the QA pass; fast does not', () => {
  assert.match(ep('high'), /QA: previewVideoFrames/);
  assert.match(ep('fast'), /No QA pass/);
});

test('edit prompt forbids cutting the pre-tightened clip and mutes card audio', () => {
  assert.match(ep(), /do NOT cut or trim/); assert.match(ep(), /MUTE card audio/);
});

test('codegen prompt points at scenes.json for the right job and forbids restyling', () => {
  const t = P.codegenPrompt({ jobId: 'job-1' });
  assert.match(t, /jobs\/job-1\/scenes\.json/); assert.match(t, /do not restyle/);
});
