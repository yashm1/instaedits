import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let server, calls = [], shape = 'flat', media, tmp, altFails = false;
before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-ts-'));
  server = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
      const msg = JSON.parse(b);
      if (msg.method === 'notifications/initialized') { res.writeHead(202); return res.end(); }
      let result = { protocolVersion: '2025-03-26' };
      if (msg.method === 'tools/call') {
        const { name, arguments: args } = msg.params; calls.push({ name, args });
        const words = args?.language === 'en' && shape === 'flat' ? [{ word: 'नमस्ते', start: 0.4, end: 0.8 }, { word: 'Kafka', start: 0.9, end: 1.3 }, { word: 'तेज़', start: 1.3, end: 1.6 }, { word: '99.99%', start: 1.7, end: 2.1 }] : [{ word: 'नमस्ते', start: 0.4, end: 0.8 }, { word: 'Kafka', start: 0.9, end: 1.3 }, { word: 'तेज़', start: 1.3, end: 1.6 }];
        if (name === 'transcribeClip' && args.language === 'en' && altFails && calls.filter((c) => c.name === 'transcribeClip').length > 1) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { isError: true, content: [{ type: 'text', text: 'model busy' }] } })); }
        const payload = name === 'importMedia' ? (shape === 'noid' ? { ok: true } : { ok: true, item: { id: 'item-7' } })
          : name === 'transcribeClip' ? (shape === 'nested' ? { ok: true, segments: [{ words: words.slice(0, 2) }, { words: words.slice(2) }], lines: [{ text: 'ignored phrase with several words', start: 0, end: 2 }] } : shape === 'empty' ? { words: [] } : { words, lines: [] })
          : { ok: true };
        result = { content: [{ type: 'text', text: JSON.stringify(payload) }] };
      }
      res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'S' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.METAPILOT_URL = `http://127.0.0.1:${server.address().port}/mcp`; process.env.METAPILOT_TOKEN = 't';
  media = await import('../server/media.mjs');
});
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
const dir = () => fs.mkdtempSync(path.join(tmp, 'd-'));

test('Hindi: language is passed to transcribeClip; Devanagari + Latin words come back with timings', async () => {
  calls = []; shape = 'flat';
  const d = dir(); const t = await media.transcribe('/v.mp4', d, () => {}, 'hi');
  assert.deepEqual(calls.map((c) => c.name), ['newProject', 'importMedia', 'transcribeClip', 'transcribeClip']);
  assert.deepEqual(calls[1].args, { path: '/v.mp4' });
  assert.deepEqual(calls[2].args, { id: 'item-7', language: 'hi', mergeSplitWords: true });
  assert.deepEqual(calls[3].args, { id: 'item-7', language: 'en', mergeSplitWords: true }, 'second pass on the same clip, no new project');
  assert.deepEqual(t.words.map((w) => w.w), ['नमस्ते', 'Kafka', 'तेज़']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(d, 'transcript.json'), 'utf8')).words[1], { w: 'Kafka', start: 0.9, end: 1.3 });
});

test('English speech: a single pass, no alt file', async () => {
  calls = []; shape = 'flat'; const d = dir();
  await media.transcribe('/v.mp4', d, () => {});
  assert.equal(calls.filter((c) => c.name === 'transcribeClip').length, 1);
  assert.equal(calls.at(-1).args.language, 'en');
  assert.ok(!fs.existsSync(path.join(d, 'transcript.alt.json')));
});

test('non-English: the English-model pass is stored separately and recovers terms/numbers the native pass dropped', async () => {
  calls = []; shape = 'flat'; const d = dir();
  const t = await media.transcribe('/v.mp4', d, () => {}, 'hi');
  const alt = JSON.parse(fs.readFileSync(path.join(d, 'transcript.alt.json'), 'utf8')).words;
  assert.equal(t.words.length, 3); assert.equal(alt.length, 4);
  assert.ok(alt.some((w) => w.w === '99.99%'));
  assert.ok(!t.words.some((w) => w.w === '99.99%'), 'primary transcript is untouched');
});

test('a failing alt pass never fails the step (best-effort) and is logged', async () => {
  calls = []; shape = 'flat'; altFails = true; const d = dir(); const logs = [];
  const t = await media.transcribe('/v.mp4', d, (m) => logs.push(m), 'hi');
  altFails = false;
  assert.equal(t.words.length, 3);
  assert.ok(logs.some((l) => /alt pass skipped/.test(l)));
  assert.ok(!fs.existsSync(path.join(d, 'transcript.alt.json')));
});

test('word extraction tolerates nested shapes and ignores multi-word phrase lines', async () => {
  calls = []; shape = 'nested';
  const t = await media.transcribe('/v.mp4', dir(), () => {}, 'hi');
  assert.deepEqual(t.words.map((w) => w.w), ['नमस्ते', 'Kafka', 'तेज़']);
});

test('cached transcript: no Edits calls at all', async () => {
  const d = dir(); shape = 'flat'; await media.transcribe('/v.mp4', d, () => {}, 'hi');
  calls = []; const t = await media.transcribe('/v.mp4', d, () => {}, 'hi');
  assert.equal(calls.length, 0); assert.equal(t.words.length, 3);
});

test('clear errors when Edits returns no media id or no words', async () => {
  shape = 'noid'; await assert.rejects(() => media.transcribe('/v.mp4', dir(), () => {}, 'hi'), /no id/);
  shape = 'empty'; await assert.rejects(() => media.transcribe('/v.mp4', dir(), () => {}, 'hi'), /no words/);
});
