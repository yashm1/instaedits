import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';

let port, base, server;
before(async () => {
  // pick a free port first: the Host allow-list is derived from it
  port = await new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
  process.env.PORT = String(port);
  ({ server } = await import('../server/index.mjs'));
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  base = `http://127.0.0.1:${port}`;
});
after(() => server.close());

const post = (p, body, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('serves the dashboard and job list on the right host', async () => {
  assert.equal((await fetch(base + '/')).status, 200);
  const r = await fetch(base + '/api/jobs'); assert.equal(r.status, 200); assert.ok(Array.isArray(await r.json()));
});

test('foreign Host header is refused (DNS rebinding)', async () => {
  const r = await fetch(base + '/api/jobs', { headers: { host: 'evil.com' } }).catch((e) => e);
  // undici forbids overriding Host; fall back to a raw socket
  if (r instanceof Error || r.status === 200) {
    const res = await new Promise((resolve) => { const s = net.connect(port, '127.0.0.1', () => s.write('GET /api/jobs HTTP/1.1\r\nHost: evil.com\r\nConnection: close\r\n\r\n')); let b = ''; s.on('data', (d) => (b += d)); s.on('close', () => resolve(b)); });
    assert.match(res, /403/);
  } else assert.equal(r.status, 403);
});

test('cross-site POST is refused; text/plain POST is refused', async () => {
  assert.equal((await post('/api/run', {}, { origin: 'https://evil.com' })).status, 403);
  assert.equal((await post('/api/run', '{}', { 'content-type': 'text/plain' })).status, 415);
});

test('invalid runs return 400 with a message and never create a job', async () => {
  const before = (await (await fetch(base + '/api/jobs')).json()).length;
  for (const body of [{}, { script: 'x' }, { script: 'x', video: '/etc/passwd' }, { script: 'x', video: '/nope.mp4' }, { script: 'x', video: '/nope.mp4', jobId: '../../evil' }]) {
    const r = await post('/api/run', body); assert.equal(r.status, 400, JSON.stringify(body)); assert.ok((await r.json()).error);
  }
  assert.equal((await post('/api/run', '{bad json')).status, 400);
  assert.equal((await (await fetch(base + '/api/jobs')).json()).length, before);
});

test('unsafe ids are rejected on events / resume / cancel', async () => {
  assert.equal((await fetch(base + '/api/events/..%2F..%2Fetc')).status, 400);
  assert.equal((await post('/api/resume/..%2Fx', {})).status, 400);
  assert.equal((await post('/api/resume/unknown-job', {})).status, 400);
});

test('static serving cannot escape public/', async () => {
  for (const p of ['/../package.json', '/..%2fpackage.json', '/%2e%2e/server/config.mjs']) assert.notEqual((await fetch(base + p)).status, 200, p);
});
