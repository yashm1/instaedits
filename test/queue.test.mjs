import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQueue } from '../server/queue.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('tasks run strictly one at a time, in order', async () => {
  const q = createQueue(); const log = []; let running = 0, max = 0;
  const task = (n, ms) => async () => { running++; max = Math.max(max, running); log.push(`start${n}`); await sleep(ms); log.push(`end${n}`); running--; return n; };
  const res = await Promise.all([q.enqueue(task(1, 30)), q.enqueue(task(2, 5)), q.enqueue(task(3, 1))]);
  assert.deepEqual(res, [1, 2, 3]);
  assert.equal(max, 1);
  assert.deepEqual(log, ['start1', 'end1', 'start2', 'end2', 'start3', 'end3']);
});

test('a failing task rejects its own promise but never blocks the next', async () => {
  const q = createQueue();
  const bad = q.enqueue(async () => { throw new Error('boom'); });
  const good = q.enqueue(async () => 'ok');
  await assert.rejects(bad, /boom/);
  assert.equal(await good, 'ok');
});

test('onStart fires when the task actually begins (not when queued); size tracks pending', async () => {
  const q = createQueue(); const started = [];
  const a = q.enqueue(() => sleep(20), () => started.push('a'));
  const b = q.enqueue(async () => {}, () => started.push('b'));
  assert.equal(q.size, 2); assert.deepEqual(started, []);
  await a; assert.deepEqual(started, ['a', 'b'].slice(0, started.length)); await b;
  await sleep(1); assert.equal(q.size, 0); assert.deepEqual(started, ['a', 'b']);
});
