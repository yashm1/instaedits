// Loaded before every test file (`node --import ./test/setup.mjs --test`). Tests must NEVER touch the real jobs/,
// staging, screenshots or cache folders: a test once ran recoverStaleJobs() against the real jobs/ and marked a live
// run as "interrupted". Every path a test could write to points into a fresh temp folder; the cache is off.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'instaedits-test-'));
for (const [k, d] of [['INSTAEDITS_JOBS_DIR', 'jobs'], ['INSTAEDITS_STAGING_DIR', 'staging'], ['INSTAEDITS_SCREENS_DIR', 'screens'], ['INSTAEDITS_CACHE_DIR', 'cache']]) {
  process.env[k] = path.join(root, d);
}
process.env.INSTAEDITS_CACHE ??= 'off';
process.env.INSTAEDITS_TEST_ROOT = root;
process.on('exit', () => { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} });
