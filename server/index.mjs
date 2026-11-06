import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bus, createJob, runJob, getJob, listJobs, cancel } from './pipeline.mjs';

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const PORT = process.env.PORT || 4399;
const body = (req) => new Promise((r) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => r(b ? JSON.parse(b) : {})); });
const json = (res, code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
const active = new Map();

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'POST' && url.pathname === '/api/run') {
      const b = await body(req);
      const job = createJob({ ...b, video: b.video?.trim().replace(/^['"]|['"]$/g, '') });
      active.set(job.id, job);
      runJob(job).finally(() => active.delete(job.id));
      return json(res, 200, { id: job.id });
    }
    if (req.method === 'POST' && url.pathname.startsWith('/api/resume/')) {
      const id = url.pathname.split('/').pop(); const b = await body(req);
      const st = getJob(id); if (!st) return json(res, 404, { error: 'no such job' });
      const job = { id, dir: path.resolve(PUBLIC, '../jobs', id), state: st, abort: new AbortController() };
      active.set(id, job); runJob(job, { from: b.from || 'probe' }).finally(() => active.delete(id));
      return json(res, 200, { id });
    }
    if (req.method === 'POST' && url.pathname.startsWith('/api/cancel/')) { cancel(url.pathname.split('/').pop()); return json(res, 200, {}); }
    if (url.pathname === '/api/jobs') return json(res, 200, listJobs());
    if (url.pathname.startsWith('/api/events/')) {
      const id = url.pathname.split('/').pop();
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
}).listen(PORT, '127.0.0.1', () => console.log(`Instaedits dashboard → http://127.0.0.1:${PORT}`));
