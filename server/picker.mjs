// "Browse…" for the dashboard: the native macOS file picker. A browser <input type="file"> can't give the server a real
// path (the video stays where it is and is hard-linked for Edits), so the local server opens the picker itself.
// Reached only via POST (Origin + JSON checks in security.mjs), so a web page can't pop dialogs on your Mac.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validateVideoPath } from './security.mjs';
import { probe } from './media.mjs';

const pexec = promisify(execFile);
let lastDir = null; // start where the creator picked from last time

/** AppleScript for a movie-file picker that comes to the front, starting in `dir`. Exported for tests. */
export function pickerScript(dir) {
  const start = dir && fs.existsSync(dir) ? `default location (POSIX file ${JSON.stringify(dir)})` : 'default location (path to downloads folder)';
  // plain `activate` brings osascript's own dialog to the front — no "control System Events" permission prompt needed
  return [
    'activate',
    `set f to choose file with prompt "Choose your talking-head video" of type {"public.movie"} ${start}`,
    'POSIX path of f',
  ].join('\n');
}

/**
 * Open the picker. → { path, name, duration, resolution } | { cancelled: true }. Throws for an unusable file.
 * `run` is injectable for tests.
 */
export async function pickVideo({ run = (script) => pexec('osascript', ['-e', script], { timeout: 5 * 60_000 }) } = {}) {
  let out;
  try { out = (await run(pickerScript(lastDir))).stdout.trim(); } catch (e) {
    if (/-128|User cancel/i.test(String(e.stderr ?? e.message))) return { cancelled: true };
    throw new Error(`could not open the file picker: ${String(e.stderr ?? e.message).trim().slice(0, 120)}`);
  }
  const file = validateVideoPath(out); // same checks as a typed path: absolute, video extension, exists, regular file
  lastDir = path.dirname(file);
  let duration = null, resolution = null;
  try {
    const info = probe(file);
    duration = +parseFloat(info.format.duration).toFixed(1);
    const v = info.streams.find((x) => x.codec_type === 'video'); resolution = v ? `${v.width}x${v.height}` : null;
  } catch { /* the run will report a bad file properly */ }
  return { path: file, name: path.basename(file), duration, resolution, home: file.startsWith(os.homedir()) };
}
