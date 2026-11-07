// "Watch it before publishing": objective checks that compare the exported video with the rendered picture, plus a
// contact sheet (one frame per card) that a vision model reviews against what is being said at that moment.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const pexec = promisify(execFile);

export const QA = { minColourRatio: 0.6, minCardSimilarity: 0.55, maxDurationDrift: 0.6 };

const frame = (file, t, out, vf = 'scale=360:-1') => pexec('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', vf, out]);
async function saturation(png) {
  const { stderr } = await pexec('ffmpeg', ['-i', png, '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.SATAVG', '-f', 'null', '-'], { maxBuffer: 1 << 22 }).catch((e) => e);
  return parseFloat(String(stderr).match(/SATAVG=([\d.]+)/)?.[1] ?? 'NaN');
}
async function ssim(a, b) {
  const { stderr } = await pexec('ffmpeg', ['-i', a, '-i', b, '-lavfi', 'ssim', '-f', 'null', '-'], { maxBuffer: 1 << 22 }).catch((e) => e);
  return parseFloat(String(stderr).match(/All:([\d.]+)/)?.[1] ?? 'NaN');
}
const duration = async (f) => parseFloat((await pexec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f])).stdout);

/** Pure verdict from measurements — unit-tested. */
export function judge({ finalDur, reelDur, satFinal, satReel, cards }) {
  const problems = [];
  if (!(Math.abs(finalDur - reelDur) <= QA.maxDurationDrift)) problems.push(`duration ${finalDur?.toFixed?.(2)}s ≠ ${reelDur?.toFixed?.(2)}s`);
  const ratio = satReel > 1 ? satFinal / satReel : 1;
  if (!(ratio >= QA.minColourRatio)) problems.push(`colour lost: saturation ${satFinal.toFixed(1)} vs ${satReel.toFixed(1)} in the render (black & white?)`);
  for (const c of cards) if (!(c.similarity >= QA.minCardSimilarity)) problems.push(`card ${c.id} (${c.kind} @${c.t}s) is not on screen in the export (similarity ${c.similarity.toFixed(2)})`);
  return { ok: !problems.length, problems, colourRatio: +ratio.toFixed(2) };
}

/**
 * Compare final.mp4 against reel.mp4: duration, colour, and every card at its midpoint (top 44% of the frame — above the
 * captions on the seam). Writes qa/contact.jpg. Returns { ok, problems, frames:[{t, file, label}] }.
 */
export async function checkExport({ final, reel, scenes, dir }) {
  const qd = path.join(dir, 'qa'); fs.rmSync(qd, { recursive: true, force: true }); fs.mkdirSync(qd, { recursive: true });
  const [finalDur, reelDur] = [await duration(final), await duration(reel)];
  const probes = [0.25, 0.5, 0.75].map((k) => +(reelDur * k).toFixed(2));
  let sf = 0, sr = 0;
  for (const [i, t] of probes.entries()) {
    await frame(final, t, path.join(qd, `sf${i}.png`)); await frame(reel, t, path.join(qd, `sr${i}.png`));
    sf += await saturation(path.join(qd, `sf${i}.png`)); sr += await saturation(path.join(qd, `sr${i}.png`));
  }
  const cards = [], frames = [];
  const crop = 'crop=iw:ih*0.44:0:0,scale=360:-1';
  for (const s of scenes) {
    const t = +(s.start + Math.min(s.dur * 0.6, s.dur - 0.3)).toFixed(2);
    const a = path.join(qd, `${s.id}-final.png`), b = path.join(qd, `${s.id}-reel.png`);
    await frame(final, t, a, crop); await frame(reel, t, b, crop);
    cards.push({ id: s.id, kind: s.kind, t, similarity: await ssim(a, b) });
    const full = path.join(qd, `${s.id}.jpg`); await frame(final, t, full, 'scale=540:-1'); frames.push({ t, file: full, label: `${s.id} ${s.kind}` }); // 540px: big enough to judge phone legibility fairly
  }
  if (frames.length === 1) fs.copyFileSync(frames[0].file, path.join(qd, 'contact.jpg'));
  else if (frames.length > 1) {
    const inputs = frames.flatMap((f) => ['-i', f.file]);
    await pexec('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', `${frames.map((_, i) => `[${i}]`).join('')}hstack=${frames.length}`, path.join(qd, 'contact.jpg')]).catch(() => {});
  }
  return { ...judge({ finalDur, reelDur, satFinal: sf / probes.length, satReel: sr / probes.length, cards }), cards, frames, contact: path.join(qd, 'contact.jpg') };
}
