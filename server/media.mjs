// Local, token-free media work: Edits transcription, silence tightening, anchor → time resolution.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { tool as editsTool } from './edits-mcp.mjs';

// Unicode-aware: letters, digits AND combining marks (Devanagari vowel signs are marks). The old [a-z0-9] stripped Hindi to nothing.
const norm = (w) => w.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}\p{M}]/gu, '');

function run(cmd, args, { onLine, signal } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { signal }); let err = '';
    const feed = (d) => String(d).split('\n').forEach((l) => l.trim() && onLine?.(l.trim().slice(0, 140)));
    p.stdout.on('data', feed); p.stderr.on('data', (d) => { err += d; feed(d); });
    p.on('error', reject);
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited ${c}: ${err.slice(-300)}`))));
  });
}

/** Pull [{w,start,end}] out of whatever shape the Edits transcription returns. */
function extractWords(x, acc = []) {
  if (Array.isArray(x)) { x.forEach((y) => extractWords(y, acc)); return acc; }
  if (x && typeof x === 'object') {
    const w = x.word ?? x.text;
    if (typeof w === 'string' && typeof x.start === 'number' && typeof x.end === 'number' && !/\s.+\s/.test(w.trim())) acc.push({ w: w.trim(), start: x.start, end: x.end });
    else Object.values(x).forEach((y) => extractWords(y, acc));
  }
  return acc;
}

/**
 * Word timestamps from the Edits app's own captions model: zero LLM tokens, nothing extra to install.
 * For non-English speech a SECOND pass with the English model is stored as transcript.alt.json: in practice it keeps
 * English terms and numbers (Kafka, 99.99%) that the native pass drops. Best-effort — never fails the step.
 */
// Edits transcribes in the cloud (it uploads the audio), so network blips happen. These are worth retrying.
export const isTransient = (msg) => /network is unreachable|unreachable|offline|timed out|timeout|connection (reset|refused|lost)|uploadFailed|temporar|ECONNRESET|ENOTFOUND|\b50[234]\b/i.test(String(msg));

export async function transcribe(video, dir, log, language = 'en', { attempts = 4, delayMs = 5000 } = {}) {
  const out = path.join(dir, 'transcript.json');
  if (fs.existsSync(out)) { log('♻️ transcript cached'); return JSON.parse(fs.readFileSync(out, 'utf8')); }
  log('Edits app: new project + import…');
  await editsTool('newProject');
  const imp = await editsTool('importMedia', { path: video });
  const id = imp?.id ?? imp?.itemId ?? imp?.clipId ?? imp?.items?.[0]?.id ?? imp?.item?.id;
  if (!id) throw new Error('importMedia returned no id: ' + JSON.stringify(imp).slice(0, 200));
  // Right after an import the app may not have the media ready (empty transcript), and the upload can hit a network blip: retry with backoff.
  let words = [], last, lastErr;
  for (let i = 1; i <= attempts && !words.length; i++) {
    if (i > 1) { log(`${lastErr ? 'network error' : 'empty transcript'} — retrying in ${(delayMs * (i - 1)) / 1000}s (attempt ${i}/${attempts})…`); await new Promise((r) => setTimeout(r, delayMs * (i - 1))); }
    log(`Edits app: transcribing (${language})…`);
    lastErr = null;
    try {
      last = await editsTool('transcribeClip', { id, language, mergeSplitWords: true });
      words = extractWords(last.words ?? last);
    } catch (e) {
      if (!isTransient(e.message)) throw e;
      lastErr = e;
      if (i === attempts) throw new Error(`Edits could not reach its transcription service (it uploads the audio) — check your internet connection, then use "Re-run from here". Last error: ${e.message.replace(/\s+/g, ' ').slice(0, 160)}`);
    }
  }
  fs.writeFileSync(path.join(dir, 'transcript.raw.json'), JSON.stringify(last ?? null));
  if (!words.length) throw new Error(`no words in transcript after ${attempts} attempts — Edits replied: ${JSON.stringify(last).slice(0, 200)}`);
  if (language !== 'en') {
    try {
      log('Edits app: second pass (en) to recover English terms…');
      const alt = extractWords((await editsTool('transcribeClip', { id, language: 'en', mergeSplitWords: true })).words ?? []);
      fs.writeFileSync(path.join(dir, 'transcript.alt.json'), JSON.stringify({ words: alt }));
      log(`alt pass: ${alt.length} words`);
    } catch (e) { log(`⚠️ alt pass skipped: ${e.message.slice(0, 120)}`); }
  }
  fs.writeFileSync(out, JSON.stringify({ words }));
  log(`${words.length} words aligned`);
  return { words };
}

/**
 * Attach to each sentence the alt-pass words spoken during it (matched by time on the tight timeline).
 * Two independent passes jitter by a few tenths of a second, so each window is shifted back by `tol`.
 */
export function attachAlt(sents, altWords, toOut, tol = 0.3) {
  return sents.map((x, i) => {
    const end = sents[i + 1]?.t ?? Infinity;
    const text = altWords.filter((w) => { const t = toOut(w.start); return t >= x.t - tol && t < end - tol; }).map((w) => w.w).join(' ');
    return text ? { ...x, alt: text } : x;
  });
}

/**
 * Which language is this transcript, judged by script? 'hi' when Devanagari dominates the letters, else 'en'.
 * (Only Devanagari is detected today; other scripts need an explicit language.)
 */
export function detectLanguage(words) {
  const txt = words.map((w) => w.w).join(' ');
  const dev = (txt.match(/\p{Script=Devanagari}/gu) ?? []).length, lat = (txt.match(/\p{Script=Latin}/gu) ?? []).length;
  return dev + lat > 0 && dev / (dev + lat) >= 0.4 ? 'hi' : 'en';
}

/** Cut dead air: keep speech segments (+pad), drop gaps > maxGap. Returns segments + src→out time map. */
export function planCuts(words, duration, { maxGap = 0.4, padIn = 0.1, padOut = 0.16 } = {}) {
  const segs = [];
  for (const w of words) {
    const s = Math.max(0, w.start - padIn), e = Math.min(duration, w.end + padOut);
    const last = segs[segs.length - 1];
    if (last && s - last.end <= maxGap) last.end = Math.max(last.end, e);
    else segs.push({ start: s, end: e });
  }
  let acc = 0;
  for (const s of segs) { s.out = acc; acc += s.end - s.start; }
  const toOut = (t) => {
    for (const s of segs) if (t <= s.end) return s.out + Math.max(0, t - s.start);
    return acc;
  };
  return { segs, total: acc, toOut, saved: duration - acc };
}

export async function tighten(video, segs, outFile, log, signal) {
  const parts = segs.map((s, i) => {
    const d = s.end - s.start;
    return `[0:v]trim=${s.start.toFixed(3)}:${s.end.toFixed(3)},setpts=PTS-STARTPTS[v${i}];` +
      `[0:a]atrim=${s.start.toFixed(3)}:${s.end.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:d=0.01,afade=t=out:st=${Math.max(0, d - 0.01).toFixed(3)}:d=0.01[a${i}]`;
  });
  const cat = segs.map((_, i) => `[v${i}][a${i}]`).join('') + `concat=n=${segs.length}:v=1:a=1[v][a]`;
  const fg = path.join(path.dirname(outFile), 'tighten.filter');
  fs.writeFileSync(fg, parts.join(';') + ';' + cat);
  log(`${segs.length} segments → ffmpeg…`);
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-filter_complex_script', fg, '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-crf', '15', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', '-fps_mode', 'cfr', outFile], { signal });
}

/**
 * Sentences on the TIGHT timeline, numbered from 1 — compact context for the director (cheap in tokens) and the
 * language-independent anchor system ("#3" = start of sentence 3).
 * Boundaries: . ? ! । (danda) and pauses > 0.7 s. Many transcripts (e.g. Edits' Hindi) carry NO punctuation, so any chunk
 * longer than `maxWords` words or `maxSeconds` seconds is split again at its largest internal pause — otherwise a whole
 * video becomes one "sentence" and every card collapses onto "#1".
 * Deterministic: direction and resolve both call this on the same transcript and get the same numbering.
 */
export function sentences(words, toOut, { maxWords = 14, maxSeconds = 6 } = {}) {
  const chunks = []; let cur = [];
  words.forEach((w, i) => { cur.push(w); const gap = words[i + 1] ? words[i + 1].start - w.end : 9; if (/[.?!।]$/.test(w.w) || gap > 0.7) { chunks.push(cur); cur = []; } });
  if (cur.length) chunks.push(cur);

  const split = (c) => {
    const tooLong = c.length > maxWords || c[c.length - 1].end - c[0].start > maxSeconds;
    if (!tooLong || c.length < 6) return [c];
    const mid = c.length / 2; let k = -1, best = -1;
    for (let i = 3; i <= c.length - 3; i++) { // keep ≥3 words on each side
      const gap = c[i].start - c[i - 1].end;
      if (gap > best + 1e-9 || (Math.abs(gap - best) <= 1e-9 && Math.abs(i - mid) < Math.abs(k - mid))) { best = gap; k = i; }
    }
    return k < 0 ? [c] : [...split(c.slice(0, k)), ...split(c.slice(k))];
  };
  return chunks.flatMap(split).map((c, i) => ({ n: i + 1, t: toOut(c[0].start), text: c.map((w) => w.w).join(' ') }));
}

const lcs = (a, b) => {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return dp[a.length][b.length];
};

/**
 * Where is the anchor phrase actually spoken? Longest-common-subsequence of anchor tokens vs. a sliding window, so one
 * mis-heard/missing word doesn't break the match. A window must START on a word of the anchor (never on junk before it).
 * Earliest best window wins; returns -1 if under 60% of the anchor matched.
 */
export function findAnchor(words, anchor, from = 0) {
  const a = anchor.split(/\s+/).map(norm).filter(Boolean);
  if (!a.length) return -1;
  const set = new Set(a);
  const ws = words.map((w) => norm(w.w));
  let best = -1, bestScore = 0;
  for (let i = from; i < ws.length; i++) {
    if (!set.has(ws[i])) continue;
    const score = lcs(a, ws.slice(i, i + a.length + 3));
    if (score > bestScore) { bestScore = score; best = i; if (score === a.length) break; }
  }
  return bestScore >= Math.max(1, Math.ceil(a.length * 0.6)) ? best : -1;
}

/** Compile the director's anchors into absolute tight-timeline seconds → the Edit Decision List. */
export function buildEdl(direction, words, cuts, log, sents = null, language = 'en') {
  const bySentence = sents ? new Map(sents.map((x) => [x.n, x.t])) : null;
  const at = (anchor, from) => {
    const m = /^\s*#(\d+)\s*$/.exec(anchor ?? '');
    if (m) return bySentence?.has(+m[1]) ? { i: -1, t: bySentence.get(+m[1]) } : null; // language-independent sentence anchor
    const i = findAnchor(words, anchor, from);
    return i < 0 ? null : { i, t: cuts.toOut(words[i].start) };
  };
  let prevEnd = 0;
  const scenes = [];
  for (const s of [...direction.scenes]) {
    const hit = at(s.anchor, 0) ; // scenes are placed independently (the director may reorder)
    if (!hit) { log(`⚠️ anchor not found, scene dropped: "${s.anchor}"`); continue; }
    scenes.push({ ...s, t: hit.t });
  }
  scenes.sort((a, b) => a.t - b.t);
  const edl = { duration: cuts.total, language, scenes: [], zooms: [], sfx: [] };
  scenes.forEach((s, idx) => {
    // opening Hook lands on the very first frames (silent-test: premise readable with sound off)
    const start = idx === 0 && s.kind === 'Hook' && s.t < 1.5 ? 0.1 : Math.max(prevEnd + 0.45, s.t - 0.08);
    const nextT = scenes[idx + 1]?.t ?? cuts.total;
    const dur = Math.min(s.dur, nextT - 0.45 - start, cuts.total - start);
    if (dur < 1.2) { log(`⚠️ no room for ${s.id} (${dur.toFixed(1)}s) — dropped`); return; }
    edl.scenes.push({ id: `s${edl.scenes.length + 1}`, was: s.id, anchor: s.anchor, start: +start.toFixed(2), dur: +dur.toFixed(2), kind: s.kind, props: s.props, tin: s.transition_in, tout: s.transition_out });
    prevEnd = start + dur;
  });
  // Zooms live only in talking-head gaps between cards. Snap to the nearest gap that fits, else drop.
  const gaps = []; let cursor = 0;
  for (const c of edl.scenes) { gaps.push([cursor + 0.2, c.start - 0.2]); cursor = c.start + c.dur; }
  gaps.push([cursor + 0.2, cuts.total - 0.2]);
  const usedZoom = [];
  for (const z of direction.zooms ?? []) {
    const h = at(z.anchor, 0); if (!h) continue;
    let best = null;
    for (const [g0, g1] of gaps) {
      if (g1 - g0 < z.dur) continue;
      const start = Math.min(Math.max(h.t, g0), g1 - z.dur);
      const dist = Math.abs(start - h.t);
      if (usedZoom.every((u) => Math.abs(start - u) >= 6) && (!best || dist < best.dist)) best = { start, dist };
    }
    if (!best || best.dist > 4) { log(`⚠️ zoom "${z.anchor}": no free talking-head gap nearby — dropped`); continue; }
    usedZoom.push(best.start);
    edl.zooms.push({ start: +best.start.toFixed(2), dur: z.dur, scale: z.scale });
  }
  for (const x of direction.sfx ?? []) {
    const ref = x.on_scene ? edl.scenes.find((s) => s.was === x.on_scene) : null;
    const h = ref ? { t: x.edge === 'out' ? ref.start + ref.dur : ref.start } : at(x.anchor ?? '', 0);
    if (!h) continue;
    edl.sfx.push({ at: +Math.max(0, h.t + (x.offset ?? -0.05)).toFixed(2), name: x.name, volume: x.volume });
  }
  edl.sfx.sort((a, b) => a.at - b.at);
  // never stack sfx closer than 0.8s
  edl.sfx = edl.sfx.filter((s, i, a) => i === 0 || s.at - a[i - 1].at >= 0.8);
  edl.zooms.sort((a, b) => a.start - b.start);
  edl.captions = direction.captions; edl.music = direction.music; edl.grade = direction.grade; edl.audio = direction.audio;
  return edl;
}

export const probe = (file) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=width,height,codec_type', '-of', 'json', file], { encoding: 'utf8' }));
