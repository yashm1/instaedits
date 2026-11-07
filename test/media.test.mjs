import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCuts, findAnchor, sentences, attachAlt, buildEdl, detectLanguage } from '../server/media.mjs';

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

// ───────── non-English / no-script: numbered sentences and "#N" anchors ─────────
const HI = [
  W('नमस्ते', 0.4, 0.8), W('दोस्तों।', 0.8, 1.3),
  W('आज', 1.5, 1.7), W('हम', 1.7, 1.9), W('Kafka', 1.9, 2.3), W('समझेंगे', 2.3, 2.9),
  // long pause → new sentence even without punctuation
  W('यह', 4.2, 4.4), W('बहुत', 4.4, 4.7), W('तेज़', 4.7, 5.0), W('है', 5.0, 5.2),
  W('क्या', 6.5, 6.8), W('आप', 6.8, 7.0), W('तैयार', 7.0, 7.4), W('हैं?', 7.4, 7.8),
  W('चलिए', 9.5, 9.9), W('शुरू', 9.9, 10.3), W('करते', 10.3, 10.6), W('हैं।', 10.6, 11.0),
];

test('sentences are numbered from 1 and split on the Devanagari danda (।), ? and pauses', () => {
  const c = planCuts(HI, 12);
  const s = sentences(HI, c.toOut);
  assert.deepEqual(s.map((x) => x.n), [1, 2, 3, 4, 5]);
  assert.equal(s[0].text, 'नमस्ते दोस्तों।');
  assert.match(s[1].text, /Kafka/);
  assert.equal(s[2].text, 'यह बहुत तेज़ है'); // split by the pause, no punctuation
  for (let i = 1; i < s.length; i++) assert.ok(s[i].t > s[i - 1].t, 'strictly increasing start times');
});

test('sentence numbering is deterministic (direction and resolve must agree)', () => {
  const c = planCuts(HI, 12);
  assert.deepEqual(sentences(HI, c.toOut), sentences(HI, c.toOut));
});

const dir2 = (scenes, extra = {}) => ({ scenes: scenes.map((s, i) => ({ id: `a${i + 1}`, dur: 2, kind: 'Stat', props: {}, transition_in: 'transition_blur', transition_out: 'transition_blur', ...s })), zooms: [], sfx: [], captions: { style: 'Short Pop', highlightColor: '#FFD84D', keywords: [] }, music: {}, grade: {}, ...extra });

test('buildEdl resolves "#N" anchors to the start of that sentence — language-independent', () => {
  const c = planCuts(HI, 12); const sents = sentences(HI, c.toOut);
  const e = buildEdl(dir2([{ anchor: '#1', kind: 'Hook' }, { anchor: '#3' }, { anchor: '#5' }]), HI, c, () => {}, sents, 'hi');
  assert.equal(e.language, 'hi');
  assert.equal(e.scenes.length, 3);
  assert.equal(e.scenes[0].start, 0.1, 'opening Hook still lands at 0.1s');
  assert.ok(Math.abs(e.scenes[1].start - (sents[2].t - 0.08)) < 0.011);
  assert.ok(Math.abs(e.scenes[2].start - (sents[4].t - 0.08)) < 0.011);
});

test('"#N" anchors work for zooms and sfx too; unknown sentence numbers are dropped and logged', () => {
  const c = planCuts(HI, 12); const sents = sentences(HI, c.toOut); const logs = [];
  const d = dir2([{ anchor: '#1', kind: 'Hook' }, { anchor: '#99' }], { zooms: [{ anchor: '#3', dur: 1, scale: 1.1 }, { anchor: '#77', dur: 1, scale: 1.1 }], sfx: [{ name: 'Whoosh (sharp)', volume: 0.3, anchor: '#5' }] });
  const e = buildEdl(d, HI, c, (m) => logs.push(m), sents, 'hi');
  assert.equal(e.scenes.length, 1);
  assert.ok(logs.some((l) => /#99/.test(l)));
  assert.equal(e.zooms.length, 1);
  assert.equal(e.sfx.length, 1);
  assert.ok(Math.abs(e.sfx[0].at - (sents[4].t - 0.05)) < 0.011);
});

test('without sentence info a "#N" anchor is dropped, never mistaken for words', () => {
  const c = planCuts(words, 11); const logs = [];
  const e = buildEdl(dir2([{ anchor: '#2' }]), words, c, (m) => logs.push(m));
  assert.equal(e.scenes.length, 0);
  assert.equal(e.language, 'en');
});

test('English default: EDL carries language "en" and word anchors still work alongside', () => {
  const c = planCuts(words, 11);
  const e = buildEdl(direction(), words, c, () => {});
  assert.equal(e.language, 'en');
});

// ───────── long, unpunctuated speech must not collapse into one sentence ─────────
const run = (n, gaps = []) => { // n evenly spaced words, 0.4s each, extra pause after word i given in gaps
  let t = 0; return Array.from({ length: n }, (_, i) => { const w = W(`w${i}`, t, t + 0.4); t += 0.4 + 0.05 + (gaps.find(([k]) => k === i)?.[1] ?? 0); return w; });
};
test('a long run with no punctuation and no big pause is split into short sentences (≤14 words, ≤6 s)', () => {
  const ws = run(60); const c = planCuts(ws, 40); const s = sentences(ws, c.toOut);
  assert.ok(s.length >= 4, `got ${s.length}`);
  s.forEach((x, i) => { assert.ok(x.text.split(' ').length <= 14, `#${x.n} too long`); assert.equal(x.n, i + 1); });
  assert.equal(s.map((x) => x.text).join(' '), ws.map((w) => w.w).join(' '), 'no word lost or reordered');
});

test('splits at the LARGEST internal pause, keeping ≥3 words on each side', () => {
  const ws = run(16, [[9, 0.55]]); // biggest pause after word 9 (below the 0.7 hard-split)
  const s = sentences(ws, (t) => t);
  assert.equal(s.length, 2);
  assert.equal(s[0].text.split(' ').length, 10);
  const tiny = sentences(run(15, [[0, 0.6]]), (t) => t); // pause after word 0 would leave 1 word — not allowed
  tiny.forEach((x) => assert.ok(x.text.split(' ').length >= 3 || tiny.length === 1));
});

test('short sentences are left alone; punctuation and long pauses still split first', () => {
  const ws = [W('a', 0, .3), W('b', .3, .6), W('c.', .6, .9), W('d', 1, 1.3), W('e', 1.3, 1.6), W('f', 3, 3.3)];
  const s = sentences(ws, (t) => t);
  assert.deepEqual(s.map((x) => x.text), ['a b c.', 'd e', 'f']);
});

test('real-world shape: the 59-word unpunctuated Hindi transcript yields many sentences, not one', () => {
  const hi = 'नमस्ते दोस्तों क्या आपने सोचा है कि इंस्टाग्राम हर सेकंड लाखों लाइक कैसे संभालता है सबसे पहले क्लाइंट लोड बैलेंसर तक पहुँचता है फिर लाइक्स पहले में लिखे जाते हैं में नहीं ताकि ट्रैफिक बढ़ने पर भी सिस्टम ना रुके इसके बाद वर्कर्स उन्हें में बैच में लिखते हैं नतीजा निन्यानवे दशमलव नौ प्रतिशत यही है हाई लेवल डिजाइन'.split(' ');
  let t = 0.4; const ws = hi.map((w) => { const x = W(w, t, t + 0.35); t += 0.35 + 0.1; return x; });
  const s = sentences(ws, (x) => x);
  assert.ok(s.length >= 5 && s.length <= 12, `got ${s.length}`);
});

test('attachAlt: alt-pass words are grouped under the sentence they were spoken in (by time)', () => {
  const sents = [{ n: 1, t: 0, text: 'a' }, { n: 2, t: 5, text: 'b' }, { n: 3, t: 10, text: 'c' }];
  const alt = [W('Kafka', 1, 1.4), W('is', 4.9, 5.2), W('fast', 6, 6.4), W('99.99%', 11, 11.5)];
  const r = attachAlt(sents, alt, (t) => t);
  assert.equal(r[0].alt, 'Kafka'); assert.equal(r[1].alt, 'is fast'); assert.equal(r[2].alt, '99.99%');
  assert.deepEqual(r.map((x) => x.n), [1, 2, 3], 'numbering untouched');
});

test('attachAlt: sentences with no alt words stay untouched; empty alt list is a no-op', () => {
  const sents = [{ n: 1, t: 0, text: 'a' }, { n: 2, t: 5, text: 'b' }];
  assert.deepEqual(attachAlt(sents, [], (t) => t), sents);
  const r = attachAlt(sents, [W('x', 6, 6.2)], (t) => t);
  assert.ok(!('alt' in r[0])); assert.equal(r[1].alt, 'x');
});

test('attachAlt uses the tight-timeline mapping (cuts shift alt words like primary words)', () => {
  const c = planCuts(words, 11); const sents = sentences(words, c.toOut);
  const r = attachAlt(sents, [W('Kafka', 6.7, 7.1)], c.toOut); // spoken in "Likes go to Kafka first."
  const hit = r.find((x) => x.alt);
  assert.match(hit.text, /Kafka/);
});

test('attachAlt tolerates cross-pass timing jitter: a word starting 0.2s before its sentence still belongs to it', () => {
  const sents = [{ n: 1, t: 0, text: 'a' }, { n: 2, t: 5, text: 'b' }];
  const r = attachAlt(sents, [W('early', 4.8, 5.1), W('late', 4.6, 4.9)], (t) => t);
  assert.equal(r[1].alt, 'early'); // 4.8 ≥ 5 − 0.3
  assert.equal(r[0].alt, 'late');  // 4.6 < 4.7: still the previous sentence
});

// ───────── non-Latin scripts in the word-anchor path (the bug that dropped 4 of 5 cards on a real Hindi reel) ─────────
const REEL = 'ओ भाई, ये पूरा वीडियो क्लॉड ने एडिट किया है। तो रिसेंटली Instagram ने एडिट्स ऐप लॉन्च किया है फॉर द डेस्कटॉप। अब इसमें तुम ऑटोमेशन सर्वर रन कर सकते हो थ्रू क्लॉड कोड एक्स एंड जेमिन। इसके बाद में तुम्हें इस GitHub रेपोजिटरी पे जाना है।'.split(' ');
const reelWords = (() => { let t = 0.3; return REEL.map((w) => { const x = W(w, t, t + 0.4); t += 0.42; return x; }); })();

test('findAnchor matches Devanagari phrases (matras, punctuation and danda are handled)', () => {
  assert.equal(findAnchor(reelWords, 'ओ भाई, ये पूरा'), 0);
  const i = findAnchor(reelWords, 'अब इसमें तुम ऑटोमेशन');
  assert.equal(reelWords[i].w, 'अब');
  assert.equal(reelWords[findAnchor(reelWords, 'इसके बाद में तुम्हें इस')].w, 'इसके');
  assert.equal(reelWords[findAnchor(reelWords, 'जेमिन। इसके बाद')].w, 'जेमिन।', 'danda inside the anchor is ignored');
});

test('findAnchor matches mixed Devanagari + Latin phrases', () => {
  const i = findAnchor(reelWords, 'तो रिसेंटली Instagram ने');
  assert.equal(reelWords[i].w, 'तो');
  assert.notEqual(findAnchor(reelWords, 'इस GitHub रेपोजिटरी'), -1);
});

test('different Devanagari words do not collide just because marks were stripped', () => {
  const ws = [W('का', 0, .3), W('कि', .3, .6), W('की', .6, .9), W('को', .9, 1.2)];
  assert.equal(findAnchor(ws, 'की'), 2); assert.equal(findAnchor(ws, 'को'), 3); assert.equal(findAnchor(ws, 'कि'), 1);
});

test('buildEdl places cards on Hindi verbatim anchors (nothing dropped for being non-Latin)', () => {
  const c = planCuts(reelWords, 20); const logs = [];
  const d = dir2([{ anchor: 'ओ भाई, ये पूरा', kind: 'Hook' }, { anchor: 'अब इसमें तुम ऑटोमेशन' }]);
  const e = buildEdl(d, reelWords, c, (m) => logs.push(m));
  assert.equal(e.scenes.length, 2); assert.ok(!logs.some((l) => /anchor not found/.test(l)));
});

test('detectLanguage: Devanagari-dominant → hi; English/romanised → en; mixed Hinglish with Devanagari majority → hi; empty → en', () => {
  assert.equal(detectLanguage(reelWords), 'hi');
  assert.equal(detectLanguage([W('Kafka', 0, 1), W('is', 1, 2), W('fast', 2, 3)]), 'en');
  assert.equal(detectLanguage('kya aap ready hain'.split(' ').map((w, i) => W(w, i, i + 1))), 'en', 'romanised Hindi is Latin: not detectable by script, stays as declared');
  assert.equal(detectLanguage('नमस्ते दोस्तों Kafka'.split(' ').map((w, i) => W(w, i, i + 1))), 'hi');
  assert.equal(detectLanguage([]), 'en');
  assert.equal(detectLanguage([W('99.99%', 0, 1)]), 'en');
});
