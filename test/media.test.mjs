import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCuts, findAnchor, sentences, buildEdl } from '../server/media.mjs';

const W = (s, a, b) => ({ w: s, start: a, end: b });
const words = [
  W('Ever', 0.5, 0.7), W('wondered', 0.7, 1.1), W('how', 1.1, 1.3), W('Instagram', 1.3, 1.8), W('works?', 1.8, 2.2),
  // 1.5s of dead air
  W('Step', 3.7, 3.9), W('one,', 3.9, 4.2), W('the', 4.2, 4.3), W('client', 4.3, 4.7), W('hits', 4.7, 5.0), W('a', 5.0, 5.1), W('load', 5.1, 5.3), W('balancer.', 5.3, 5.9),
  W('Likes', 6.0, 6.4), W('go', 6.4, 6.6), W('to', 6.6, 6.7), W('Kafka', 6.7, 7.1), W('first.', 7.1, 7.6),
  W('Result:', 9.0, 9.5), W('uptime.', 9.5, 10.2),
];

test('planCuts removes gaps > 0.4s and keeps natural rhythm', () => {
  const c = planCuts(words, 11);
  assert.ok(c.segs.length >= 3, 'dead-air gaps split the clip');
  assert.ok(c.saved > 2, 'dead air removed');
  assert.ok(Math.abs(c.total - (11 - c.saved)) < 1e-9);
  // leading silence trimmed
  assert.ok(c.segs[0].start < 0.5 && c.segs[0].start >= 0.3);
});

test('planCuts keeps small gaps (<=0.4s) intact', () => {
  const c = planCuts([W('a', 0, 0.3), W('b', 0.6, 0.9)], 2);
  assert.equal(c.segs.length, 1);
});

test('toOut maps source time → tight timeline monotonic', () => {
  const c = planCuts(words, 11);
  let prev = -1;
  for (const w of words) { const t = c.toOut(w.start); assert.ok(t >= prev); prev = t; }
  assert.ok(c.toOut(3.7) < 3.7, 'after the cut, output time is earlier than source time');
  assert.ok(Math.abs(c.toOut(100) - c.total) < 1e-9);
});

test('findAnchor finds phrase despite punctuation/case and returns -1 for junk', () => {
  assert.equal(findAnchor(words, 'the client hits a load'), 7);
  assert.equal(findAnchor(words, 'LIKES go to kafka'), 13);
  assert.equal(findAnchor(words, 'completely unrelated words here'), -1);
  assert.equal(findAnchor(words, ''), -1);
});

test('findAnchor tolerates one mis-heard word (>=60% match)', () => {
  assert.notEqual(findAnchor(words, 'the client hit a load balancer'), -1);
});

test('sentences groups on punctuation and gaps, on the tight timeline', () => {
  const c = planCuts(words, 11);
  const s = sentences(words, c.toOut);
  assert.equal(s.length, 4);
  assert.match(s[1].text, /^Step one/);
  assert.ok(s[1].t < 3.7);
});

const direction = (over = {}) => ({
  scenes: [
    { id: 'a1', anchor: 'Ever wondered how Instagram', dur: 2, kind: 'Hook', props: { text: 'Hi' }, transition_in: 'transition_blur', transition_out: 'transition_blur' },
    { id: 'a2', anchor: 'the client hits a load', dur: 3, kind: 'Flow', props: {}, transition_in: 'transition_blur', transition_out: 'transition_blur' },
    { id: 'a3', anchor: 'Likes go to Kafka first', dur: 2, kind: 'Stat', props: {}, transition_in: 'transition_blur', transition_out: 'transition_blur' },
    { id: 'a4', anchor: 'nonexistent phrase xyz', dur: 2, kind: 'Stat', props: {}, transition_in: 'transition_blur', transition_out: 'transition_blur' },
  ],
  zooms: [{ anchor: 'Ever wondered how Instagram', dur: 1, scale: 1.1 }, { anchor: 'Likes go to Kafka', dur: 1, scale: 1.1 }],
  sfx: [{ name: 'Whoosh (sharp)', volume: 0.3, on_scene: 'a2', edge: 'in' }, { name: 'Whoosh (sharp)', volume: 0.3, on_scene: 'a2', edge: 'in', offset: 0.1 }],
  captions: { style: 'Short Pop', highlightColor: '#FFD84D', keywords: ['Kafka'] },
  music: { query: 'minimal tech' }, grade: { note: 'x' }, ...over,
});

test('buildEdl: hook starts at 0.1s, unresolvable anchors are dropped, scenes never overlap', () => {
  const c = planCuts(words, 11); const logs = [];
  const e = buildEdl(direction(), words, c, (m) => logs.push(m));
  assert.equal(e.scenes[0].kind, 'Hook');
  assert.equal(e.scenes[0].start, 0.1);
  assert.ok(logs.some((l) => /nonexistent/.test(l)), 'dropped scene is logged');
  assert.equal(e.scenes.length, 3);
  for (let i = 1; i < e.scenes.length; i++) assert.ok(e.scenes[i].start >= e.scenes[i - 1].start + e.scenes[i - 1].dur, 'no overlap');
  e.scenes.forEach((s, i) => assert.equal(s.id, `s${i + 1}`));
});

test('buildEdl: zooms never overlap a card; a zoom that cannot fit is dropped', () => {
  const c = planCuts(words, 11);
  const e = buildEdl(direction(), words, c, () => {});
  for (const z of e.zooms) for (const s of e.scenes) assert.ok(z.start + z.dur <= s.start || z.start >= s.start + s.dur, `zoom ${z.start} overlaps ${s.id}`);
});

test('buildEdl: sfx are ≥0.8s apart and sorted', () => {
  const c = planCuts(words, 11);
  const e = buildEdl(direction(), words, c, () => {});
  assert.equal(e.sfx.length, 1, 'two near-identical cues collapse to one');
  for (let i = 1; i < e.sfx.length; i++) assert.ok(e.sfx[i].at - e.sfx[i - 1].at >= 0.8);
});

test('buildEdl: scene duration is clamped to leave room for the next card', () => {
  const c = planCuts(words, 11);
  const e = buildEdl(direction(), words, c, () => {});
  for (let i = 0; i < e.scenes.length - 1; i++) assert.ok(e.scenes[i].start + e.scenes[i].dur <= e.scenes[i + 1].start - 0.4);
  assert.ok(e.scenes.at(-1).start + e.scenes.at(-1).dur <= e.duration + 1e-9);
});

test('buildEdl: a card anchored on the final words has no room and is dropped (logged)', () => {
  const c = planCuts(words, 11); const logs = [];
  const d = direction({ scenes: [{ id: 'z', anchor: 'Result uptime', dur: 2, kind: 'Stat', props: {}, transition_in: 'transition_blur', transition_out: 'transition_blur' }] });
  const e = buildEdl(d, words, c, (m) => logs.push(m));
  assert.equal(e.scenes.length, 0);
  assert.ok(logs.some((l) => /no room/.test(l)));
});
