import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { config } from './config.mjs';
import { createQueue } from './queue.mjs';
import { isSafeId, validateVideoPath } from './security.mjs';
import { stagingFor, stageFile, stageDir } from './staging.mjs';
import { runClaude, writeJson } from './claude.mjs';
import * as P from './prompts.mjs';
import { EDITS_URL, editsAuthHeaders } from './edits-mcp.mjs';
import { applyGuardrails } from './guardrails.mjs';
import { gatherAssets, isRefKind } from './references.mjs';
import { transcribe, planCuts, tighten, sentences, attachAlt, buildEdl, probe as probeVideo } from './media.mjs';

const REMOTION = config.remotionDir;
const JOBS = config.jobsDir;
const editsMcpServers = () => ({ [config.editsServer]: { type: 'http', url: EDITS_URL, headers: editsAuthHeaders() } });
const queue = createQueue();

export const bus = new EventEmitter();
const jobs = new Map();

export const STEPS_FOR_TEST = () => STEPS;
export const STEP_DEFS = (q) => [
  { key: 'probe', title: 'Probe video', model: 'local (ffprobe)' },
  { key: 'transcribe', title: 'Word-level transcript', model: 'local (Edits captions model)' },
  { key: 'tighten', title: 'Cut dead air → tight.mp4', model: 'local (ffmpeg)' },
  { key: 'translate', title: 'Translate speech → English script (non-English only)', model: config.models.translator },
  { key: 'direction', title: 'Creative direction: cards, zooms, captions, music, SFX', model: config.models.director },
  { key: 'assets', title: 'Fetch real tool & repo visuals (GitHub API + page screenshots)', model: 'local (GitHub API + Chrome)' },
  { key: 'resolve', title: 'Resolve anchors → exact timestamps (EDL)', model: 'local' },
  { key: 'codegen', title: 'Generate Remotion infographics', model: config.models.coder },
  { key: 'render', title: 'Render infographics (Remotion)', model: 'local (Remotion)' },
  { key: 'edit', title: 'Execute EDL in Edits app', model: q === 'high' ? config.models.editorHigh : config.models.editorFast },
  { key: 'verify', title: 'Verify export', model: 'local (ffprobe)' },
];

const save = (job) => { writeJson(path.join(job.dir, 'state.json'), job.state); bus.emit(job.id, job.state); };

export function listJobs() {
  if (!fs.existsSync(JOBS)) return [];
  return fs.readdirSync(JOBS).filter((d) => fs.existsSync(path.join(JOBS, d, 'state.json')))
    .map((d) => JSON.parse(fs.readFileSync(path.join(JOBS, d, 'state.json'), 'utf8')))
    .sort((a, b) => b.createdAt - a.createdAt);
}
export const getJob = (id) => !isSafeId(id) ? null : jobs.get(id)?.state ?? (fs.existsSync(path.join(JOBS, id, 'state.json')) ? JSON.parse(fs.readFileSync(path.join(JOBS, id, 'state.json'), 'utf8')) : null);

const BUDGET_KEYS = ['direction', 'translate', 'codegen', 'edit'];
export function createJob({ script = '', video, quality = 'high', budgets = {}, jobId, dryRun = false, language = 'en' }) {
  // The script is OPTIONAL: without one we transcribe the speech (and translate it to English if it isn't English).
  if (script !== null && typeof script !== 'string') throw new Error('script must be text');
  script = (script ?? '').trim();
  if (typeof language !== 'string' || !/^[a-z]{2,3}$/.test(language)) throw new Error('language must be a 2-3 letter code like "en" or "hi"');
  if (!['high', 'fast'].includes(quality)) throw new Error('quality must be "high" or "fast"');
  video = validateVideoPath(video);
  if (jobId !== undefined && !isSafeId(jobId)) throw new Error('invalid job id');
  const caps = {};
  for (const [k, v] of Object.entries(budgets ?? {})) {
    if (!BUDGET_KEYS.includes(k)) throw new Error(`unknown budget: ${k}`);
    if (!(Number(v) > 0 && Number(v) <= config.budgetCeiling)) throw new Error(`budget ${k} must be between 0 and ${config.budgetCeiling} USD`);
    caps[k] = Number(v);
  }
  const id = jobId || `job-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`;
  const dir = path.join(JOBS, id);
  fs.mkdirSync(path.join(dir, 'clips'), { recursive: true });
  if (script) fs.writeFileSync(path.join(dir, 'script.txt'), script);
  const state = {
    id, createdAt: Date.now(), status: 'queued', quality, dryRun: !!dryRun, language, scriptProvided: !!script, video, script,
    budgets: { direction: config.budgets.direction, translate: config.budgets.translate, codegen: config.budgets.codegen, edit: quality === 'high' ? config.budgets.editHigh : config.budgets.editFast, ...caps },
    steps: STEP_DEFS(quality).map((s) => ({ ...s, status: 'pending', log: [], cost: 0, tokens: { in: 0, out: 0 } })),
  };
  const job = { id, dir, state, abort: new AbortController() };
  jobs.set(id, job);
  save(job);
  return job;
}

export function cancel(id) { jobs.get(id)?.abort.abort(); }

/** Queue a job: strictly one at a time (one Edits app, one Remotion workspace). */
export function startJob(job, opts = {}) {
  if (!STEP_DEFS('high').some((x) => x.key === (opts.from ?? 'probe'))) throw new Error(`unknown step: ${opts.from}`);
  job.state.status = 'queued'; save(job);
  return queue.enqueue(() => runJob(job, opts));
}

/**
 * Jobs saved before a step existed (e.g. 'assets') would silently skip it on resume. Insert any missing step, in canonical
 * order, as 'pending'. Existing steps and their results are untouched. Returns true if anything changed.
 */
export function migrateSteps(state) {
  const defs = STEP_DEFS(state.quality ?? 'high');
  const have = new Map(state.steps.map((x) => [x.key, x]));
  const merged = defs.map((d) => have.get(d.key) ?? { ...d, status: 'pending', log: [], cost: 0, tokens: { in: 0, out: 0 } });
  const extra = state.steps.filter((x) => !defs.some((d) => d.key === x.key)); // unknown legacy steps stay at the end
  const next = [...merged, ...extra];
  const changed = next.length !== state.steps.length || next.some((x, i) => x !== state.steps[i]);
  state.steps = next;
  return changed;
}

/** On boot, anything still 'running'/'queued' was killed with the previous process: mark it resumable instead of stuck forever. */
export function recoverStaleJobs() {
  let n = 0;
  if (!fs.existsSync(JOBS)) return n;
  for (const id of fs.readdirSync(JOBS)) {
    if (!isSafeId(id) || !fs.existsSync(path.join(JOBS, id, 'state.json'))) continue;
    const st = getJob(id);
    if (!st || (st.status !== 'running' && st.status !== 'queued')) continue;
    st.status = 'error'; st.interrupted = true;
    for (const step of st.steps) if (step.status === 'running') { step.status = 'error'; step.error = 'interrupted (server restarted)'; }
    writeJson(path.join(JOBS, id, 'state.json'), st);
    n++;
  }
  return n;
}

export function resumeJob(id, from = 'probe') {
  if (!isSafeId(id)) throw new Error('invalid job id');
  const state = getJob(id);
  if (!state) throw new Error('no such job');
  if (state.status === 'running' || state.status === 'queued') throw new Error(`job is already ${state.status}`);
  migrateSteps(state);
  const job = { id, dir: path.join(JOBS, id), state, abort: new AbortController() };
  jobs.set(id, job);
  startJob(job, { from }).catch(() => {});
  return job;
}

export async function runJob(job, { from = 'probe' } = {}) {
  const s = job.state;
  const startIdx = s.steps.findIndex((x) => x.key === from);
  if (startIdx < 0) throw new Error(`unknown step: ${from}`);
  if (job.abort.signal.aborted) { s.status = 'cancelled'; save(job); return; }
  s.status = 'running'; save(job);
  try {
    for (const step of s.steps.slice(startIdx)) {
      if (s.dryRun && (step.key === 'edit' || step.key === 'verify')) { step.status = 'skipped'; step.log = ['dry run — Edits step skipped']; save(job); continue; }
      step.status = 'running'; step.startedAt = Date.now(); step.log = []; delete step.error; save(job); // a re-run must not show the previous attempt's error
      const log = (m) => { step.log.push(m); if (step.log.length > 80) step.log.shift(); save(job); };
      try {
        const r = await STEPS[step.key](job, step, log);
        if (r?.skipped) { step.status = 'skipped'; step.cost = 0; log(`↷ ${r.skipped}`); continue; }
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
    // Edits is sandboxed: hand it a link to the source inside its staging folder, not the original path.
    const src = stageFile(job.state.video, path.join(stagingFor(job.id), `source${path.extname(job.state.video).toLowerCase()}`));
    await transcribe(src, job.dir, log, job.state.language);
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

  async translate(job, step, log) {
    const st = job.state;
    if (st.language === 'en') return { skipped: 'speech is English — no translation needed' };
    const { words } = JSON.parse(fs.readFileSync(f(job, 'transcript.json'), 'utf8'));
    const cuts = planCuts(words, st.duration);
    const altFile = f(job, 'transcript.alt.json');
    const sents = attachAlt(sentences(words, cuts.toOut), fs.existsSync(altFile) ? JSON.parse(fs.readFileSync(altFile, 'utf8')).words : [], cuts.toOut);
    const cache = f(job, 'sentences.json');
    if (fs.existsSync(cache)) { st.scriptEn = JSON.parse(fs.readFileSync(cache, 'utf8')).map((x) => x.en).join(' '); log('♻️ translation cached'); return; }
    const r = await runClaude({
      model: config.models.translator, system: P.TRANSLATE_SYSTEM, schema: P.TRANSLATE_SCHEMA, effort: 'low',
      prompt: P.translatePrompt({ sentences: sents, language: st.language, reference: st.script }),
      cwd: job.dir, budget: st.budgets.translate ?? config.budgets.translate, onEvent: log, signal: job.abort.signal,
    });
    const out = r.structured ?? JSON.parse(r.text.match(/\{[\s\S]*\}/)[0]);
    const en = new Map(out.sentences.map((x) => [x.n, String(x.en ?? '').trim()]));
    const missing = sents.filter((x) => !en.get(x.n)).map((x) => x.n);
    if (missing.length) throw new Error(`translation is missing sentence(s) ${missing.join(', ')} — re-run this step`);
    const merged = sents.map(({ alt, ...x }) => ({ ...x, en: en.get(x.n) })); // alt is translation input only
    writeJson(cache, merged);
    fs.writeFileSync(f(job, 'script.en.txt'), merged.map((x) => x.en).join('\n'));
    st.scriptEn = merged.map((x) => x.en).join(' ');
    log(`🌐 ${merged.length} sentences → English: “${merged[0].en.slice(0, 90)}…”`);
    return r;
  },

  async direction(job, step, log) {
    if (fs.existsSync(f(job, 'direction.json'))) { log('♻️ direction.json exists — reusing (no tokens spent)'); return; }
    const { words } = JSON.parse(fs.readFileSync(f(job, 'transcript.json'), 'utf8'));
    const cuts = planCuts(words, job.state.duration);
    const library = fs.readFileSync(path.join(REMOTION, 'LIBRARY.md'), 'utf8').split('\n').filter((l) => l.startsWith('- `') || l.startsWith('Icons')).join('\n');
    const indexed = job.state.language !== 'en'; // numbered sentences + "#N" anchors: works in any language
    const sents = indexed && fs.existsSync(f(job, 'sentences.json')) ? JSON.parse(fs.readFileSync(f(job, 'sentences.json'), 'utf8')) : sentences(words, cuts.toOut);
    const r = await runClaude({
      model: config.models.director, system: P.DIRECTOR_SYSTEM, schema: P.DIRECTOR_SCHEMA, effort: 'medium',
      prompt: P.directorPrompt({ sentences: sents, duration: cuts.total, library, indexed, language: job.state.language }),
      cwd: job.dir, budget: job.state.budgets.direction, onEvent: log, signal: job.abort.signal,
    });
    const raw = r.structured ?? JSON.parse(r.text.match(/\{[\s\S]*\}/)[0]);
    const { direction: d, notes } = applyGuardrails(raw, { totalSeconds: cuts.total, scriptWordCount: words.length });
    notes.forEach((n) => log(`🛡 ${n}`));
    writeJson(f(job, 'direction.json'), d);
    job.state.direction = { concept: d.concept, cards: d.scenes.length, zooms: d.zooms.length, sfx: d.sfx.length, captions: `${d.captions.style} · ${d.captions.highlightColor}`, music: `${d.music.query} @ ${d.music.volume} (ducked ${d.music.duckedVolume})` };
    log(`🎬 ${d.concept}`);
    return r;
  },

  async assets(job, step, log) {
    const d = JSON.parse(fs.readFileSync(f(job, 'direction.json'), 'utf8'));
    const files = ['assets.json', 'references.json'].map((n) => f(job, n));
    if (!d.scenes.some((s) => isRefKind(s.kind))) { files.forEach((x) => fs.rmSync(x, { force: true })); job.state.references = []; return { skipped: 'no tool or GitHub repo is referenced' }; }
    const { assets, status } = await gatherAssets({ scenes: d.scenes, jobDir: job.dir, log });
    writeJson(files[0], assets); writeJson(files[1], status);
    job.state.references = Object.entries(status).map(([id, v]) => ({ id, ...v }));
    const ok = job.state.references.filter((r) => r.ok).length;
    log(`${ok}/${job.state.references.length} reference visual(s) ready`);
  },

  async resolve(job, step, log) {
    const { words } = JSON.parse(fs.readFileSync(f(job, 'transcript.json'), 'utf8'));
    const cuts = planCuts(words, job.state.duration);
    const d = JSON.parse(fs.readFileSync(f(job, 'direction.json'), 'utf8'));
    // A reference card is only kept if its real visuals were fetched and verified.
    const refStatus = fs.existsSync(f(job, 'references.json')) ? JSON.parse(fs.readFileSync(f(job, 'references.json'), 'utf8')) : {};
    d.scenes = d.scenes.filter((s) => {
      if (!isRefKind(s.kind) || refStatus[s.id]?.ok === true) return true;
      log(`⚠️ dropped ${s.kind} card ${s.id}: ${refStatus[s.id]?.reason ?? 'its visuals were not fetched'}`);
      return false;
    });
    const edl = buildEdl(d, words, cuts, log, sentences(words, cuts.toOut), job.state.language);
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
      model: config.models.coder, prompt: P.codegenPrompt({ jobId: job.id }), tools: 'Read,Write,Edit',
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
        await sh('node', ['render.mjs', f(job, 'clips'), ...(fs.existsSync(f(job, 'assets.json')) ? [f(job, 'assets.json')] : [])], REMOTION, (l) => {
          try { const e = JSON.parse(l); log(e.finished ? '✅ all scenes rendered' : e.done ? `${e.id} done` : e.skipped ? `${e.id} cached` : `${e.id} ${e.progress}%`); } catch { log(l.slice(0, 160)); }
        }, job.abort.signal);
        return total;
      } catch (e) {
        const msg = (e.stdout || '') + (e.stderr || '') + e.message;
        if (attempt === 1) throw new Error('render failed after repair: ' + msg.slice(0, 300));
        log('⚠️ failed — one cheap Sonnet repair attempt');
        const r = await runClaude({
          model: config.models.coder, prompt: P.repairPrompt(msg), tools: 'Read,Edit', allowed: 'Read Edit(src/Scenes.tsx)',
          cwd: REMOTION, budget: config.budgets.repair, onEvent: log, signal: job.abort.signal, effort: 'low',
        });
        total.cost += r.cost; total.tokens.in += r.tokens.in; total.tokens.out += r.tokens.out;
        fs.copyFileSync(scenesFile, f(job, 'Scenes.tsx'));
      }
    }
  },

  async edit(job, step, log) {
    const edl = JSON.parse(fs.readFileSync(f(job, 'edl.json'), 'utf8'));
    const stage = stagingFor(job.id);
    const tight = stageFile(f(job, 'tight.mp4'), path.join(stage, 'tight.mp4'));
    const clipsDir = stageDir(f(job, 'clips'), path.join(stage, 'clips'));
    const out = path.join(stage, 'final.mp4'); // Edits can write here; it cannot write into jobs/
    fs.rmSync(out, { force: true });
    log(`staged for Edits → ${stage}`);
    const r = await runClaude({
      model: step.model, system: P.editSystem, prompt: P.editPrompt({ tight, clipsDir, edl, out, quality: job.state.quality }),
      mcpServers: editsMcpServers(), allowed: `mcp__${config.editsServer}`, tools: '', cwd: job.dir,
      budget: job.state.budgets.edit, onEvent: log, signal: job.abort.signal,
    });
    log(`↩ ${r.text.slice(0, 300)}`);
    return r;
  },

  async verify(job, step, log) {
    const out = path.join(stagingFor(job.id), 'final.mp4');
    if (!fs.existsSync(out)) throw new Error(`final.mp4 not found at ${out} — the Edits export did not land at the requested path`);
    const info = probeVideo(out);
    log(`final.mp4 ${parseFloat(info.format.duration).toFixed(1)}s ✔  → ${out}`);
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
