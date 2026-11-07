// Usage: node render.mjs <reel.json> <publicDir> <out.mp4>
//        node render.mjs <reel.json> <publicDir> <outDir> --stills 1.5,6.2,…   (PNG frames at those seconds: previews / QA)
// Renders the whole reel (speaker video + cards, split layout) in one pass. <publicDir> is the job folder: the video and
// screenshots referenced by reel.json are resolved inside it (staticFile). Emits one JSON line per event for the dashboard.
import {bundle} from '@remotion/bundler';
import {renderMedia, renderStill, selectComposition} from '@remotion/renderer';
import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [propsFile, publicDir, out] = process.argv.slice(2);
const inputProps = JSON.parse(fs.readFileSync(propsFile, 'utf8'));
const emit = (o) => console.log(JSON.stringify(o));

const serveUrl = await bundle({entryPoint: path.join(here, 'src/index.ts'), publicDir: path.resolve(publicDir)});
const composition = await selectComposition({serveUrl, id: 'reel', inputProps});
const si = process.argv.indexOf('--stills');
if (si > 0) {
  fs.mkdirSync(out, {recursive: true});
  for (const t of process.argv[si + 1].split(',').map(Number)) {
    const frame = Math.min(composition.durationInFrames - 1, Math.max(0, Math.round(t * composition.fps)));
    const file = path.join(out, `still-${t.toFixed(2)}.png`);
    await renderStill({composition, serveUrl, inputProps, frame, output: file});
    emit({still: file, t});
  }
  emit({finished: true});
  process.exit(0);
}
let last = -1;
// overlayOnly: lossless ProRes 4444 WITH ALPHA (graphics only) — the speaker is composited by ffmpeg from the original file.
// Otherwise (previews): h264. Remotion's own H.264 encode shifts colour by a few levels, so it is never the deliverable.
const enc = inputProps.overlayOnly
  ? {codec: 'prores', proResProfile: '4444', imageFormat: 'png', pixelFormat: 'yuva444p10le', muted: true}
  : {codec: 'h264', crf: 16, x264Preset: 'slow', pixelFormat: 'yuv420p', colorSpace: 'bt709', audioCodec: 'aac', audioBitrate: '256k'};
await renderMedia({
  composition, serveUrl, inputProps, outputLocation: path.resolve(out), ...enc, concurrency: '50%',
  onProgress: ({progress}) => { const pct = Math.floor(progress * 10) * 10; if (pct !== last) { last = pct; emit({progress: pct}); } },
});
emit({finished: true, out: path.resolve(out)});
