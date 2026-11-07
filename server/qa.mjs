// "Watch it before publishing": objective checks that compare the exported video with the rendered picture, plus a
// contact sheet (one frame per card) that a vision model reviews against what is being said at that moment.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const pexec = promisify(execFile);

export const QA = { minColourRatio: 0.6, minCardSimilarity: 0.55, maxDurationDrift: 0.6, maxColourDrift: 2.5 };

const frame = (file, t, out, vf = 'scale=360:-1') => pexec('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', vf, out]);
async function saturation(png) {
  const { stderr } = await pexec('ffmpeg', ['-i', png, '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.SATAVG', '-f', 'null', '-'], { maxBuffer: 1 << 22 }).catch((e) => e);
  return parseFloat(String(stderr).match(/SATAVG=([\d.]+)/)?.[1] ?? 'NaN');
}
async function ssim(a, b) {
  const { stderr } = await pexec('ffmpeg', ['-i', a, '-i', b, '-lavfi', 'ssim', '-f', 'null', '-'], { maxBuffer: 1 << 22 }).catch((e) => e);
  return parseFloat(String(stderr).match(/All:([\d.]+)/)?.[1] ?? 'NaN');
}
/** Mean R,G,B (0-255) of the top 1200 px (above captions) over [t, t+d]. Both inputs are scaled to 1080x1920 first. */
async function meanRGB(file, t, d) {
  const { stdout } = await pexec('ffmpeg', ['-loglevel', 'error', '-ss', String(t), '-t', String(d), '-i', file, '-vf', 'scale=1080:1920,crop=1080:1200:0:0,scale=1:1:flags=area,format=rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer', maxBuffer: 1 << 24 });
  const n = Math.floor(stdout.length / 3); const sum = [0, 0, 0];
  for (let i = 0; i < n * 3; i++) sum[i % 3] += stdout[i];
  return sum.map((x) => x / n);
}

/** Stretches (≥ minFrames) where the speaker is full-frame and untouched (no split, no zoom): the colour must equal the original's there. */
export function cleanWindows(track, { fps = 30, minFrames = 30, max = 3 } = {}) {
  const runs = []; let a = -1;
  track.forEach((p, i) => {
    const clean = p.y === 0 && p.zoom === 1;
    if (clean && a < 0) a = i;
    if ((!clean || i === track.length - 1) && a >= 0) { const b = clean ? i : i - 1; if (b - a + 1 >= minFrames) runs.push([a, b]); a = -1; }
  });
  return runs.sort((x, y) => (y[1] - y[0]) - (x[1] - x[0])).slice(0, max)
    .map(([a, b]) => { const mid = (a + b) / 2 / fps; return { t: +Math.max(0, mid - 0.5).toFixed(2), d: 1 }; });
}

const duration = async (f) => parseFloat((await pexec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f])).stdout);

/** Pure verdict from measurements — unit-tested. */
export function judge({ finalDur, reelDur, satFinal, satReel, cards, fidelity = null }) {
  const problems = [];
  if (fidelity && !(fidelity.maxDrift <= QA.maxColourDrift)) problems.push(`colour differs from your original by ${fidelity.maxDrift} levels (max ${QA.maxColourDrift}) — the speaker's colour must stay the camera's`);
  if (!(Math.abs(finalDur - reelDur) <= QA.maxDurationDrift)) problems.push(`duration ${finalDur?.toFixed?.(2)}s ≠ ${reelDur?.toFixed?.(2)}s (the tightened original)`);
  const ratio = satReel > 1 ? satFinal / satReel : 1;
  if (!(ratio >= QA.minColourRatio)) problems.push(`colour lost: speaker saturation ${satFinal.toFixed(1)} vs ${satReel.toFixed(1)} in your original (black & white?)`);
  for (const c of cards) if (!(c.similarity >= QA.minCardSimilarity)) problems.push(`card ${c.id} (${c.kind} @${c.t}s) is not on screen in the final reel (similarity ${c.similarity.toFixed(2)})`);
  return { ok: !problems.length, problems, colourRatio: +ratio.toFixed(2) };
}

/**
 * Check the final reel: length vs the original, the speaker's colour vs the ORIGINAL camera footage, a black-and-white
 * guard on the speaker area, and every card actually on screen at its time (vs the graphics layer). Writes qa/contact.jpg.
 */
export async function checkExport({ final, overlay = null, scenes, dir, original, track = null }) {
  const qd = path.join(dir, 'qa'); fs.rmSync(qd, { recursive: true, force: true }); fs.mkdirSync(qd, { recursive: true });
  const [finalDur, reelDur] = await Promise.all([duration(final), duration(original)]);
  // speaker area (bottom strip, below the captions) — present in both layouts
  const probes = [0.25, 0.5, 0.75].map((k) => +(reelDur * k).toFixed(2));
  const strip = 'scale=1080:1920,crop=1080:380:0:1500';
  const sats = await Promise.all(probes.flatMap((t, i) => [[final, 'sf'], [original, 'sr']].map(async ([file, p]) => {
    const png = path.join(qd, `${p}${i}.png`); await frame(file, t, png, strip); return [p, await saturation(png)];
  })));
  const sf = sats.filter(([p]) => p === 'sf').reduce((a, [, v]) => a + v, 0), sr = sats.filter(([p]) => p === 'sr').reduce((a, [, v]) => a + v, 0);
  // the card panel region vs the graphics layer flattened on black: proves the composite put each card at its time
  const crop = 'crop=iw:ih*0.44:0:0,scale=360:-1';
  // every card at its midpoint — plus the FIRST FRAME when the reel opens on the hook (the frame Instagram shows first)
  const checks = scenes.map((s) => ({ id: s.id, kind: s.kind, t: +(s.start + Math.min(s.dur * 0.6, s.dur - 0.3)).toFixed(2), sheet: true }));
  if (scenes[0]?.start === 0) checks.unshift({ id: 'first-frame', kind: scenes[0].kind, t: 0, sheet: false });
  const results = await Promise.all(checks.map(async (c) => {
    const a = path.join(qd, `${c.id}-final.png`), b = path.join(qd, `${c.id}-gfx.png`);
    await frame(final, c.t, a, crop);
    // canvas derived from the overlay stream itself (frame-locked; a separate lavfi canvas starts a frame early → black)
    if (overlay) await pexec('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(c.t), '-i', overlay, '-filter_complex', `[0]split[x][y];[y]format=yuv444p,drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill[bg];[bg][x]overlay,${crop}`, '-frames:v', '1', b]);
    const full = path.join(qd, `${c.id}.jpg`);
    if (c.sheet) await frame(final, c.t, full, 'scale=540:-1'); // 540px: big enough to judge phone legibility fairly
    return { card: { id: c.id, kind: c.kind, t: c.t, similarity: overlay ? await ssim(a, b) : 1 }, frame: c.sheet ? { t: c.t, file: full, label: `${c.id} ${c.kind}` } : null };
  }));
  const cards = results.map((r) => r.card), frames = results.map((r) => r.frame).filter(Boolean);
  if (frames.length === 1) fs.copyFileSync(frames[0].file, path.join(qd, 'contact.jpg'));
  else if (frames.length > 1) {
    const inputs = frames.flatMap((f) => ['-i', f.file]);
    await pexec('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', `${frames.map((_, i) => `[${i}]`).join('')}hstack=${frames.length}`, path.join(qd, 'contact.jpg')]).catch(() => {});
  }
  // colour fidelity: the export vs the ORIGINAL camera footage where the speaker is full-frame and untouched
  let fidelity = null;
  if (original && track?.length) {
    const wins = cleanWindows(track);
    if (wins.length) {
      const samples = await Promise.all(wins.map(async (w) => {
        const [a, b] = await Promise.all([meanRGB(final, w.t, w.d), meanRGB(original, w.t, w.d)]);
        return { t: w.t, drift: Math.max(...a.map((x, i) => Math.abs(x - b[i]))), final: a.map((x) => +x.toFixed(1)), original: b.map((x) => +x.toFixed(1)) };
      }));
      const maxDrift = Math.max(...samples.map((x) => x.drift));
      fidelity = { maxDrift: +maxDrift.toFixed(2), samples };
    }
  }
  return { ...judge({ finalDur, reelDur, satFinal: sf / probes.length, satReel: sr / probes.length, cards, fidelity }), fidelity, cards, frames, contact: path.join(qd, 'contact.jpg') };
}
