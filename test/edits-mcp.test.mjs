import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let server, calls = [], mode = 'ok', mod;
before(async () => {
  server = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
      const msg = JSON.parse(b); calls.push({ auth: req.headers.authorization, sid: req.headers['mcp-session-id'], msg });
      if (mode === '403') { res.writeHead(403, { 'content-type': 'application/json' }); return res.end('{"error":"unauthorized"}'); }
      if (msg.method === 'notifications/initialized') { res.writeHead(202); return res.end(); }
      const result = msg.method === 'initialize' ? { protocolVersion: '2025-03-26' }
        : msg.params.name === 'bad' ? { isError: true, content: [{ type: 'text', text: 'boom' }] }
        : msg.params.name === 'sse' ? null
        : { content: [{ type: 'text', text: JSON.stringify({ echo: msg.params.arguments, ok: true }) }] };
      const payload = JSON.stringify({ jsonrpc: '2.0', id: msg.id, result });
      if (msg.params?.name === 'sse') { res.writeHead(200, { 'content-type': 'text/event-stream' }); return res.end(`data: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'plain text' }] } })}\n\n`); }
      res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'S1' }); res.end(payload);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.METAPILOT_URL = `http://127.0.0.1:${server.address().port}/mcp`;
  process.env.METAPILOT_TOKEN = 'secret-token';
  mod = await import('../server/edits-mcp.mjs');
});
after(() => server.close());

test('connects with bearer token, keeps the session id, returns parsed JSON', async () => {
  const r = await mod.tool('probeX', { a: 1 });
  assert.deepEqual(r, { echo: { a: 1 }, ok: true });
  assert.ok(calls.every((c) => c.auth === 'Bearer secret-token'));
  assert.equal(calls.at(-1).sid, 'S1');
  assert.deepEqual(calls.map((c) => c.msg.method), ['initialize', 'notifications/initialized', 'tools/call']);
});

test('reuses the session for later calls (no second initialize)', async () => {
  const n = calls.length; await mod.tool('again');
  assert.equal(calls.length, n + 1);
});

test('tool errors surface with the tool name', async () => {
  await assert.rejects(() => mod.tool('bad'), /bad: boom/);
});

test('plain-text results and SSE framing are handled', async () => {
  assert.equal(await mod.tool('sse'), 'plain text');
});

test('editsAuthHeaders is empty without a token', () => {
  const t = process.env.METAPILOT_TOKEN; delete process.env.METAPILOT_TOKEN;
  assert.deepEqual(mod.editsAuthHeaders(), {}); process.env.METAPILOT_TOKEN = t;
});
