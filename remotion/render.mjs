// Usage: node render.mjs <outDir>   — renders every composition in src/Scenes.tsx to <outDir>/<id>.mp4
// Bundles ONCE, then renders each scene. Emits one JSON line per event for the dashboard.
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(process.argv[2]);
fs.mkdirSync(outDir, {recursive: true});
const emit = (o) => console.log(JSON.stringify(o));

const serveUrl = await bundle({entryPoint: path.join(here, 'src/index.ts')});
const probe = await selectComposition({serveUrl, id: 's1'}).catch(() => null);
if (!probe) throw new Error('composition s1 not found');

// Discover ids by asking the bundle for the scene list via env-free convention: s1..s40.
for (let i = 1; i <= 40; i++) {
  const id = `s${i}`;
  let comp;
  try { comp = await selectComposition({serveUrl, id}); } catch { break; }
  const outputLocation = path.join(outDir, `${id}.mp4`);
  if (fs.existsSync(outputLocation)) { emit({id, skipped: true}); continue; }
  await renderMedia({
    composition: comp, serveUrl, codec: 'h264', outputLocation, crf: 18,
    concurrency: '50%', muted: true,
    onProgress: ({progress}) => { if (Math.round(progress * 100) % 25 === 0) emit({id, progress: Math.round(progress * 100)}); },
  });
  emit({id, done: true});
}
emit({finished: true});
