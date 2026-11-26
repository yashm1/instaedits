import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.mjs';
import { bus, createJob, startJob, resumeJob, recoverStaleJobs, getJob, listJobs, cancel } from './pipeline.mjs';
import { checkRequest, isSafeId, readJson } from './security.mjs';
import { pickVideo } from './picker.mjs';
import { execFile } from 'node:child_process';
import { tool as editsTool } from './edits-mcp.mjs';
import { stagingFor } from './staging.mjs';

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
      const { script, video, quality, dryRun, budgets, language, links, terms, mode } = await readJson(req); // whitelist: never spread the body
      const job = createJob({ script, video, quality, dryRun: !!dryRun, budgets, language, links, terms, mode });
      startJob(job).catch(() => {});
      return json(res, 200, { id: job.id });
    }
    if (req.method === 'POST' && url.pathname.startsWith('/api/resume/')) {
      const { from } = await readJson(req);
      return json(res, 200, { id: resumeJob(lastSeg(url), from || 'probe').id });
    }
    // native macOS file picker (POST only: the Origin/JSON checks above stop web pages from opening dialogs)
    if (req.method === 'POST' && url.pathname === '/api/pick') return json(res, 200, await pickVideo());
    if (url.pathname === '/api/recent-videos') return json(res, 200, [...new Set(listJobs().map((j) => j.video).filter((v) => v && fs.existsSync(v)))].slice(0, 8));
    if (req.method === 'POST' && url.pathname.startsWith('/api/cancel/')) { cancel(lastSeg(url)); return json(res, 200, {}); }
    if (url.pathname === '/api/jobs') return json(res, 200, listJobs());
    if (url.pathname === '/api/health') return json(res, 200, await health());
    // the finished reel and its QA contact sheet — only files that belong to a job, never arbitrary paths
    if (url.pathname.startsWith('/api/video/')) return sendFile(req, res, jobFile(lastSeg(url), 'final'), 'video/mp4');
    if (url.pathname.startsWith('/api/contact/')) return sendFile(req, res, jobFile(lastSeg(url), 'contact'), 'image/jpeg');
    if (url.pathname.startsWith('/api/thumb/')) return sendFile(req, res, await thumb(lastSeg(url)), 'image/jpeg');
    if (req.method === 'POST' && url.pathname.startsWith('/api/reveal/')) {
      const f = jobFile(lastSeg(url), 'final');
      if (!f) return json(res, 404, { error: 'no finished reel for this job yet' });
      execFile('open', ['-R', f]); return json(res, 200, {});
    }
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
      const type = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' }[path.extname(file)] ?? 'text/plain';
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }); return res.end(fs.readFileSync(file));
    }
    res.writeHead(404); res.end('not found');
  } catch (e) { json(res, 400, { error: e.message }); }
});

/** Path of a job's artefact, or null. 'final' lives in the job's staging folder; 'contact' in the job folder. */
export function jobFile(id, which) {
  if (!isSafeId(id) || !getJob(id)) return null;
  const f = which === 'final' ? path.join(stagingFor(id), 'final.mp4') : path.join(config.jobsDir, id, 'qa', 'contact.jpg');
  return fs.existsSync(f) ? f : null;
}

/** A small poster frame of the finished reel (frame at 0.4 s — the hook), regenerated when the reel changes. */
async function thumb(id) {
  const final = jobFile(id, 'final');
  if (!final) return null;
  const out = path.join(config.jobsDir, id, 'thumb.jpg');
  if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(final).mtimeMs) return out;
  await new Promise((resolve) => execFile('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '0.4', '-i', final, '-frames:v', '1', '-vf', 'scale=360:-2', '-q:v', '4', out], () => resolve()));
  return fs.existsSync(out) ? out : null;
}

/** Stream a file with HTTP Range support (the <video> element seeks with Range requests). */
function sendFile(req, res, file, type) {
  if (!file) return json(res, 404, { error: 'not available yet' });
  const size = fs.statSync(file).size;
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
  if (m) {
    const start = m[1] ? +m[1] : 0, end = m[2] ? Math.min(+m[2], size - 1) : size - 1;
    if (start >= size || start > end) { res.writeHead(416, { 'content-range': `bytes */${size}` }); return res.end(); }
    res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1, 'cache-control': 'no-store' });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': size, 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

/** Is everything a run needs in place? Cheap: one Edits call with a short timeout. */
async function health() {
  const token = !!config.editsToken();
  let edits = 'down';
  if (token) {
    try { await Promise.race([editsTool('appState'), new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 2500))]); edits = 'ok'; }
    catch (e) { edits = /rejected/i.test(e.message) ? 'bad-token' : 'down'; }
  }
  return { edits: token ? edits : 'no-token' };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const stale = recoverStaleJobs();
  server.listen(port, host, () => console.log(`Instaedits dashboard → http://${host}:${port}${stale ? ` (${stale} interrupted job(s) marked resumable)` : ''}`));
}
