import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let tmp, C, cfg;
before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-c-'));
  process.env.INSTAEDITS_CACHE = 'on'; process.env.INSTAEDITS_CACHE_DIR = path.join(tmp, 'cache');
  C = await import('../server/cache.mjs'); cfg = (await import('../server/config.mjs')).config;
});
after(() => { fs.rmSync(tmp, { recursive: true, force: true }); process.env.INSTAEDITS_CACHE = 'off'; });

test('keyOf: stable, object-key-order independent, sensitive to any value change', () => {
  assert.equal(C.keyOf({ a: 1, b: [1, { y: 2, x: 1 }] }), C.keyOf({ b: [1, { x: 1, y: 2 }], a: 1 }));
  assert.notEqual(C.keyOf({ a: 1 }), C.keyOf({ a: 2 }));
  assert.notEqual(C.keyOf('x', [1, 2]), C.keyOf('x', [2, 1]), 'array order matters (card order, sfx order)');
});

test('fileKey is by CONTENT: same bytes under another name → same key; one byte changed → different', () => {
  const a = path.join(tmp, 'a.mp4'), b = path.join(tmp, 'b.mp4');
  fs.writeFileSync(a, 'video-bytes'); fs.writeFileSync(b, 'video-bytes');
  assert.equal(C.fileKey(a), C.fileKey(b));
  fs.writeFileSync(b, 'video-bytez'); fs.utimesSync(b, new Date(), new Date(Date.now() + 5000));
  assert.notEqual(C.fileKey(a), C.fileKey(b));
});

test('JSON + file round trip; restore hard-links into the job folder', () => {
  assert.equal(C.getJson('t', 'k1'), null);
  C.putJson('t', 'k1', { words: [1, 2] });
  assert.deepEqual(C.getJson('t', 'k1'), { words: [1, 2] });
  const src = path.join(tmp, 'render.mov'); fs.writeFileSync(src, 'R'.repeat(100));
  C.storeFile('ov', 'k2', '.mov', src);
  const dest = path.join(tmp, 'job-overlay.mov');
  assert.equal(C.restoreFile('ov', 'k2', '.mov', dest), true);
  assert.equal(fs.readFileSync(dest, 'utf8'), 'R'.repeat(100));
  assert.equal(C.restoreFile('ov', 'missing', '.mov', dest), false);
});

test('prune keeps a bucket under its byte budget, dropping least-recently-used first', () => {
  for (const [k, age] of [['old', 3000], ['mid', 2000], ['new', 1000]]) {
    const f = C.cachePath('big', k, '.bin'); fs.writeFileSync(f, 'x'.repeat(100)); const t = new Date(Date.now() - age * 1000); fs.utimesSync(f, t, t);
  }
  C.prune('big', 250);
  assert.deepEqual(fs.readdirSync(path.join(cfg.cacheDir, 'big')).sort(), ['mid.bin', 'new.bin']);
});

test('INSTAEDITS_CACHE=off: nothing is read or written', () => {
  process.env.INSTAEDITS_CACHE = 'off';
  try {
    C.putJson('t', 'k-off', { x: 1 });
    assert.equal(C.getJson('t', 'k1'), null, 'existing entries are ignored');
    assert.ok(!fs.existsSync(C.cachePath('t', 'k-off', '.json')));
  } finally { process.env.INSTAEDITS_CACHE = 'on'; }
});
