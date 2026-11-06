// One job at a time. There is exactly one Edits app to drive and one shared Remotion workspace,
// so concurrent jobs would corrupt each other. A failing task never blocks the ones behind it.
export function createQueue() {
  let tail = Promise.resolve();
  let pending = 0;
  return {
    get size() { return pending; },
    enqueue(task, onStart) {
      pending++;
      const run = tail.then(() => { onStart?.(); return task(); });
      tail = run.catch(() => {}).finally(() => { pending--; });
      return run;
    },
  };
}
