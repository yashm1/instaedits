import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lineSplits, splitWindows, captionY, CAPTION_Y, devanagariToLatin, latinLine } from '../server/captions.mjs';
import { looksSecret, secretBoxes, redactFile } from '../server/screens.mjs';
import { judge, QA } from '../server/qa.mjs';

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
  const tsx = fs.readFileSync('remotion/src/Reel.tsx', 'utf8');
  assert.match(tsx, /const MERGE_GAP = 0\.7;/, 'keep the merge gap identical on both sides');
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
