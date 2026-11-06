// Local, token-free media work: Edits transcription, silence tightening, anchor → time resolution.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { tool as editsTool } from './edits-mcp.mjs';

const norm = (w) => w.toLowerCase().replace(/[^a-z0-9]/g, '');

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
 * Word timestamps from the Edits app's own captions model (default): zero LLM tokens, nothing extra to install.
 */
export async function transcribe(video, dir, log) {
  const out = path.join(dir, 'transcript.json');
  if (fs.existsSync(out)) { log('♻️ transcript cached'); return JSON.parse(fs.readFileSync(out, 'utf8')); }
  log('Edits app: new project + import…');
  await editsTool('newProject');
  const imp = await editsTool('importMedia', { path: video });
  const id = imp?.id ?? imp?.itemId ?? imp?.clipId ?? imp?.items?.[0]?.id ?? imp?.item?.id;
  if (!id) throw new Error('importMedia returned no id: ' + JSON.stringify(imp).slice(0, 200));
  log('Edits app: transcribing…');
  const tr = await editsTool('transcribeClip', { id, language: 'en', mergeSplitWords: true });
  const words = extractWords(tr.words ?? tr);
  if (!words.length) throw new Error('no words in transcript');
  fs.writeFileSync(out, JSON.stringify({ words }));
  log(`${words.length} words aligned`);
  return { words };
}

/** Cut dead air: keep speech segments (+pad), drop gaps > maxGap. Returns segments + src→out time map. */
export function planCuts(words, duration, { maxGap = 0.5, padIn = 0.1, padOut = 0.16 } = {}) {
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

/** Sentences on the TIGHT timeline — compact context for the director (cheap in tokens). */
export function sentences(words, toOut) {
  const out = []; let cur = [];
  const flush = () => { if (cur.length) { out.push({ t: toOut(cur[0].start), text: cur.map((w) => w.w).join(' ') }); cur = []; } };
  words.forEach((w, i) => { cur.push(w); const gap = words[i + 1] ? words[i + 1].start - w.end : 9; if (/[.?!]$/.test(w.w) || gap > 0.7) flush(); });
  flush();
  return out;
}

/** Find where an anchor phrase is actually spoken (best in-order token overlap, earliest wins ties). -1 if weak. */
export function findAnchor(words, anchor, from = 0) {
  const a = anchor.split(/\s+/).map(norm).filter(Boolean);
  if (!a.length) return -1;
  const ws = words.map((w) => norm(w.w));
  let best = -1, bestScore = 0;
  for (let i = from; i < ws.length; i++) {
    let score = 0, k = 0;
    for (let j = i; j < Math.min(ws.length, i + a.length + 3) && k < a.length; j++) if (ws[j] === a[k]) { score++; k++; }
    if (score > bestScore) { bestScore = score; best = i; if (score === a.length) break; }
  }
  return bestScore >= Math.max(1, Math.ceil(a.length * 0.6)) ? best : -1;
}

/** Compile the director's anchors into absolute tight-timeline seconds → the Edit Decision List. */
export function buildEdl(direction, words, cuts, log) {
  const at = (anchor, from) => { const i = findAnchor(words, anchor, from); return i < 0 ? null : { i, t: cuts.toOut(words[i].start) }; };
  let prevEnd = 0;
  const scenes = [];
  for (const s of [...direction.scenes]) {
    const hit = at(s.anchor, 0) ; // scenes are placed independently (the director may reorder)
    if (!hit) { log(`⚠️ anchor not found, scene dropped: "${s.anchor}"`); continue; }
    scenes.push({ ...s, t: hit.t });
  }
  scenes.sort((a, b) => a.t - b.t);
  const edl = { duration: cuts.total, scenes: [], zooms: [], sfx: [] };
  scenes.forEach((s, idx) => {
    const start = Math.max(prevEnd + 0.45, s.t - 0.08);
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
