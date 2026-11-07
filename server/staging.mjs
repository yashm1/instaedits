// The Edits app is macOS-sandboxed: it can only open/write files in folders it has access to (e.g. ~/Movies).
// Everything it must touch (source video, tight.mp4, rendered cards, the export) is staged under
// <stagingDir>/<jobId>/. Hard links make staging instant and free; falls back to a copy across volumes.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.mjs';
import { isSafeId } from './security.mjs';

export const stagingFor = (jobId, base = config.stagingDir) => {
  if (!isSafeId(jobId)) throw new Error('invalid job id');
  return path.join(base, jobId);
};

/** Link (or copy) `src` to `dest`. Idempotent: skips when dest is already the same file; replaces it when it is stale. */
export function stageFile(src, dest) {
  if (!fs.existsSync(src)) throw new Error(`cannot stage missing file: ${src}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) {
    const a = fs.statSync(src), b = fs.statSync(dest);
    if (a.ino === b.ino && a.dev === b.dev) return dest; // already the same file
    fs.rmSync(dest);
  }
  try { fs.linkSync(src, dest); } catch (e) {
    if (e.code !== 'EXDEV' && e.code !== 'EPERM' && e.code !== 'ENOTSUP') throw e;
    fs.copyFileSync(src, dest);
  }
  return dest;
}

/** Stage every .mp4 of a directory into destDir. Returns the staged dir. */
export function stageDir(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const n of fs.readdirSync(srcDir).filter((x) => x.endsWith('.mp4'))) stageFile(path.join(srcDir, n), path.join(destDir, n));
  // drop staged clips that no longer exist at the source (re-planned job)
  for (const n of fs.readdirSync(destDir).filter((x) => x.endsWith('.mp4'))) if (!fs.existsSync(path.join(srcDir, n))) fs.rmSync(path.join(destDir, n));
  return destDir;
}
