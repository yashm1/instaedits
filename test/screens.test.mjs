import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let tmp, S;
before(async () => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-s-')); process.env.INSTAEDITS_SCREENS_DIR = path.join(tmp, 'screens'); S = await import('../server/screens.mjs'); });
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const TOKEN = 'WZTVeTTl9CTbHUqh2sEJTTNc2yUrA-RLO5QPIP4ouVY';
const png = () => { const f = path.join(tmp, `in-${Math.random().toString(36).slice(2)}.png`); fs.writeFileSync(f, 'x'); return f; };

test('importScreen: your own screenshot is redacted like a capture and marked so capture never overwrites it', async () => {
  let painted = null;
  const r = await S.importScreen('edits-automation', png(), { token: TOKEN, deps: { ocr: async () => (painted ? [] : [{ text: TOKEN, x: 1, y: 1, w: 9, h: 9 }]), paint: async (_, b) => { painted = b; } } });
  assert.equal(r.redacted, 1);
  assert.ok(fs.existsSync(path.join(tmp, 'screens', 'edits-automation.png')));
  assert.ok(fs.existsSync(path.join(tmp, 'screens', 'edits-automation.user')), 'marked as the creator\'s own');
});

test('importScreen fails closed: a token that survives redaction means no file at all', async () => {
  await assert.rejects(() => S.importScreen('edits-editor', png(), { token: TOKEN, deps: { ocr: async () => [{ text: TOKEN, x: 1, y: 1, w: 9, h: 9 }], paint: async () => {} } }), /still readable/);
  assert.ok(!fs.existsSync(path.join(tmp, 'screens', 'edits-editor.png')));
  assert.ok(!fs.existsSync(path.join(tmp, 'screens', 'edits-editor.user')));
});

test('importScreen rejects unknown shots and non-png / missing files', async () => {
  await assert.rejects(() => S.importScreen('made-up', png()), /unknown screenshot/);
  await assert.rejects(() => S.importScreen('edits-editor', '/nope/missing.png'), /exists/);
  await assert.rejects(() => S.importScreen('edits-editor', '/etc/hosts'), /\.png/);
});
