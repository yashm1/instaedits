// Usage: node track.mjs <reel.json> <out.json>
// Per-frame speaker placement {y, zoom} computed by the SAME functions Reel.tsx uses (src/geometry.ts), so the ffmpeg
// compositor moves the untouched speaker pixels exactly in step with the rendered graphics.
import fs from 'node:fs';
import {speakerTrack} from './src/geometry.ts';

const [propsFile, out] = process.argv.slice(2);
const p = JSON.parse(fs.readFileSync(propsFile, 'utf8'));
const fps = 30, frames = Math.max(1, Math.round(p.duration * fps));
fs.writeFileSync(out, JSON.stringify({fps, frames, track: speakerTrack(p.scenes, p.zooms ?? [], fps, frames)}));
console.log(JSON.stringify({frames}));
