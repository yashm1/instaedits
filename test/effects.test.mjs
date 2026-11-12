import { test } from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import assert from 'node:assert/strict';
import { FX_CATALOG, FX_LIMITS, fxSegments } from '../server/effects.mjs';
import { applyGuardrails } from '../server/guardrails.mjs';
import { buildEdl, planCuts, sentences } from '../server/media.mjs';
import * as P from '../server/prompts.mjs';

test('fxSegments: nearby effects share one padded slice; times inside a slice are relative to it', () => {
  const s = fxSegments([{ fx: 'spotlight', start: 7, end: 9, text: 'AUTOMATION' }, { fx: 'backdrop-word', start: 1, end: 3, text: 'CLAUDE' }, { fx: 'tape-label', start: 3.6, end: 5 }], 24);
  assert.equal(s.length, 2, '1-3 and 3.6-5 merge (gap < 1 s); 7-9 is its own slice');
  assert.deepEqual([s[0].offset, s[0].length], [0.5, 5]);
  assert.deepEqual(s[0].plan.effects.map((e) => [e.fx, e.start, e.end]), [['backdrop-word', 0.5, 2.5], ['tape-label', 3.1, 4.5]]);
  assert.deepEqual(s[0].windows, [[1, 3], [3.6, 5]]);
  assert.deepEqual([s[1].offset, s[1].length, s[1].plan.effects[0].text], [6.5, 3, 'AUTOMATION']);
  assert.equal(fxSegments([{ fx: 'tap', start: 23.5, end: 24.3 }], 24.3)[0].length, 0.8 + FX_LIMITS.pad, 'clipped at the end of the clip');
});

test('guardrails: effects only when installed; unknown names dropped; ≤4; duration clamped; text trimmed; opts sanitised', () => {
  const base = { scenes: [], zooms: [], sfx: [], music: { volume: 0.1, duckedVolume: 0.06 } };
  const fx = [{ fx: 'backdrop-word', anchor: '#2', dur: 9, text: 'SUPERCALIFRAGILISTIC' }, { fx: 'made-up', anchor: '#3', dur: 2 }, { fx: 'tap', anchor: '#4', dur: 1, opts: { at: 0.6, 'bad key!': 'x', nested: { a: 1 } } },
    ...['spotlight', 'tape-label', 'comment-box'].map((n, i) => ({ fx: n, anchor: `#${5 + i}`, dur: 2, text: 'HI' }))];
  const off = applyGuardrails({ ...base, effects: fx }, { totalSeconds: 30, scriptWordCount: 50 });
  assert.equal(off.direction.effects.length, 0); assert.ok(off.notes.some((n) => /not installed/.test(n)));
  const on = applyGuardrails({ ...base, effects: fx }, { totalSeconds: 30, scriptWordCount: 50, effectsAvailable: true });
  assert.equal(on.direction.effects.length, FX_LIMITS.max);
  const [bw, tap] = on.direction.effects;
  assert.equal(bw.dur, FX_LIMITS.durMax); assert.equal(bw.text.length, FX_CATALOG['backdrop-word'].max);
  assert.equal(tap.dur, FX_LIMITS.durMin); assert.deepEqual(tap.opts, { at: '0.6' }); assert.equal(tap.text, undefined, 'tap takes no text');
  assert.ok(on.notes.some((n) => /made-up" is not in the catalog/.test(n)));
});

test('resolver: effects land on the spoken word, never under a card, never overlapping each other', () => {
  const W = (w, s, e) => ({ w, start: s, end: e });
  // continuous speech (no pause long enough to be cut): 3 sentences, a word every 0.4 s
  const say = (txt, t0) => txt.split(' ').map((w, i) => W(w, +(t0 + i * 0.4).toFixed(2), +(t0 + i * 0.4 + 0.38).toFixed(2)));
  const words = [...say('Hello there my friends how are.', 0.2), ...say('Claude edits videos fast today.', 2.6), ...say('Comment insta now please.', 4.6)];
  const c = planCuts(words, 7); const sents = sentences(words, c.toOut);
  const d = { scenes: [{ id: 'a1', anchor: '#1', dur: 1.5, kind: 'Hook', props: { text: 'Hi' } }], zooms: [], sfx: [],
    effects: [{ fx: 'backdrop-word', anchor: '#2', word: 'Claude', dur: 2, text: 'CLAUDE' }, { fx: 'spotlight', anchor: '#2', dur: 2, text: 'X' }, { fx: 'comment-box', anchor: '#3', word: 'insta', dur: 1.5, text: 'INSTA' }, { fx: 'tap', anchor: '#1', dur: 2 }] };
  const logs = []; const e = buildEdl(d, words, c, (m) => logs.push(m), sents);
  assert.deepEqual(e.effects.map((x) => x.fx), ['backdrop-word', 'comment-box'], 'spotlight overlaps backdrop-word; tap sits under the opening card');
  assert.ok(Math.abs(e.effects[0].start - (c.toOut(2.6) - 0.1)) < 0.011, 'on the word "Claude"');
  assert.ok(logs.some((l) => /no free speaker-only gap/.test(l) || /moved/.test(l)));
  assert.ok(!e.zooms.some((z) => e.effects.some((x) => z.start < x.end && z.start + z.dur > x.start)), 'no punch-in on top of an effect');
});

test('the director sees the effects list only when the pack is installed', () => {
  const on = P.directorPrompt({ sentences: [{ n: 1, t: 0, text: 'x' }], duration: 5, library: 'L', effects: FX_CATALOG });
  assert.match(on, /EFFECTS available/); assert.match(on, /- comment-box — an Instagram comment types a word/);
  assert.doesNotMatch(P.directorPrompt({ sentences: [{ n: 1, t: 0, text: 'x' }], duration: 5, library: 'L' }), /EFFECTS available/);
  assert.match(P.DIRECTOR_SYSTEM, /EFFECTS \(only if an EFFECTS list is in the brief\)/); assert.match(P.DIRECTOR_SYSTEM, /Never on top of a card/);
});

import { fxSlot } from '../server/media.mjs';
test('fxSlot: a clashing effect slides into the nearest free gap (±1.5 s), shortens to fit, or is dropped', () => {
  assert.deepEqual(fxSlot(5, 2, 20, []), [5, 7]);
  assert.deepEqual(fxSlot(5, 2, 20, [[4, 6]]), [6, 8], 'slides past the card');
  assert.deepEqual(fxSlot(10, 3, 20, [[6, 9.4], [12, 14]]), [9.4, 12], 'fits the 2.6 s gap, starting 0.6 s early');
  assert.deepEqual(fxSlot(21.2, 2, 23.3, [[21, 23.1]]), null, 'no room near the end → dropped');
  assert.deepEqual(fxSlot(3, 4, 20, [[0, 2], [4.5, 9]]), [2, 4.5], 'shortened to the 2.5 s gap');
});

import { fxZone } from '../server/effects.mjs';
test('effect zones: chest/chin UI is "low" (captions lift above the head); behind-the-head words are "high"', () => {
  for (const k of ['checklist', 'tap', 'comment-box', 'tape-label', 'todo', 'messages']) assert.equal(fxZone(k), 'low', k);
  for (const k of ['backdrop-word', 'spotlight', 'crayon-write', 'huge-strike', 'led-sign']) assert.equal(fxZone(k), 'high', k);
  const reel = require('node:fs').readFileSync('remotion/src/Reel.tsx', 'utf8');
  assert.match(reel, /lift=\{effects\.some\(\(e\) => e\.zone === 'low'/);
});
