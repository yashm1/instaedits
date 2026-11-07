// Caption helpers (pure, unit-tested): short caption lines at real word gaps, Latin-script Hinglish, and where captions sit.

/**
 * Split times that break one caption into lines of ≤ maxWords words, at the midpoint of the gap between two spoken words.
 * Balanced (5 → 3+2, 4 → 2+2, 7 → 3+2+2) so no line is a lonely single word unless the caption is one word.
 */
export function lineSplits(words, maxWords = 3) {
  const n = words.length;
  if (n <= maxWords) return [];
  const k = Math.ceil(n / maxWords);
  const base = Math.floor(n / k), extra = n % k;
  const out = []; let i = 0;
  for (let g = 0; g < k - 1; g++) { i += base + (g < extra ? 1 : 0); out.push(+((words[i - 1].end + words[i].start) / 2).toFixed(3)); }
  return out;
}

/** Split-layout windows (cards closer than `gap` s merge). KEEP IN SYNC with splitWindows() in remotion/src/geometry.ts (a test checks). */
export function splitWindows(scenes, gap = 0.7) {
  const ws = [];
  for (const s of [...scenes].sort((a, b) => a.start - b.start)) {
    const last = ws.at(-1);
    if (last && s.start - last.end < gap) last.end = Math.max(last.end, s.start + s.dur);
    else ws.push({ start: s.start, end: s.start + s.dur });
  }
  return ws;
}

export const CAPTION_Y = { split: 0.5, full: 0.72 }; // on the seam while a card shows (face stays clear); lower-middle otherwise.
// The Remotion caption layer interpolates between the two per frame with the split amount (Reel.tsx); `y` here is a hint.
/** Normalised y for a caption: on the seam if it overlaps (mostly) a split window, else the full-frame position. */
export function captionY(cap, windows) {
  const len = Math.max(0.01, cap.endTime - cap.startTime);
  const overlap = windows.reduce((a, w) => a + Math.max(0, Math.min(w.end, cap.endTime) - Math.max(w.start, cap.startTime)), 0);
  return overlap / len >= 0.5 ? CAPTION_Y.split : CAPTION_Y.full;
}

// ───────── Devanagari → Latin (fallback only; the LLM writes natural Hinglish, this guarantees no Devanagari survives) ─────────
const CONS = { क: 'k', ख: 'kh', ग: 'g', घ: 'gh', ङ: 'n', च: 'ch', छ: 'chh', ज: 'j', झ: 'jh', ञ: 'n', ट: 't', ठ: 'th', ड: 'd', ढ: 'dh', ण: 'n', त: 't', थ: 'th', द: 'd', ध: 'dh', न: 'n', प: 'p', फ: 'ph', ब: 'b', भ: 'bh', म: 'm', य: 'y', र: 'r', ल: 'l', व: 'v', श: 'sh', ष: 'sh', स: 's', ह: 'h', क़: 'q', ख़: 'kh', ग़: 'g', ज़: 'z', ड़: 'd', ढ़: 'rh', फ़: 'f', य़: 'y' };
const NUKTA = { क: 'q', ख: 'kh', ग: 'g', ज: 'z', ड: 'd', ढ: 'rh', फ: 'f' };
const VOW = { अ: 'a', आ: 'aa', इ: 'i', ई: 'ee', उ: 'u', ऊ: 'oo', ऋ: 'ri', ए: 'e', ऐ: 'ai', ओ: 'o', औ: 'au', ऑ: 'o', ऍ: 'e' };
const MATRA = { 'ा': 'aa', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॉ': 'o', 'ॅ': 'e' };
const MARK = { 'ं': 'n', 'ँ': 'n', 'ः': 'h' };
const DIG = '०१२३४५६७८९';

/** Simple schwa-deleting transliteration: "भाई," → "bhaai,", "किया" → "kiya". Latin text passes through unchanged. */
export function devanagariToLatin(word) {
  const s = [...String(word).normalize('NFC')];
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i], nx = s[i + 1];
    if (CONS[c] !== undefined) {
      let base = CONS[c];
      if (nx === '़') { base = NUKTA[c] ?? base; i++; } // decomposed nukta
      const after = s[i + 1];
      out += base;
      if (after === '्') { i++; continue; } // virama: no vowel
      if (MATRA[after] !== undefined) { out += MATRA[after]; i++; continue; }
      const wordEnd = after === undefined || !/\p{Script=Devanagari}/u.test(after) || after === '।';
      if (!wordEnd) out += 'a';
      continue;
    }
    if (VOW[c] !== undefined) { out += VOW[c]; continue; }
    if (MATRA[c] !== undefined) { out += MATRA[c]; continue; }
    if (MARK[c] !== undefined) { out += MARK[c]; continue; }
    if (c === '।' || c === '॥') { out += '.'; continue; }
    const d = DIG.indexOf(c);
    if (d >= 0) { out += String(d); continue; }
    if (c === '्' || c === '़') continue;
    out += c;
  }
  // Hinglish spelling conventions: a word-final long "aa" is written "a" (पूरा → poora), "aaee" → "ai" (भाई → bhai)
  return out.replace(/aaee(?=$|[^a-z])/g, 'ai').replace(/aa(?=$|[^a-z])/g, 'a');
}

export const hasDevanagari = (s) => /\p{Script=Devanagari}/u.test(String(s));

/**
 * Pick the Latin words for one caption: the LLM's line if it has exactly one word per caption token and no Devanagari
 * left, otherwise the rule-based fallback. Always returns `tokens.length` words — editCaption maps words to tokens 1:1.
 */
export function latinLine(tokens, llmWords) {
  const ok = Array.isArray(llmWords) && llmWords.length === tokens.length && llmWords.every((w) => typeof w === 'string' && w.trim() && !/\s/.test(w.trim()) && !hasDevanagari(w));
  return ok ? llmWords.map((w) => w.trim()) : tokens.map((t) => (hasDevanagari(t) ? devanagariToLatin(t) : t));
}

/**
 * Caption lines for the Remotion caption layer: text + timing come from the Edits app (lines already ≤3 words, Latin),
 * word timing from the transcript when the counts match, else proportional to word length. Words are contiguous so the
 * highlight never blinks off mid-line. `y`: on the seam during a card, lower-middle otherwise.
 */
export function captionLines(caps, words, windows) {
  return caps.map((c) => {
    const texts = c.words;
    const inside = words.filter((w) => w.start >= c.startTime - 0.05 && w.end <= c.endTime + 0.05);
    let starts;
    if (inside.length === texts.length && texts.length) starts = inside.map((w) => Math.max(c.startTime, w.start));
    else {
      const len = texts.map((t) => Math.max(1, t.length)), total = len.reduce((a, b) => a + b, 0) || 1;
      let acc = c.startTime; starts = len.map((l) => { const s = acc; acc += ((c.endTime - c.startTime) * l) / total; return s; });
    }
    const ws = texts.map((text, i) => ({ text, start: +starts[i].toFixed(3), end: +(i + 1 < texts.length ? starts[i + 1] : c.endTime).toFixed(3) }));
    return { start: +c.startTime.toFixed(3), end: +c.endTime.toFixed(3), y: captionY(c, windows), words: ws };
  }).filter((l) => l.words.length);
}
