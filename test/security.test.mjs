import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { isSafeId, checkRequest, validateVideoPath, readJson } from '../server/security.mjs';

const req = (method, headers) => ({ method, headers });
const P = 4399;

test('isSafeId rejects traversal, separators, empties and non-strings', () => {
  for (const bad of ['../x', 'a/b', 'a\\b', '', ' ', '..', 'a.b', 'x'.repeat(65), null, undefined, 5, {}]) assert.equal(isSafeId(bad), false, String(bad));
  for (const ok of ['job-20261106190450', 'a_b-C9']) assert.equal(isSafeId(ok), true);
});

test('GET from our own host passes', () => assert.equal(checkRequest(req('GET', { host: `127.0.0.1:${P}` }), P).ok, true));

test('foreign Host (DNS rebinding) is rejected even for GET', () => {
  const r = checkRequest(req('GET', { host: 'evil.com:4399' }), P);
  assert.equal(r.ok, false); assert.equal(r.status, 403);
  assert.equal(checkRequest(req('GET', {}), P).ok, false);
});

test('POST with a foreign Origin is rejected (CSRF)', () => {
  const r = checkRequest(req('POST', { host: `127.0.0.1:${P}`, origin: 'https://evil.com', 'content-type': 'application/json' }), P);
  assert.equal(r.ok, false); assert.equal(r.status, 403); assert.equal(r.reason, 'bad origin');
  assert.equal(checkRequest(req('POST', { host: `127.0.0.1:${P}`, origin: 'null', 'content-type': 'application/json' }), P).ok, false);
});

test('POST without JSON content-type is rejected (simple cross-site form/text posts)', () => {
  for (const ct of [undefined, 'text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data']) {
    const r = checkRequest(req('POST', { host: `127.0.0.1:${P}`, ...(ct ? { 'content-type': ct } : {}) }), P);
    assert.equal(r.ok, false); assert.equal(r.status, 415);
  }
});

test('POST from the dashboard itself (same origin, JSON) passes; localhost alias too', () => {
  assert.equal(checkRequest(req('POST', { host: `127.0.0.1:${P}`, origin: `http://127.0.0.1:${P}`, 'content-type': 'application/json; charset=utf-8' }), P).ok, true);
  assert.equal(checkRequest(req('POST', { host: `localhost:${P}`, origin: `http://localhost:${P}`, 'content-type': 'application/json' }), P).ok, true);
  assert.equal(checkRequest(req('POST', { host: `127.0.0.1:${P}`, 'content-type': 'application/json' }), P).ok, true, 'non-browser clients send no Origin');
});

test('validateVideoPath: absolute, known extension, exists, is a file; strips quotes', () => {
  const dir = fs.mkdtempSync('/tmp/ie-v-'); const ok = `${dir}/a.MP4`; fs.writeFileSync(ok, 'x'); fs.mkdirSync(`${dir}/d.mp4`);
  try {
    assert.equal(validateVideoPath(`  '${ok}' `), ok);
    assert.throws(() => validateVideoPath('rel/a.mp4'), /absolute/);
    assert.throws(() => validateVideoPath(`${dir}/a.txt`), /must be one of/);
    assert.throws(() => validateVideoPath(`${dir}/none.mp4`), /not found/);
    assert.throws(() => validateVideoPath(`${dir}/d.mp4`), /must be a file/);
    assert.throws(() => validateVideoPath('/etc/passwd'), /must be one of/);
    assert.throws(() => validateVideoPath(undefined), /absolute/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('readJson parses, tolerates empty, rejects invalid and oversized bodies', async () => {
  assert.deepEqual(await readJson(Readable.from(['{"a":1}'])), { a: 1 });
  assert.deepEqual(await readJson(Readable.from([])), {});
  await assert.rejects(() => readJson(Readable.from(['{nope'])), /invalid JSON/);
  await assert.rejects(() => readJson(Readable.from(['x'.repeat(50)]), 10), /too large/);
});
