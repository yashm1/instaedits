import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A fake `claude` that records what it was given at call time, then returns a valid result event.
let dir, fake, out, mod;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-fake-'));
  out = path.join(dir, 'seen.json'); fake = path.join(dir, 'claude');
  fs.writeFileSync(fake, `#!/usr/bin/env node
const fs = require('fs');
const a = process.argv.slice(2);
const i = a.indexOf('--mcp-config');
const f = a[i + 1];
let stat = null, content = null;
try { stat = fs.statSync(f).mode & 0o777; content = fs.readFileSync(f, 'utf8'); } catch {}
fs.writeFileSync(process.env.FAKE_OUT, JSON.stringify({ argv: a, mcpArg: f, mode: stat, content }));
console.log(JSON.stringify({ type: 'result', result: 'ok', total_cost_usd: 0.01, usage: { input_tokens: 5, output_tokens: 7 } }));
`, { mode: 0o755 });
  process.env.CLAUDE_BIN = fake; process.env.FAKE_OUT = out;
  mod = await import('../server/claude.mjs');
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('MCP secrets go through a private temp file, never argv, and the file is removed afterwards', async () => {
  const r = await mod.runClaude({ model: 'm', prompt: 'hi', mcpServers: { edits: { type: 'http', url: 'http://x', headers: { Authorization: 'Bearer TOP-SECRET' } } } });
  const seen = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.ok(!seen.argv.join(' ').includes('TOP-SECRET'), 'token leaked into argv');
  assert.equal(seen.mode, 0o600);
  assert.match(seen.content, /TOP-SECRET/, 'the file itself carries the config');
  assert.ok(!fs.existsSync(seen.mcpArg), 'temp config not cleaned up');
  assert.ok(!fs.existsSync(path.dirname(seen.mcpArg)), 'temp dir not cleaned up');
  assert.deepEqual(r.tokens, { in: 5, out: 7 }); assert.equal(r.cost, 0.01); assert.equal(r.text, 'ok');
});

test('without mcpServers the empty strict config is used and nothing is written', async () => {
  await mod.runClaude({ model: 'm', prompt: 'hi' });
  const seen = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(seen.mcpArg, '{"mcpServers":{}}');
});

test('writeSecretJson: dir 0700, file 0600, cleanup removes everything', () => {
  const { file, cleanup } = mod.writeSecretJson({ a: 1 });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
  cleanup(); assert.ok(!fs.existsSync(path.dirname(file)));
});

test('the temp file is cleaned up even when claude fails', async () => {
  fs.writeFileSync(fake, '#!/usr/bin/env node\nconsole.error("nope");process.exit(3)', { mode: 0o755 });
  const marker = `https://marker-${process.pid}-${Date.now()}.invalid`; // unique: other test files may create temp configs at the same time
  await assert.rejects(() => mod.runClaude({ model: 'm', prompt: 'x', mcpServers: { e: { type: 'http', url: marker } } }), /claude exited 3/);
  const leftovers = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('instaedits-')).filter((n) => {
    try { return fs.readFileSync(path.join(os.tmpdir(), n, 'mcp.json'), 'utf8').includes(marker); } catch { return false; }
  });
  assert.deepEqual(leftovers, []);
});
