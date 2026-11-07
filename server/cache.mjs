// Content-addressed cache shared by ALL jobs: identical inputs → reuse the previous result instead of recomputing
// (no tokens, no cloud transcription, no re-render). Keys are hashes of everything that affects the output, so a
// change anywhere (a card, a term, the video) misses the cache exactly where it should and nowhere else.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.mjs';

export const CACHE_VERSION = 'v1'; // bump to invalidate everything after a change in how outputs are produced

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Stable hash of any JSON-able value (object keys sorted, so key order never matters). */
export function keyOf(...parts) {
  const norm = (v) => (Array.isArray(v) ? v.map(norm) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])])) : v);
  return sha(JSON.stringify([CACHE_VERSION, ...parts.map(norm)])).slice(0, 32);
}

/** Hash of a file's CONTENT, memoised by path+size+mtime (re-hashing a 50 MB video every step would be wasteful). */
const memo = new Map();
export function fileKey(file) {
  const st = fs.statSync(file);
  const k = `${path.resolve(file)}:${st.size}:${st.mtimeMs}`;
  if (!memo.has(k)) memo.set(k, sha(fs.readFileSync(file)).slice(0, 32));
  return memo.get(k);
}

/** Hash of every file under a directory tree (e.g. the Remotion sources), filtered by extension. */
export function treeKey(dir, exts = ['.ts', '.tsx', '.mjs', '.json']) {
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === 'node_modules' || e.name.startsWith('.')) continue; const p = path.join(d, e.name); e.isDirectory() ? walk(p) : exts.includes(path.extname(e.name)) && files.push(p); } };
  walk(dir);
  return keyOf(files.sort().map((f) => [path.relative(dir, f), fileKey(f)]));
}

const dirFor = (bucket) => { const d = path.join(config.cacheDir, bucket); fs.mkdirSync(d, { recursive: true }); return d; };

/** Path for a cached artefact (may not exist yet). */
export const cachePath = (bucket, key, ext) => path.join(dirFor(bucket), `${key}${ext}`);

/** Cached JSON value, or null. */
export function getJson(bucket, key) {
  if (!config.cacheEnabled()) return null;
  const f = cachePath(bucket, key, '.json');
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}
export function putJson(bucket, key, value) {
  if (!config.cacheEnabled()) return value;
  const f = cachePath(bucket, key, '.json');
  fs.writeFileSync(`${f}.tmp`, JSON.stringify(value)); fs.renameSync(`${f}.tmp`, f); // atomic: never a half-written entry
  return value;
}

/** Put a file into the job folder from the cache: hard link (no extra disk), else copy. Returns true on a hit. */
export function restoreFile(bucket, key, ext, dest) {
  if (!config.cacheEnabled()) return false;
  const src = cachePath(bucket, key, ext);
  if (!fs.existsSync(src)) return false;
  fs.rmSync(dest, { force: true });
  try { fs.linkSync(src, dest); } catch { fs.copyFileSync(src, dest); }
  fs.utimesSync(src, new Date(), fs.statSync(src).mtime); // touch atime for LRU
  return true;
}
/** Store a produced file in the cache (hard link when possible). */
export function storeFile(bucket, key, ext, src) {
  if (!config.cacheEnabled()) return null;
  const dest = cachePath(bucket, key, ext);
  fs.rmSync(dest, { force: true });
  try { fs.linkSync(src, dest); } catch { fs.copyFileSync(src, dest); }
  return dest;
}

/** Keep a bucket under `maxBytes` by deleting the least recently used files (big renders only). */
export function prune(bucket, maxBytes) {
  const d = dirFor(bucket);
  const files = fs.readdirSync(d).map((n) => { const p = path.join(d, n); const s = fs.statSync(p); return { p, size: s.size, used: s.atimeMs }; }).sort((a, b) => b.used - a.used);
  let total = 0;
  for (const f of files) { total += f.size; if (total > maxBytes) fs.rmSync(f.p, { force: true }); }
}
