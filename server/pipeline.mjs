import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { runClaude, MODELS, writeJson } from './claude.mjs';
import * as P from './prompts.mjs';
import { EDITS_URL, editsAuthHeaders } from './edits-mcp.mjs';
import { applyGuardrails } from './guardrails.mjs';
import { transcribe, planCuts, tighten, sentences, buildEdl, probe as probeVideo } from './media.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REMOTION = path.join(ROOT, 'remotion');
const JOBS = path.join(ROOT, 'jobs');
const metapilotMcp = () => JSON.stringify({ mcpServers: { 'metapilot-native': { type: 'http', url: EDITS_URL, headers: editsAuthHeaders() } } });

export const bus = new EventEmitter();
const jobs = new Map();

export const STEP_DEFS = (q) => [
  { key: 'probe', title: 'Probe video', model: 'local (ffprobe)' },
  { key: 'transcribe', title: 'Word-level transcript', model: 'local (Edits captions model)' },
  { key: 'tighten', title: 'Cut dead air → tight.mp4', model: 'local (ffmpeg)' },
  { key: 'direction', title: 'Creative direction: cards, zooms, captions, music, SFX', model: MODELS.opus },
  { key: 'resolve', title: 'Resolve anchors → exact timestamps (EDL)', model: 'local' },
  { key: 'codegen', title: 'Generate Remotion infographics', model: MODELS.sonnet },
  { key: 'render', title: 'Render infographics (Remotion)', model: 'local (Remotion)' },
  { key: 'edit', title: 'Execute EDL in Edits app', model: q === 'high' ? MODELS.sonnet : MODELS.haiku },
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
    budgets: { direction: 1.0, codegen: 0.5, edit: quality === 'high' ? 3 : 1.5, ...budgets },
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

const STEPS = {
  async probe(job, step, log) {
    const info = probeVideo(job.state.video);
    const v = info.streams.find((x) => x.codec_type === 'video');
    job.state.duration = parseFloat(info.format.duration);
    job.state.resolution = v ? `${v.width}x${v.height}` : '?';
    log(`${job.state.resolution}, ${job.state.duration.toFixed(1)}s, audio=${info.streams.some((x) => x.codec_type === 'audio')}`);
  },

  async transcribe(job, step, log) {
    await transcribe(job.state.video, job.dir, log);
  },

  async tighten(job, step, log) {
    const { words } = JSON.parse(fs.readFileSync(f(job, 'transcript.json'), 'utf8'));
    const cuts = planCuts(words, job.state.duration);
    writeJson(f(job, 'cuts.json'), cuts.segs);
    job.state.tight = { duration: +cuts.total.toFixed(2), saved: +cuts.saved.toFixed(2) };
    if (fs.existsSync(f(job, 'tight.mp4'))) { log('♻️ tight.mp4 cached'); return; }
    await tighten(job.state.video, cuts.segs, f(job, 'tight.mp4'), log, job.abort.signal);
    log(`${job.state.duration.toFixed(1)}s → ${cuts.total.toFixed(1)}s (−${cuts.saved.toFixed(1)}s dead air)`);
  },

  async direction(job, step, log) {
    if (fs.existsSync(f(job, 'direction.json'))) { log('♻️ direction.json exists — reusing (no tokens spent)'); return; }
    const { words } = JSON.parse(fs.readFileSync(f(job, 'transcript.json'), 'utf8'));
    const cuts = planCuts(words, job.state.duration);
    const library = fs.readFileSync(path.join(REMOTION, 'LIBRARY.md'), 'utf8').split('\n').filter((l) => l.startsWith('- `') || l.startsWith('Icons')).join('\n');
    const r = await runClaude({
      model: MODELS.opus, system: P.DIRECTOR_SYSTEM, schema: P.DIRECTOR_SCHEMA, effort: 'medium',
      prompt: P.directorPrompt({ script: job.state.script, sentences: sentences(words, cuts.toOut), duration: cuts.total, library }),
      cwd: job.dir, budget: job.state.budgets.direction, onEvent: log, signal: job.abort.signal,
    });
    const raw = r.structured ?? JSON.parse(r.text.match(/\{[\s\S]*\}/)[0]);
    const { direction: d, notes } = applyGuardrails(raw, { totalSeconds: cuts.total, scriptWordCount: job.state.script.trim().split(/\s+/).length });
    notes.forEach((n) => log(`🛡 ${n}`));
    writeJson(f(job, 'direction.json'), d);
    job.state.direction = { concept: d.concept, cards: d.scenes.length, zooms: d.zooms.length, sfx: d.sfx.length, captions: `${d.captions.style} · ${d.captions.highlightColor}`, music: `${d.music.query} @ ${d.music.volume} (ducked ${d.music.duckedVolume})` };
    log(`🎬 ${d.concept}`);
    return r;
  },

  async resolve(job, step, log) {
    const { words } = JSON.parse(fs.readFileSync(f(job, 'transcript.json'), 'utf8'));
    const cuts = planCuts(words, job.state.duration);
    const d = JSON.parse(fs.readFileSync(f(job, 'direction.json'), 'utf8'));
    const edl = buildEdl(d, words, cuts, log);
    writeJson(f(job, 'edl.json'), edl);
    writeJson(f(job, 'scenes.json'), { remotion_brief: d.remotion_brief, scenes: edl.scenes.map(({ id, kind, dur, props }) => ({ id, kind, dur, props })) });
    for (const x of fs.readdirSync(f(job, 'clips'))) fs.unlinkSync(f(job, 'clips', x)); // stale clips from older plans
    if (fs.existsSync(f(job, 'Scenes.tsx'))) fs.unlinkSync(f(job, 'Scenes.tsx'));
    log(`${edl.scenes.length} cards · ${edl.zooms.length} zooms · ${edl.sfx.length} sfx`);
    job.state.edl = { cards: edl.scenes.map((s) => `${s.start}s ${s.kind} (${s.dur}s)`), zooms: edl.zooms.length, sfx: edl.sfx.length };
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
    const edl = JSON.parse(fs.readFileSync(f(job, 'edl.json'), 'utf8'));
    const out = f(job, 'final.mp4');
    const r = await runClaude({
      model: step.model, system: P.editSystem, prompt: P.editPrompt({ tight: f(job, 'tight.mp4'), clipsDir: f(job, 'clips'), edl, out, quality: job.state.quality }),
      mcpConfig: metapilotMcp(), allowed: 'mcp__metapilot-native', tools: '', cwd: job.dir,
      budget: job.state.budgets.edit, onEvent: log, signal: job.abort.signal,
    });
    log(`↩ ${r.text.slice(0, 300)}`);
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
