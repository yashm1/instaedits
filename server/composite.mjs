// Composite the final picture WITHOUT touching the speaker's colour: the original (tightened) camera pixels are only
// moved (split-screen shift) and scaled (punch-in) by ffmpeg, then the Remotion graphics (ProRes 4444 with alpha) go on
// top. Rendering the speaker through Chrome/Remotion re-encodes it and shifted colour by 2-4 levels — this does not.
import fs from 'node:fs';
import path from 'node:path';

/**
 * ffmpeg expression for a per-frame value: run-length encoded `between(var,a,b)*v` terms (+ base), so a 30 s reel with a
 * dozen transitions is a few hundred terms. Values equal to `base` emit nothing.
 */
export function trackExpr(values, { variable = 'n', base = 0, digits = 3 } = {}) {
  const terms = [];
  for (let i = 0; i < values.length;) {
    let j = i; const v = +values[i].toFixed(digits);
    while (j + 1 < values.length && +values[j + 1].toFixed(digits) === v) j++;
    if (v !== base) terms.push(i === j ? `eq(${variable},${i})*${+(v - base).toFixed(digits)}` : `between(${variable},${i},${j})*${+(v - base).toFixed(digits)}`);
    i = j + 1;
  }
  return terms.length ? `${base}+${terms.join('+')}` : String(base);
}

/**
 * The filtergraph. Inputs: [0] tight.mp4 (speaker + voice), [1] overlay.mov (graphics + captions, alpha),
 * [2] optional: the Edits export, used ONLY for its audio (voice enhance + music + SFX). Output [v] 1080x1920 and [a].
 * - zoompan: punch-in around ZOOM_ORIGIN (geometry only; it also scales the camera frame to 1080x1920)
 * - overlay on a black canvas at y = track.y (the split shift), then the graphics on top
 * - the speaker stays in the camera's own pixel format (full-range BT.709) end to end — no colour matrix is applied to it
 */
export function filterGraph({ track, duration, fps = 30, origin = { x: 0.5, y: 0.34 }, width = 1080, height = 1920, audioInput = 0 }) {
  const z = trackExpr(track.map((t) => t.zoom), { variable: 'on', base: 1, digits: 4 });
  const y = trackExpr(track.map((t) => t.y), { variable: 'n', base: 0, digits: 1 });
  return [
    `color=c=black:s=${width}x${height}:r=${fps}:d=${duration.toFixed(3)},format=yuvj420p[bg]`,
    `[0:v]fps=${fps},zoompan=z='${z}':x='(iw-iw/zoom)*${origin.x}':y='(ih-ih/zoom)*${origin.y}':d=1:s=${width}x${height}:fps=${fps},format=yuvj420p[spk]`,
    `[bg][spk]overlay=x=0:y='${y}':eval=frame:shortest=1:format=auto[base]`,
    `[1:v]format=yuva444p10le[g]`,
    `[base][g]overlay=0:0:shortest=1:format=auto,format=yuvj420p[v]`,
    `[${audioInput}:a]atrim=0:${duration.toFixed(3)},asetpts=PTS-STARTPTS,loudnorm=I=-14:TP=-1.5:LRA=11[a]`, // exactly the reel's length (the Edits mix runs longer); Instagram's loudness
  ].join(';\n');
}

/** ffmpeg args: encode with the SAME colour description as the camera file (full range, BT.709 everywhere). */
export function compositeArgs({ tight, overlay, graphFile, out, audio = null }) {
  return ['-y', '-loglevel', 'error', '-i', tight, '-i', overlay, ...(audio ? ['-i', audio] : []), '-filter_complex_script', graphFile, '-map', '[v]', '-map', '[a]',
    // preset medium: measured 1.7× faster than slow at the same CRF, ~1% larger file
    '-c:v', 'libx264', '-crf', '14', '-preset', 'medium', '-pix_fmt', 'yuvj420p',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'pc',
    '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', out];
}

export function writeGraph(dir, opts) {
  const file = path.join(dir, 'composite.filter');
  fs.writeFileSync(file, filterGraph(opts));
  return file;
}
