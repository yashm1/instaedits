import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyGuardrails, LIMITS } from '../server/guardrails.mjs';

const base = () => ({
  scenes: [
    { id: 'a1', anchor: 'x', dur: 2, kind: 'Hook', props: { text: 'Instagram handles millions of likes daily', hot: ['millions', 'daily'] } },
    { id: 'a2', anchor: 'y', dur: 9, kind: 'Flow', props: {} },
    { id: 'a3', anchor: 'z', dur: 0.4, kind: 'Flow', props: {} },
    { id: 'a4', anchor: 'w', dur: 2, kind: 'Flow', props: {} },
  ],
  zooms: [{ anchor: 'q', dur: 5, scale: 1.5 }, { anchor: 'r', dur: 0.1, scale: 1.0 }],
  sfx: Array.from({ length: 10 }, (_, i) => ({ name: i === 3 || i === 4 ? 'Riser (sharp)' : 'Whoosh (sharp)', volume: 0.9, on_scene: 'a1', edge: i % 2 ? 'out' : 'in' })),
  captions: { style: 'Short Pop', highlightColor: '#FFD84D', keywords: Array.from({ length: 20 }, (_, i) => `w${i}`) },
  music: { query: 'minimal tech', volume: 0.4, duckedVolume: 0.3, fadeIn: 0.6, fadeOut: 1.2 },
});
const run = (d = base(), o = {}) => applyGuardrails(d, { totalSeconds: 30, scriptWordCount: 80, ...o });

test('does not mutate its input', () => {
  const d = base(); const snap = JSON.stringify(d); run(d);
  assert.equal(JSON.stringify(d), snap);
});

test('card duration clamped to [1.5, 4.5]', () => {
  const { direction } = run();
  for (const s of direction.scenes) assert.ok(s.dur >= LIMITS.cardDurMin && s.dur <= LIMITS.cardDurMax);
});

test('opening hook trimmed to ≤4 words and hot words pruned', () => {
  const { direction, notes } = run();
  assert.equal(direction.scenes[0].props.text.split(' ').length, 4);
  assert.deepEqual(direction.scenes[0].props.hot, ['millions']); // 'daily' fell outside the first 4 words
  assert.ok(notes.some((n) => /hook trimmed/.test(n)));
});

test('warns when first card is not a Hook and when 3 same kinds repeat', () => {
  const d = base(); d.scenes[0].kind = 'Flow';
  const { notes } = run(d);
  assert.ok(notes.some((n) => /not a Hook/.test(n)));
  assert.ok(notes.some((n) => /in a row/.test(n)));
});

test('zoom scale and duration clamped', () => {
  const { direction } = run();
  for (const z of direction.zooms) {
    assert.ok(z.scale >= LIMITS.zoomMin && z.scale <= LIMITS.zoomMax);
    assert.ok(z.dur >= LIMITS.zoomDurMin && z.dur <= LIMITS.zoomDurMax);
  }
});

test('sfx: volumes clamped, ≤1 riser, count capped to ~1 per 6s, riser kept first', () => {
  const { direction } = run();
  assert.equal(direction.sfx.length, 5); // 30s / 6s
  assert.equal(direction.sfx.filter((x) => /^Riser/.test(x.name)).length, 1);
  for (const x of direction.sfx) assert.ok(x.volume <= LIMITS.sfxMax && x.volume >= LIMITS.sfxMin);
});

test('sfx cap has a floor for very short videos', () => {
  const { direction } = run(base(), { totalSeconds: 5 });
  assert.equal(direction.sfx.length, LIMITS.sfxFloor);
});

test('caption keywords capped at 10% of script words (min 3)', () => {
  assert.equal(run().direction.captions.keywords.length, 8);
  assert.equal(run(base(), { scriptWordCount: 10 }).direction.captions.keywords.length, 3);
});

test('music never louder than 0.16 and ducks to ≤0.6x', () => {
  const { direction } = run();
  assert.equal(direction.music.volume, LIMITS.musicMax);
  assert.ok(direction.music.duckedVolume <= +(LIMITS.musicMax * LIMITS.duckRatio).toFixed(3));
});

test('a well-behaved direction passes through without notes', () => {
  const d = {
    scenes: [{ id: 'a1', anchor: 'x', dur: 2, kind: 'Hook', props: { text: 'Millions of likes' } }, { id: 'a2', anchor: 'y', dur: 3, kind: 'Flow', props: {} }],
    zooms: [{ anchor: 'q', dur: 1, scale: 1.1 }], sfx: [{ name: 'Whoosh (sharp)', volume: 0.3 }, { name: 'Riser (sharp)', volume: 0.28 }],
    captions: { style: 'Short Pop', highlightColor: '#FFD84D', keywords: ['Kafka', 'Cassandra', 'uptime'] },
    music: { query: 'minimal tech', volume: 0.12, duckedVolume: 0.066, fadeIn: 0.6, fadeOut: 1.2 },
  };
  assert.deepEqual(run(d).notes, []);
});

// ───────── references (Repo / Site) ─────────
import { config } from '../server/config.mjs';
const refScene = (id, kind, props) => ({ id, anchor: 'x', dur: 3, kind, props });
const withRefs = (...scenes) => { const d = base(); d.scenes = [d.scenes[0], ...scenes]; d.sfx = []; return d; };

test('references: valid Repo/Site cards pass; a github.com URL is normalised to owner/name', () => {
  const { direction, notes } = run(withRefs(refScene('r1', 'Repo', { repo: 'https://github.com/apache/kafka' }), refScene('r2', 'Site', { url: 'https://kafka.apache.org' })));
  assert.equal(direction.scenes.find((s) => s.id === 'r1').props.repo, 'apache/kafka');
  assert.ok(direction.scenes.some((s) => s.id === 'r2'));
  assert.ok(!notes.some((n) => /dropped/.test(n)));
});

test('references: malformed repos and non-https URLs are dropped with a note, and their sfx go with them', () => {
  const d = withRefs(refScene('r1', 'Repo', { repo: 'not a repo' }), refScene('r2', 'Repo', { repo: '../../x' }), refScene('r3', 'Site', { url: 'http://insecure.example' }), refScene('r4', 'Site', { url: 'javascript:alert(1)' }), refScene('r5', 'Site', {}));
  d.sfx = [{ name: 'Whoosh (sharp)', volume: 0.3, on_scene: 'r1', edge: 'in' }, { name: 'Whoosh (sharp)', volume: 0.3, on_scene: 'a1', edge: 'in' }];
  const { direction, notes } = run(d);
  assert.deepEqual(direction.scenes.filter((s) => ['Repo', 'Site'].includes(s.kind)), []);
  assert.equal(notes.filter((n) => /dropped: invalid reference/.test(n)).length, 5);
  assert.deepEqual(direction.sfx.map((x) => x.on_scene), ['a1']);
});

test('references are capped at config.maxReferenceCards', () => {
  const many = Array.from({ length: config.maxReferenceCards + 2 }, (_, i) => refScene(`r${i}`, 'Repo', { repo: `o/r${i}` }));
  const { direction, notes } = run(withRefs(...many));
  assert.equal(direction.scenes.filter((s) => s.kind === 'Repo').length, config.maxReferenceCards);
  assert.equal(notes.filter((n) => /reference limit/.test(n)).length, 2);
});

test('references: a Site url is normalised to its canonical href (the key its fetched assets are stored under)', () => {
  const { direction } = run(withRefs(refScene('r1', 'Site', { url: 'https://kafka.apache.org' }), refScene('r2', 'Site', { url: 'https://Redis.IO/docs/../' })));
  assert.equal(direction.scenes.find((s) => s.id === 'r1').props.url, 'https://kafka.apache.org/');
  assert.equal(direction.scenes.find((s) => s.id === 'r2').props.url, 'https://redis.io/');
});
