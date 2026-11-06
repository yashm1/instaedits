import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { runClaude, MODELS, writeJson } from './claude.mjs';
import * as P from './prompts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REMOTION = path.join(ROOT, 'remotion');
const JOBS = path.join(ROOT, 'jobs');
const METAPILOT_MCP = JSON.stringify({ mcpServers: { 'metapilot-native': { type: 'http', url: process.env.METAPILOT_URL || 'http://127.0.0.1:19501/mcp' } } });

export const bus = new EventEmitter();
const jobs = new Map();

const STEP_DEFS = (q) => [
  { key: 'probe', title: 'Probe video', model: 'local (ffprobe)' },
  { key: 'plan', title: 'Plan storyboard + Remotion brief', model: MODELS.opus },
  { key: 'codegen', title: 'Generate Remotion scenes', model: MODELS.sonnet },
  { key: 'render', title: 'Render scenes (Remotion)', model: 'local (Remotion)' },
  { key: 'edit', title: 'Edit in Edits app (cuts, overlays, captions, music, export)', model: q === 'high' ? MODELS.sonnet : MODELS.haiku },
  { key: 'verify', title: 'Verify export', model: 'local (ffprobe)' },
];

const save = (job) => { writeJson(path.join(job.dir, 'state.json'), job.state); bus.emit(job.id, job.state); };

export function listJobs() {
  if (!fs.existsSync(JOBS)) return [];
  return fs.readdirSync(JOBS).filter((d) => fs.existsSync(path.join(JOBS, d, 'state.json')))
    .map((d) => JSON.parse(fs.readFileSync(path.join(JOBS, d, 'state.json'), 'utf8')))
    .sort((a, b) => b.createdAt - a.createdAt);
}
export const getJob = (id) => jobs.get(id)?.state ?? (fs.existsSync(path.join(JOBS, id, 'state.json')) ? JSON.parse(fs.readFileSync(path.join(JOBS, id, 'state.json'), 'utf8')) : null);

export function createJob({ script, video, quality = 'high', budgets = {}, jobId, dryRun = false }) {
  if (!script?.trim()) throw new Error('script is required');
  if (!video || !fs.existsSync(video)) throw new Error(`video not found: ${video}`);
  const id = jobId || `job-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`;
  const dir = path.join(JOBS, id);
  fs.mkdirSync(path.join(dir, 'clips'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'script.txt'), script);
  const state = {
    id, createdAt: Date.now(), status: 'queued', quality, dryRun: !!dryRun, video, script,
    budgets: { plan: 0.6, codegen: 0.5, edit: quality === 'high' ? 2.5 : 1.2, ...budgets },
    steps: STEP_DEFS(quality).map((s) => ({ ...s, status: 'pending', log: [], cost: 0, tokens: { in: 0, out: 0 } })),
  };
  const job = { id, dir, state, abort: new AbortController() };
  jobs.set(id, job);
  save(job);
  return job;
}

export function cancel(id) { jobs.get(id)?.abort.abort(); }

export async function runJob(job, { from = 'probe' } = {}) {
  const s = job.state;
  s.status = 'running'; save(job);
  const startIdx = Math.max(0, s.steps.findIndex((x) => x.key === from));
  try {
    for (const step of s.steps.slice(startIdx)) {
      if (s.dryRun && (step.key === 'edit' || step.key === 'verify')) { step.status = 'skipped'; step.log = ['dry run — Edits step skipped']; save(job); continue; }
      step.status = 'running'; step.startedAt = Date.now(); step.log = []; save(job);
      const log = (m) => { step.log.push(m); if (step.log.length > 80) step.log.shift(); save(job); };
      try {
        const r = await STEPS[step.key](job, step, log);
        if (r) { step.cost = r.cost ?? 0; step.tokens = r.tokens ?? step.tokens; }
        step.status = 'done';
      } catch (e) {
        step.status = 'error'; step.error = e.message; log(`❌ ${e.message}`);
        throw e;
      } finally { step.endedAt = Date.now(); save(job); }
    }
    s.status = 'done';
  } catch (e) { s.status = job.abort.signal.aborted ? 'cancelled' : 'error'; }
  s.totalCost = s.steps.reduce((a, x) => a + x.cost, 0);
  save(job);
}

const f = (job, ...p) => path.join(job.dir, ...p);
const probeVideo = (file) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=width,height,codec_type', '-of', 'json', file], { encoding: 'utf8' }));

const STEPS = {
  async probe(job, step, log) {
    const info = probeVideo(job.state.video);
    const v = info.streams.find((x) => x.codec_type === 'video');
    job.state.duration = parseFloat(info.format.duration);
    job.state.resolution = v ? `${v.width}x${v.height}` : '?';
    log(`${job.state.resolution}, ${job.state.duration.toFixed(1)}s, audio=${info.streams.some((x) => x.codec_type === 'audio')}`);
  },

  async plan(job, step, log) {
    if (fs.existsSync(f(job, 'storyboard.json'))) { log('♻️ storyboard.json exists — reusing (no tokens spent)'); return; }
    const library = fs.readFileSync(path.join(REMOTION, 'LIBRARY.md'), 'utf8').split('\n').filter((l) => l.startsWith('- `')).join('\n');
    const r = await runClaude({
      model: MODELS.opus, system: P.PLAN_SYSTEM, schema: P.PLAN_SCHEMA, effort: 'low',
      prompt: P.planPrompt({ script: job.state.script, duration: job.state.duration, library }),
      cwd: job.dir, budget: job.state.budgets.plan, onEvent: log, signal: job.abort.signal,
    });
    const plan = r.structured ?? JSON.parse(r.text.match(/\{[\s\S]*\}/)[0]);
    writeJson(f(job, 'storyboard.json'), plan);
    log(`${plan.scenes.length} scenes planned`);
    return r;
  },

  async codegen(job, step, log) {
    const scenesFile = path.join(REMOTION, 'src/Scenes.tsx');
    const cache = f(job, 'Scenes.tsx');
    if (fs.existsSync(cache)) { fs.copyFileSync(cache, scenesFile); log('♻️ Scenes.tsx cached — reusing'); return; }
    const r = await runClaude({
      model: MODELS.sonnet, prompt: P.codegenPrompt({ jobId: job.id }), tools: 'Read,Write,Edit',
      cwd: REMOTION, budget: job.state.budgets.codegen, onEvent: log, signal: job.abort.signal,
      allowed: `Read Write(src/Scenes.tsx) Edit(src/Scenes.tsx)`, effort: 'low',
    });
    fs.copyFileSync(scenesFile, cache);
    return r;
  },

  async render(job, step, log) {
    const scenesFile = path.join(REMOTION, 'src/Scenes.tsx');
    fs.copyFileSync(f(job, 'Scenes.tsx'), scenesFile);
    let total = { cost: 0, tokens: { in: 0, out: 0 } };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        log('typecheck…');
        execFileSync('npx', ['tsc', '--noEmit'], { cwd: REMOTION, encoding: 'utf8', stdio: 'pipe' });
        await sh('node', ['render.mjs', f(job, 'clips')], REMOTION, (l) => {
          try { const e = JSON.parse(l); log(e.finished ? '✅ all scenes rendered' : e.done ? `${e.id} done` : e.skipped ? `${e.id} cached` : `${e.id} ${e.progress}%`); } catch { log(l.slice(0, 160)); }
        }, job.abort.signal);
        return total;
      } catch (e) {
        const msg = (e.stdout || '') + (e.stderr || '') + e.message;
        if (attempt === 1) throw new Error('render failed after repair: ' + msg.slice(0, 300));
        log('⚠️ failed — one cheap Sonnet repair attempt');
        const r = await runClaude({
          model: MODELS.sonnet, prompt: P.repairPrompt(msg), tools: 'Read,Edit', allowed: 'Read Edit(src/Scenes.tsx)',
          cwd: REMOTION, budget: 0.3, onEvent: log, signal: job.abort.signal, effort: 'low',
        });
        total.cost += r.cost; total.tokens.in += r.tokens.in; total.tokens.out += r.tokens.out;
        fs.copyFileSync(scenesFile, f(job, 'Scenes.tsx'));
      }
    }
  },

  async edit(job, step, log) {
    const plan = JSON.parse(fs.readFileSync(f(job, 'storyboard.json'), 'utf8'));
    const out = f(job, 'final.mp4');
    const r = await runClaude({
      model: step.model, prompt: P.editPrompt({ video: job.state.video, clipsDir: f(job, 'clips'), storyboard: plan.scenes, out, quality: job.state.quality }),
      mcpConfig: METAPILOT_MCP, allowed: 'mcp__metapilot-native', tools: '', cwd: job.dir,
      budget: job.state.budgets.edit, onEvent: log, signal: job.abort.signal,
    });
    log(`↩ ${r.text.slice(0, 200)}`);
    return r;
  },

  async verify(job, step, log) {
    const out = f(job, 'final.mp4');
    if (!fs.existsSync(out)) throw new Error('final.mp4 not found — the Edits export did not land at the requested path');
    const info = probeVideo(out);
    log(`final.mp4 ${parseFloat(info.format.duration).toFixed(1)}s ✔`);
    job.state.output = out;
  },
};

function sh(cmd, args, cwd, onLine, signal) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, signal });
    let buf = '', err = '';
    p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i)); buf = buf.slice(i + 1); } });
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (c) => (c === 0 ? resolve() : reject(Object.assign(new Error(`${cmd} exited ${c}`), { stderr: err.slice(-1500) }))));
  });
}
