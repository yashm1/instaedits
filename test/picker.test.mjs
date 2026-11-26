import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pickVideo, pickerScript } from '../server/picker.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-pick-'));
const video = path.join(tmp, 'reel.mp4'); fs.writeFileSync(video, 'x');

test('picker script: native macOS chooser, movies only, brought to the front, starts in a sane folder', () => {
  const s = pickerScript(null);
  assert.match(s, /choose file/); assert.match(s, /of type \{"public\.movie"\}/); assert.match(s, /activate/); assert.match(s, /path to downloads folder/);
  assert.match(pickerScript(tmp), new RegExp(`POSIX file ${JSON.stringify(tmp).replace(/[/\\]/g, '\\$&')}`));
  assert.match(pickerScript('/no/such/dir'), /path to downloads folder/, 'a vanished folder falls back to Downloads');
});

test('a picked video is validated like a typed path and the next picker starts in its folder', async () => {
  const seen = [];
  const r = await pickVideo({ run: async (script) => { seen.push(script); return { stdout: `${video}\n` }; } });
  assert.equal(r.path, video); assert.equal(r.name, 'reel.mp4');
  await pickVideo({ run: async (script) => { seen.push(script); return { stdout: video }; } });
  assert.ok(seen[1].includes(JSON.stringify(tmp)), 'remembers the last folder');
});

test('cancel is not an error; a non-video or a broken picker is', async () => {
  assert.deepEqual(await pickVideo({ run: async () => { throw Object.assign(new Error('x'), { stderr: 'execution error: User canceled. (-128)' }); } }), { cancelled: true });
  await assert.rejects(() => pickVideo({ run: async () => ({ stdout: '/etc/hosts' }) }), /must be one of/);
  await assert.rejects(() => pickVideo({ run: async () => { throw Object.assign(new Error('x'), { stderr: 'osascript: not allowed' }); } }), /could not open the file picker/);
});
