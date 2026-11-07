import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stageFile, stageDir, stagingFor } from '../server/staging.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ie-st-'));
const same = (a, b) => { const x = fs.statSync(a), y = fs.statSync(b); return x.ino === y.ino && x.dev === y.dev; };

test('stageFile hard-links on the same volume (instant, no extra disk) and creates parent dirs', () => {
  const d = tmp(); const src = path.join(d, 'a.mp4'); fs.writeFileSync(src, 'video-bytes');
  const dest = stageFile(src, path.join(d, 'stage', 'job', 'source.mp4'));
  assert.equal(fs.readFileSync(dest, 'utf8'), 'video-bytes'); assert.ok(same(src, dest));
  fs.rmSync(d, { recursive: true, force: true });
});

test('stageFile is idempotent, and replaces a stale file with the current one', () => {
  const d = tmp(); const src = path.join(d, 'a.mp4'); const dest = path.join(d, 's', 'a.mp4');
  fs.writeFileSync(src, 'v1'); stageFile(src, dest); stageFile(src, dest);
  assert.ok(same(src, dest));
  fs.rmSync(src); fs.writeFileSync(src, 'v2-new'); // re-rendered: new inode at the source
  stageFile(src, dest);
  assert.equal(fs.readFileSync(dest, 'utf8'), 'v2-new'); assert.ok(same(src, dest));
  fs.rmSync(d, { recursive: true, force: true });
});

test('stageFile refuses a missing source with a clear error', () => {
  assert.throws(() => stageFile('/definitely/not/here.mp4', path.join(tmp(), 'x.mp4')), /cannot stage missing file/);
});

test('stageDir stages every mp4, ignores other files, and prunes clips that no longer exist', () => {
  const d = tmp(); const src = path.join(d, 'clips'); const dest = path.join(d, 'stage', 'clips');
  fs.mkdirSync(src); for (const n of ['s1.mp4', 's2.mp4', 'notes.txt']) fs.writeFileSync(path.join(src, n), n);
  stageDir(src, dest);
  assert.deepEqual(fs.readdirSync(dest).sort(), ['s1.mp4', 's2.mp4']);
  fs.rmSync(path.join(src, 's2.mp4')); fs.writeFileSync(path.join(src, 's3.mp4'), 's3'); // plan changed
  stageDir(src, dest);
  assert.deepEqual(fs.readdirSync(dest).sort(), ['s1.mp4', 's3.mp4']);
  fs.rmSync(d, { recursive: true, force: true });
});

test('stagingFor builds <base>/<jobId> and rejects unsafe ids', () => {
  assert.equal(stagingFor('job-1', '/base'), '/base/job-1');
  for (const bad of ['../x', 'a/b', '', null]) assert.throws(() => stagingFor(bad, '/base'), /invalid job id/);
});
