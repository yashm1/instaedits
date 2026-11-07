import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lineSplits, splitWindows, captionY, CAPTION_Y, devanagariToLatin, latinLine, captionLines } from '../server/captions.mjs';
import { looksSecret, secretBoxes, redactFile } from '../server/screens.mjs';
import { judge, QA, cleanWindows } from '../server/qa.mjs';
import { trackExpr, filterGraph, compositeArgs } from '../server/composite.mjs';

// ───────── caption lines ─────────
const ws = (n) => Array.from({ length: n }, (_, i) => ({ start: i, end: i + 0.8 }));
test('lineSplits: ≤3 words per line, balanced, split in the gap between words', () => {
  assert.deepEqual(lineSplits(ws(3)), []);
  assert.deepEqual(lineSplits(ws(4)), [1.9], '2+2, mid-gap between word 2 and 3');
  assert.deepEqual(lineSplits(ws(5)), [2.9], '3+2');
  assert.deepEqual(lineSplits(ws(7)), [2.9, 4.9], '3+2+2 — never a lonely word');
  assert.equal(lineSplits(ws(12)).length, 3);
});

test('splitWindows merges cards closer than 0.7 s (the split stays open) — same rule as Reel.tsx', () => {
  const w = splitWindows([{ start: 5, dur: 2 }, { start: 0.1, dur: 2 }, { start: 7.5, dur: 1 }, { start: 2.6, dur: 1 }]);
  assert.deepEqual(w, [{ start: 0.1, end: 3.6 }, { start: 5, end: 8.5 }]);
  const geo = fs.readFileSync('remotion/src/geometry.ts', 'utf8');
  assert.match(geo, /export const MERGE_GAP = 0\.7;/, 'keep the merge gap identical on both sides');
});

test('captionY: on the seam if the caption is mostly during a card, else lower-middle', () => {
  const wins = [{ start: 2, end: 5 }];
  assert.equal(captionY({ startTime: 2.5, endTime: 3.5 }, wins), CAPTION_Y.split);
  assert.equal(captionY({ startTime: 4.5, endTime: 5.4 }, wins), CAPTION_Y.split, '0.5 s of 0.9 s overlaps');
  assert.equal(captionY({ startTime: 4.8, endTime: 6 }, wins), CAPTION_Y.full);
  assert.equal(captionY({ startTime: 6, endTime: 7 }, []), CAPTION_Y.full);
  assert.ok(CAPTION_Y.full < 0.8, 'clear of Instagram\'s bottom UI');
});

test('devanagariToLatin: readable Hinglish; Latin, digits and punctuation pass through', () => {
  assert.equal(devanagariToLatin('भाई,'), 'bhai,');
  assert.equal(devanagariToLatin('किया'), 'kiya');
  assert.equal(devanagariToLatin('है।'), 'hai.');
  assert.equal(devanagariToLatin('ज़रूर'), 'zaroor');
  assert.equal(devanagariToLatin('Kafka'), 'Kafka');
  assert.equal(devanagariToLatin('९९%'), '99%');
  assert.doesNotMatch(devanagariToLatin('इंफोग्राफिक्स जनरेट क्लॉड'), /\p{Script=Devanagari}/u);
});

test('latinLine: accepts the LLM line only if it is 1:1, single words, Latin; else falls back per token', () => {
  const t = ['ओ', 'भाई,', 'Claude'];
  assert.deepEqual(latinLine(t, ['O', 'bhai,', 'Claude']), ['O', 'bhai,', 'Claude']);
  assert.deepEqual(latinLine(t, ['O bhai,', 'Claude']), ['o', 'bhai,', 'Claude'], 'wrong count → fallback');
  assert.deepEqual(latinLine(t, ['O', 'भाई,', 'Claude']), ['o', 'bhai,', 'Claude'], 'Devanagari left → fallback');
  assert.deepEqual(latinLine(t, ['O', 'bhai ye', 'Claude']), ['o', 'bhai,', 'Claude'], 'a "word" with a space would shift every later token');
  assert.deepEqual(latinLine(t, null), ['o', 'bhai,', 'Claude']);
});

// ───────── secret redaction ─────────
const TOKEN = 'WZTVeTTl9CTbHUqh2sEJTTNc2yUrA-RLO5QPIP4ouVY'; // fake, same shape as an Edits token
test('looksSecret: catches the token (whole, prefix, suffix, OCR-garbled), ignores normal UI text', () => {
  assert.ok(looksSecret(TOKEN, TOKEN));
  assert.ok(looksSecret(TOKEN.slice(0, 20), TOKEN), 'OCR split the token in two');
  assert.ok(looksSecret(TOKEN.slice(-12), TOKEN));
  assert.ok(looksSecret('aB3dE5fG7hJ9kL1mN3pQ5rS', ''), 'any mixed-case+digit run ≥20 chars, even without knowing the token');
  for (const ok of ['Enable Automation Server', 'http://127.0.0.1:19501/mcp', '19501', 'Add Edits to Claude Code. Run the copied command', 'Regenerate', 'abcdefghijklmnopqrstuvwxyz'])
    assert.ok(!looksSecret(ok, TOKEN), ok);
});

test('secretBoxes: pads token boxes and covers the line under an "Access token" heading, but not prose or buttons', () => {
  const obs = [
    { text: 'Access token', x: 580, y: 530, w: 150, h: 22 },
    { text: 'WZTVeTTl9CTbHUqh2sEJ', x: 585, y: 580, w: 300, h: 26 }, // OCR got only part of it
    { text: 'Copy', x: 1100, y: 640, w: 55, h: 23 },
    { text: 'connection. Keep the access token private: anyone with it can edit', x: 567, y: 1196, w: 751, h: 25 },
    { text: 'projects while the server is on.', x: 567, y: 1224, w: 348, h: 27 },
  ];
  const b = secretBoxes(obs, TOKEN, 10);
  assert.equal(b.length, 1);
  assert.deepEqual(b[0], { x: 575, y: 570, w: 320, h: 46 });
  const garbled = secretBoxes([obs[0], { text: 'WZT Ve TT19', x: 585, y: 580, w: 300, h: 26 }], TOKEN);
  assert.equal(garbled.length, 1, 'even when OCR mangles the token, the line under the heading is covered');
});

test('redactFile fails CLOSED: if a secret is still readable after painting, the file is deleted', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-r-')); const f = path.join(dir, 'shot.png'); fs.writeFileSync(f, 'png');
  const obs = [{ text: TOKEN, x: 10, y: 10, w: 400, h: 20 }];
  let painted = null;
  // painting "worked": second OCR is clean
  assert.equal(await redactFile(f, TOKEN, { ocr: async () => (painted ? [] : obs), paint: async (_, boxes) => { painted = boxes; } }), 1);
  assert.ok(fs.existsSync(f));
  // painting "failed": token still visible → discarded
  await assert.rejects(() => redactFile(f, TOKEN, { ocr: async () => obs, paint: async () => {} }), /still readable/);
  assert.ok(!fs.existsSync(f), 'an unredacted screenshot must never be left behind');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ───────── QA verdict ─────────
const good = { finalDur: 24.3, reelDur: 24.32, satFinal: 30, satReel: 31, cards: [{ id: 's1', kind: 'Hook', t: 1, similarity: 0.9 }] };
test('judge: a faithful export passes', () => { assert.deepEqual(judge(good).problems, []); assert.equal(judge(good).ok, true); });
test('judge: catches black-and-white (the bug that shipped), missing/late cards and a wrong length', () => {
  assert.match(judge({ ...good, satFinal: 1.2 }).problems[0], /colour lost/);
  assert.match(judge({ ...good, cards: [{ id: 's2', kind: 'Flow', t: 5, similarity: 0.2 }] }).problems[0], /card s2 \(Flow @5s\) is not on screen/);
  assert.match(judge({ ...good, finalDur: 20 }).problems[0], /duration/);
  assert.match(judge({ ...good, finalDur: NaN }).problems[0], /duration/, 'an unreadable export is a failure, not a pass');
  assert.ok(QA.minColourRatio >= 0.5);
});

test('judge: fails when the export drifts from the ORIGINAL camera colour (the "colour distorted" report)', () => {
  assert.equal(judge({ ...good, fidelity: { maxDrift: 0.2 } }).ok, true);
  assert.match(judge({ ...good, fidelity: { maxDrift: 3.1 } }).problems[0], /colour differs from your original by 3\.1 levels/);
  assert.ok(QA.maxColourDrift <= 2.5);
});

test('cleanWindows: only full-frame, un-zoomed stretches ≥1 s, longest first, 1 s sample from the middle', () => {
  const T = (y, zoom, n) => Array.from({ length: n }, () => ({ y, zoom }));
  const track = [...T(0, 1, 45), ...T(300, 1, 60), ...T(0, 1.1, 30), ...T(0, 1, 90), ...T(0, 1, 0), ...T(672, 1, 10), ...T(0, 1, 20)];
  assert.deepEqual(cleanWindows(track), [{ t: 5.48, d: 1 }, { t: 0.23, d: 1 }], 'the 20-frame tail is too short; split/zoom frames never count');
});

// ───────── compositor (speaker pixels untouched) ─────────
test('trackExpr: run-length terms, base omitted, single frames use eq()', () => {
  assert.equal(trackExpr([0, 0, 0]), '0');
  assert.equal(trackExpr([0, 5, 5, 5, 0, 7]), '0+between(n,1,3)*5+eq(n,5)*7');
  assert.equal(trackExpr([1, 1.05, 1.05, 1], { variable: 'on', base: 1, digits: 4 }), '1+between(on,1,2)*0.05');
});

test('filterGraph: the speaker is only moved/scaled (no colour filters on it); graphics on top; voice to -14 LUFS', () => {
  const g = filterGraph({ track: [{ y: 0, zoom: 1 }, { y: 672, zoom: 1 }], duration: 2 });
  const spk = g.split('\n').find((l) => l.startsWith('[0:v]'));
  assert.match(spk, /zoompan/); assert.match(spk, /format=yuvj420p\[spk\];?$/);
  for (const banned of ['eq=', 'colorbalance', 'curves', 'lut', 'hue=', 'colorchannelmixer', 'colorspace', 'out_color_matrix']) assert.ok(!g.includes(banned), banned);
  assert.match(g, /overlay=x=0:y='0\+eq\(n,1\)\*672'/);
  assert.match(g, /\[base\]\[g\]overlay/); assert.match(g, /loudnorm=I=-14/);
});

test('compositeArgs: encodes with the camera\'s colour description (full range, BT.709 everywhere)', () => {
  const a = compositeArgs({ tight: 't.mp4', overlay: 'o.mov', graphFile: 'g', out: 'r.mp4' });
  const v = (k) => a[a.indexOf(k) + 1];
  assert.equal(v('-pix_fmt'), 'yuvj420p'); assert.equal(v('-color_range'), 'pc');
  for (const k of ['-colorspace', '-color_primaries', '-color_trc']) assert.equal(v(k), 'bt709');
});

test('captionLines: transcript word times when counts match, else proportional; contiguous; seam vs full position', () => {
  const words = [{ start: 0.2, end: 0.5 }, { start: 0.6, end: 0.9 }, { start: 1.0, end: 1.4 }];
  const [a, b] = captionLines([
    { startTime: 0.1, endTime: 1.5, words: ['bhai', 'ye', 'pura'] },
    { startTime: 3, endTime: 4, words: ['Claude', 'ne'] },
  ], words, [{ start: 0, end: 2 }]);
  assert.deepEqual(a.words.map((w) => [w.text, w.start, w.end]), [['bhai', 0.2, 0.6], ['ye', 0.6, 1], ['pura', 1, 1.5]]);
  assert.equal(a.y, CAPTION_Y.split, 'during a card → on the seam');
  assert.deepEqual(b.words.map((w) => [w.start, w.end]), [[3, 3.75], [3.75, 4]], 'no transcript words inside → split by word length');
  assert.equal(b.y, CAPTION_Y.full);
  assert.deepEqual(captionLines([{ startTime: 0, endTime: 1, words: [] }], [], []), [], 'empty lines are dropped');
});

test('filterGraph: audio comes from the Edits mix when given, trimmed to exactly the reel length (it ran 1.3 s long)', () => {
  const g = filterGraph({ track: [{ y: 0, zoom: 1 }], duration: 24.32, audioInput: 2 });
  assert.match(g, /\[2:a\]atrim=0:24\.320,asetpts=PTS-STARTPTS,loudnorm/);
  assert.match(filterGraph({ track: [{ y: 0, zoom: 1 }], duration: 5 }), /\[0:a\]atrim=0:5\.000/, 'dry run: the camera audio');
  const a = compositeArgs({ tight: 't', overlay: 'o', graphFile: 'g', out: 'x', audio: 'edits.mp4' });
  assert.deepEqual(a.slice(a.indexOf('-i'), a.indexOf('-filter_complex_script')), ['-i', 't', '-i', 'o', '-i', 'edits.mp4']);
});

import { linesFromWords } from '../server/captions.mjs';
test('linesFromWords: lines break at punctuation and pauses, ≤3 words, balanced; lines hold until the next one', () => {
  const W = (text, start, end) => ({ text, start, end });
  const L = linesFromWords([W('ओ', 0.1, 0.3), W('भाई,', 0.3, 0.7), W('ये', 0.8, 1), W('पूरा', 1, 1.3), W('वीडियो', 1.3, 1.7), W('क्लॉड', 1.8, 2.1), W('ने', 2.1, 2.2), W('अब', 3.5, 3.8)]);
  assert.ok(L.every((l) => l.words.length <= 3));
  assert.equal(L[0].words.map((w) => w.text).join(' '), 'ओ भाई,', 'comma ends a phrase');
  for (let i = 0; i + 1 < L.length; i++) assert.ok(L[i].end <= L[i + 1].start + 1e-9, 'no overlap');
  const pause = L.find((l) => l.words[0].text === 'अब');
  assert.ok(pause.start === 3.5 && L[L.indexOf(pause) - 1].end <= 2.8, 'a long pause ends the previous line ≤0.6 s after its last word');
  for (const l of L) for (let j = 0; j + 1 < l.words.length; j++) assert.equal(l.words[j].end, l.words[j + 1].start, 'the highlight never blinks off mid-line');
});

test('compositeArgs hq (fresh take): CRF 12 + slow; default CRF 14 + medium', () => {
  const v = (a, k) => a[a.indexOf(k) + 1];
  const n = compositeArgs({ tight: 't', overlay: 'o', graphFile: 'g', out: 'x' }), h = compositeArgs({ tight: 't', overlay: 'o', graphFile: 'g', out: 'x', hq: true });
  assert.deepEqual([v(n, '-crf'), v(n, '-preset')], ['14', 'medium']);
  assert.deepEqual([v(h, '-crf'), v(h, '-preset')], ['12', 'slow']);
  assert.equal(v(h, '-pix_fmt'), 'yuvj420p', 'colour description unchanged');
});

import { isEditorScreen } from '../server/screens.mjs';
test('isEditorScreen: the Edits editor passes; the projects grid (a wall of thumbnails) never does', () => {
  const o = (...t) => t.map((text) => ({ text }));
  assert.equal(isEditorScreen(o('New project 13', 'Media', 'Audio', 'Captions', 'Export', 'Feedback')), true, 'the editor title bar shows the project name');
  assert.equal(isEditorScreen(o('Media', 'Audio', 'Text', 'Captions', 'Export', '00:24.24')), true);
  assert.equal(isEditorScreen(o('Projects', 'New project 12', 'Today · 57 MB · 00:24', 'New project')), false);
  assert.equal(isEditorScreen(o('Settings', 'Automation')), false);
});
