// Usage: node render.mjs <outDir>   — renders every composition in src/Scenes.tsx to <outDir>/<id>.mp4
// Bundles ONCE, then renders each scene. Emits one JSON line per event for the dashboard.
import {bundle} from '@remotion/bundler';
import {getCompositions, renderMedia, selectComposition} from '@remotion/renderer';
import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(process.argv[2]);
// Optional 3rd arg: assets.json (real GitHub/site data) → inputProps.assets, read inside the Repo/Site cards.
const inputProps = process.argv[3] && fs.existsSync(process.argv[3]) ? {assets: JSON.parse(fs.readFileSync(process.argv[3], 'utf8'))} : {};
fs.mkdirSync(outDir, {recursive: true});
const emit = (o) => console.log(JSON.stringify(o));

const serveUrl = await bundle({entryPoint: path.join(here, 'src/index.ts')});
// Ask the bundle what it contains — no id-guessing convention.
const ids = (await getCompositions(serveUrl)).map((c) => c.id).sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));
if (!ids.length) throw new Error('no compositions found in src/Scenes.tsx');

for (const id of ids) {
  const comp = await selectComposition({serveUrl, id, inputProps});
  const outputLocation = path.join(outDir, `${id}.mp4`);
  if (fs.existsSync(outputLocation)) { emit({id, skipped: true}); continue; }
  let last = -1;
  await renderMedia({
    composition: comp, serveUrl, inputProps, codec: 'h264', outputLocation, crf: 18,
    concurrency: '50%', muted: true,
    onProgress: ({progress}) => { const pct = Math.floor(progress * 4) * 25; if (pct !== last) { last = pct; emit({id, progress: pct}); } },
  });
  emit({id, done: true});
}
emit({finished: true});
