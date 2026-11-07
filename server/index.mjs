import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.mjs';
import { bus, createJob, startJob, resumeJob, recoverStaleJobs, getJob, listJobs, cancel } from './pipeline.mjs';
import { checkRequest, isSafeId, readJson } from './security.mjs';

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const { host, port } = config.server;
const json = (res, code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
const lastSeg = (u) => decodeURIComponent(u.pathname.split('/').pop());

export const server = http.createServer(async (req, res) => {
  const guard = checkRequest(req, port);
  if (!guard.ok) return json(res, guard.status, { error: guard.reason });
  const url = new URL(req.url, `http://${host}:${port}`);
  try {
    if (req.method === 'POST' && url.pathname === '/api/run') {
      const { script, video, quality, dryRun, budgets, language, links, terms } = await readJson(req); // whitelist: never spread the body
      const job = createJob({ script, video, quality, dryRun: !!dryRun, budgets, language, links, terms });
      startJob(job).catch(() => {});
      return json(res, 200, { id: job.id });
    }
    if (req.method === 'POST' && url.pathname.startsWith('/api/resume/')) {
      const { from } = await readJson(req);
      return json(res, 200, { id: resumeJob(lastSeg(url), from || 'probe').id });
    }
    if (req.method === 'POST' && url.pathname.startsWith('/api/cancel/')) { cancel(lastSeg(url)); return json(res, 200, {}); }
    if (url.pathname === '/api/jobs') return json(res, 200, listJobs());
    if (url.pathname.startsWith('/api/events/')) {
      const id = lastSeg(url);
      if (!isSafeId(id)) return json(res, 400, { error: 'invalid job id' });
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const send = (s) => res.write(`data: ${JSON.stringify(s)}\n\n`);
      const cur = getJob(id); if (cur) send(cur);
      bus.on(id, send); req.on('close', () => bus.off(id, send)); return;
    }
    const file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
    if (file.startsWith(PUBLIC) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { 'content-type': file.endsWith('.html') ? 'text/html' : 'text/plain' }); return res.end(fs.readFileSync(file));
    }
    res.writeHead(404); res.end('not found');
  } catch (e) { json(res, 400, { error: e.message }); }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const stale = recoverStaleJobs();
  server.listen(port, host, () => console.log(`Instaedits dashboard → http://${host}:${port}${stale ? ` (${stale} interrupted job(s) marked resumable)` : ''}`));
}
