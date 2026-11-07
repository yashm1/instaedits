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
import { applyGuardrails } from './guardrails.mjs';
import { gatherAssets, isRefKind } from './references.mjs';
import { transcribe, detectLanguage, planCuts, tighten, sentences, attachAlt, buildEdl, probe as probeVideo } from './media.mjs';
import { captureScreens, SCREENS } from './screens.mjs';
import { runEdit } from './editor.mjs';
import { checkExport } from './qa.mjs';

const REMOTION = config.remotionDir;
const JOBS = config.jobsDir;
const queue = createQueue();

export const bus = new EventEmitter();
const jobs = new Map();

export const STEPS_FOR_TEST = () => STEPS;
export const STEP_DEFS = (q) => [
  { key: 'probe', title: 'Probe video', model: 'local (ffprobe)' },
  { key: 'transcribe', title: 'Word-level transcript', model: 'local (Edits captions model)' },
  { key: 'tighten', title: 'Cut dead air → tight.mp4', model: 'local (ffmpeg)' },
  { key: 'translate', title: 'Translate speech → English script (non-English only)', model: config.models.translator },
  { key: 'direction', title: 'Understand the video + creative direction (cards, screenshots, music, SFX)', model: config.models.director },
  { key: 'assets', title: 'Fetch real tool & repo visuals (GitHub API + page screenshots)', model: 'local (GitHub API + Chrome)' },
  { key: 'resolve', title: 'Resolve anchors → exact timestamps (EDL)', model: 'local' },
  { key: 'render', title: 'Render the reel: split-screen infographics + speaker (Remotion)', model: 'local (Remotion)' },
  { key: 'edit', title: 'Edits app: Hinglish captions, music, SFX, export', model: `local (Edits tool calls) + ${config.models.captions} for Hinglish` },
  { key: 'verify', title: q === 'high' ? 'QA: check the export + watch it before publishing' : 'QA: check the export', model: q === 'high' ? `local (ffmpeg) + ${config.models.reviewer}` : 'local (ffmpeg)' },
];

const save = (job) => { writeJson(path.join(job.dir, 'state.json'), job.state); bus.emit(job.id, job.state); };

export function listJobs() {
  if (!fs.existsSync(JOBS)) return [];
  return fs.readdirSync(JOBS).filter((d) => fs.existsSync(path.join(JOBS, d, 'state.json')))
    .map((d) => JSON.parse(fs.readFileSync(path.join(JOBS, d, 'state.json'), 'utf8')))
    .sort((a, b) => b.createdAt - a.createdAt);
}
export const getJob = (id) => !isSafeId(id) ? null : jobs.get(id)?.state ?? (fs.existsSync(path.join(JOBS, id, 'state.json')) ? JSON.parse(fs.readFileSync(path.join(JOBS, id, 'state.json'), 'utf8')) : null);

const BUDGET_KEYS = ['direction', 'translate', 'captions', 'review'];
/** Creator links ("this repo" = …): https URLs or owner/name, max 5. Terms: names to spell right, max 30. */
export function normaliseExtras({ links = [], terms = [] } = {}) {
  const arr = (x) => (Array.isArray(x) ? x : String(x ?? '').split(/[\n,]+/)).map((v) => String(v).trim()).filter(Boolean);
  const L = arr(links).map((u) => (/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(u) ? `https://github.com/${u}` : u));
  for (const u of L) { let ok = false; try { ok = new URL(u).protocol === 'https:'; } catch {} if (!ok) throw new Error(`link must be an https URL or owner/name: ${u.slice(0, 80)}`); }
  const T = arr(terms);
  if (L.length > 5) throw new Error('at most 5 links');
  if (T.length > 30 || T.some((t) => t.length > 40)) throw new Error('at most 30 terms, each ≤ 40 characters');
  return { links: L, terms: T };
}

export function createJob({ script = '', video, quality = 'high', budgets = {}, jobId, dryRun = false, language = 'auto', links = [], terms = [] }) {
  // The script is OPTIONAL: without one we transcribe the speech (and translate it to English if it isn't English).
  if (script !== null && typeof script !== 'string') throw new Error('script must be text');
  script = (script ?? '').trim();
  if (typeof language !== 'string' || !(language === 'auto' || /^[a-z]{2,3}$/.test(language))) throw new Error('language must be "auto" or a 2-3 letter code like "en" or "hi"');
  if (!['high', 'fast'].includes(quality)) throw new Error('quality must be "high" or "fast"');
  video = validateVideoPath(video);
  if (jobId !== undefined && !isSafeId(jobId)) throw new Error('invalid job id');
  const caps = {};
  for (const [k, v] of Object.entries(budgets ?? {})) {
    if (!BUDGET_KEYS.includes(k)) throw new Error(`unknown budget: ${k}`);
    if (!(Number(v) > 0 && Number(v) <= config.budgetCeiling)) throw new Error(`budget ${k} must be between 0 and ${config.budgetCeiling} USD`);
    caps[k] = Number(v);
  }
  const extras = normaliseExtras({ links, terms });
  const id = jobId || `job-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`;
  const dir = path.join(JOBS, id);
  fs.mkdirSync(path.join(dir, 'clips'), { recursive: true });
  if (script) fs.writeFileSync(path.join(dir, 'script.txt'), script);
  const state = {
    id, createdAt: Date.now(), status: 'queued', quality, dryRun: !!dryRun, language, scriptProvided: !!script, video, script,
    links: extras.links, terms: extras.terms.length ? extras.terms : config.defaultTerms,
    budgets: { ...config.budgets, ...caps },
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
  const next = merged; // steps that no longer exist (e.g. the old 'codegen') are dropped: there is nothing left to run
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
    const st = job.state;
    // 'auto' (the default) transcribes with the English model — in practice it handles Hindi and keeps English terms — then detects the script.
    const t = await transcribe(src, job.dir, log, st.language === 'auto' ? 'en' : st.language);
    const detected = detectLanguage(t.words);
    if ((st.language === 'auto' || st.language === 'en') && detected !== 'en') {
      log(`🌐 the speech is ${detected}, not English — switching to translate-to-English mode`);
      st.language = detected; st.languageDetected = true;
    } else if (st.language === 'auto') st.language = 'en';
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
      prompt: P.translatePrompt({ sentences: sents, language: st.language, reference: st.script, terms: st.terms ?? config.defaultTerms }),
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
    const st = job.state;
    // Real screenshots of the Edits app the director may show (the transcribe step left the source open in the editor).
    const shots = await captureScreens({ log });
    st.screens = Object.keys(shots);
    const available = Object.fromEntries(st.screens.map((k) => [k, SCREENS[k]]));
    if (fs.existsSync(f(job, 'direction.json'))) { log('♻️ direction.json exists — reusing (no tokens spent)'); return; }
    const { words } = JSON.parse(fs.readFileSync(f(job, 'transcript.json'), 'utf8'));
    const cuts = planCuts(words, st.duration);
    const library = fs.readFileSync(path.join(REMOTION, 'LIBRARY.md'), 'utf8').split('\n').filter((l) => l.startsWith('- `') || l.startsWith('Icons')).join('\n');
    const indexed = st.language !== 'en';
    const sents = indexed && fs.existsSync(f(job, 'sentences.json')) ? JSON.parse(fs.readFileSync(f(job, 'sentences.json'), 'utf8')) : sentences(words, cuts.toOut);
    const r = await runClaude({
      model: config.models.director, system: P.DIRECTOR_SYSTEM, schema: P.DIRECTOR_SCHEMA, effort: 'medium',
      prompt: P.directorPrompt({ sentences: sents, duration: cuts.total, library, indexed, language: st.language, screens: available, links: st.links ?? [], terms: st.terms ?? [] }),
      cwd: job.dir, budget: st.budgets.direction, onEvent: log, signal: job.abort.signal,
    });
    const raw = r.structured ?? JSON.parse(r.text.match(/\{[\s\S]*\}/)[0]);
    const { direction: d, notes } = applyGuardrails(raw, { totalSeconds: cuts.total, scriptWordCount: words.length, screens: available });
    notes.forEach((n) => log(`🛡 ${n}`));
    writeJson(f(job, 'direction.json'), d);
    st.direction = { concept: d.concept, cards: d.scenes.length, zooms: d.zooms.length, sfx: d.sfx.length, captions: d.captions.style, music: `${d.music.query} @ ${d.music.volume} (ducked ${d.music.duckedVolume})` };
    log(`🎬 ${d.concept}`);
    return r;
  },

  async assets(job, step, log) {
    const d = JSON.parse(fs.readFileSync(f(job, 'direction.json'), 'utf8'));
    // Screens used by the plan → into the job folder (Remotion's public dir for this render)
    fs.rmSync(f(job, 'screens'), { recursive: true, force: true });
    const shots = [...new Set(d.scenes.filter((s) => s.kind === 'Screen').map((s) => s.props.shot))];
    if (shots.length) {
      fs.mkdirSync(f(job, 'screens'));
      for (const k of shots) { const src = path.join(config.screensDir, `${k}.png`); if (fs.existsSync(src)) fs.copyFileSync(src, f(job, 'screens', `${k}.png`)); }
      log(`📸 ${shots.length} real screenshot(s): ${shots.join(', ')}`);
    }
    const files = ['assets.json', 'references.json'].map((n) => f(job, n));
    if (!d.scenes.some((s) => isRefKind(s.kind))) { files.forEach((x) => fs.rmSync(x, { force: true })); job.state.references = []; return shots.length ? undefined : { skipped: 'no tool, repo or screenshot is referenced' }; }
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
    // A reference card is only kept if its real visuals were fetched and verified; a Screen card only if its image is here.
    const refStatus = fs.existsSync(f(job, 'references.json')) ? JSON.parse(fs.readFileSync(f(job, 'references.json'), 'utf8')) : {};
    d.scenes = d.scenes.filter((s) => {
      if (s.kind === 'Screen') { const ok = fs.existsSync(f(job, 'screens', `${s.props.shot}.png`)); if (!ok) log(`⚠️ dropped Screen card ${s.id}: screenshot missing`); return ok; }
      if (!isRefKind(s.kind) || refStatus[s.id]?.ok === true) return true;
      log(`⚠️ dropped ${s.kind} card ${s.id}: ${refStatus[s.id]?.reason ?? 'its visuals were not fetched'}`);
      return false;
    });
    const edl = buildEdl(d, words, cuts, log, sentences(words, cuts.toOut), job.state.language);
    writeJson(f(job, 'edl.json'), edl);
    writeJson(f(job, 'reel.json'), reelProps(job, edl));
    fs.rmSync(f(job, 'reel.mp4'), { force: true }); // stale render from an older plan
    log(`${edl.scenes.length} cards · ${edl.zooms.length} zooms · ${edl.sfx.length} sfx`);
    job.state.edl = { cards: edl.scenes.map((s) => `${s.start}s ${s.kind}${s.word ? ` on “${s.word}”` : ''} (${s.dur}s)`), zooms: edl.zooms.length, sfx: edl.sfx.length };
  },

  async render(job, step, log) {
    if (fs.existsSync(f(job, 'reel.mp4')) && fs.statSync(f(job, 'reel.mp4')).mtimeMs > fs.statSync(f(job, 'reel.json')).mtimeMs) { log('♻️ reel.mp4 cached'); return; }
    log('typecheck…');
    execFileSync('npx', ['tsc', '--noEmit'], { cwd: REMOTION, encoding: 'utf8', stdio: 'pipe' });
    const raw = f(job, 'reel.raw.mp4');
    await sh('node', ['render.mjs', f(job, 'reel.json'), job.dir, raw], REMOTION, (l) => {
      try { const e = JSON.parse(l); log(e.finished ? '✅ rendered' : `render ${e.progress}%`); } catch { log(l.slice(0, 160)); }
    }, job.abort.signal);
    // voice to -14 LUFS (Instagram's loudness), picture untouched
    log('loudness → -14 LUFS…');
    await sh('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', f(job, 'reel.mp4')], job.dir, () => {}, job.abort.signal);
    fs.rmSync(raw, { force: true });
  },

  async edit(job, step, log) {
    const st = job.state;
    const edl = JSON.parse(fs.readFileSync(f(job, 'edl.json'), 'utf8'));
    const stage = stagingFor(job.id);
    const video = stageFile(f(job, 'reel.mp4'), path.join(stage, 'reel.mp4'));
    const out = path.join(stage, 'final.mp4'); // Edits can write here; it cannot write into jobs/
    fs.rmSync(out, { force: true });
    log(`staged for Edits → ${stage}`);
    const { words } = JSON.parse(fs.readFileSync(f(job, 'transcript.json'), 'utf8'));
    const cuts = planCuts(words, st.duration);
    const reelWords = words.map((w) => ({ start: cuts.toOut(w.start), end: cuts.toOut(w.end) }));
    const usage = { cost: 0, tokens: { in: 0, out: 0 } };
    const transliterate = async (lines) => {
      const r = await runClaude({
        model: config.models.captions, system: P.TRANSLIT_SYSTEM, schema: P.TRANSLIT_SCHEMA, effort: 'low',
        prompt: P.translitPrompt({ lines, terms: st.terms ?? [] }), cwd: job.dir, budget: st.budgets.captions ?? config.budgets.captions, onEvent: () => {}, signal: job.abort.signal,
      });
      usage.cost += r.cost ?? 0; usage.tokens.in += r.tokens?.in ?? 0; usage.tokens.out += r.tokens?.out ?? 0;
      const o = r.structured ?? JSON.parse(r.text.match(/\{[\s\S]*\}/)[0]);
      const byN = new Map(o.lines.map((x) => [x.n, x.words]));
      return lines.map((_, i) => byN.get(i + 1) ?? null);
    };
    const { report } = await runEdit({ video, edl, out, words: reelWords, transliterate, log });
    st.editorReport = report.join('\n');
    return usage;
  },

  async verify(job, step, log) {
    const st = job.state;
    const out = path.join(stagingFor(job.id), 'final.mp4');
    if (!fs.existsSync(out)) throw new Error(`final.mp4 not found at ${out} — the Edits export did not land at the requested path`);
    const edl = JSON.parse(fs.readFileSync(f(job, 'edl.json'), 'utf8'));
    const qa = await checkExport({ final: out, reel: f(job, 'reel.mp4'), scenes: edl.scenes, dir: job.dir });
    log(`colour ${qa.colourRatio}× of the render · ${qa.cards.filter((c) => c.similarity >= 0.55).length}/${qa.cards.length} cards on screen at their time`);
    st.qa = { ok: qa.ok, problems: qa.problems };
    if (!qa.ok) throw new Error(`QA failed: ${qa.problems.join('; ')}`);
    st.output = out;
    if (st.quality !== 'high' || !qa.frames.length) { log(`final.mp4 ✔ → ${out}`); return; }
    // watch it: a vision model checks each card against what is being said at that moment
    const sents = sentences(JSON.parse(fs.readFileSync(f(job, 'transcript.json'), 'utf8')).words, planCuts(JSON.parse(fs.readFileSync(f(job, 'transcript.json'), 'utf8')).words, st.duration).toOut);
    const en = fs.existsSync(f(job, 'sentences.json')) ? JSON.parse(fs.readFileSync(f(job, 'sentences.json'), 'utf8')) : sents;
    const saidAt = (t) => { const s = [...en].reverse().find((x) => x.t <= t + 0.05) ?? en[0]; return s?.en ?? s?.text ?? ''; };
    const r = await runClaude({
      model: config.models.reviewer, schema: P.REVIEW_SCHEMA, tools: 'Read', allowed: 'Read', effort: 'low',
      prompt: P.reviewPrompt({ contact: qa.contact, frames: qa.frames.map((x) => ({ ...x, said: saidAt(x.t) })), concept: st.direction?.concept ?? '' }),
      cwd: job.dir, budget: st.budgets.review ?? config.budgets.review, onEvent: () => {}, signal: job.abort.signal,
    });
    const v = r.structured ?? JSON.parse(r.text.match(/\{[\s\S]*\}/)[0]);
    st.review = v;
    log(v.verdict === 'publish' ? '👀 review: ready to publish' : `👀 review: ${v.issues.length} issue(s)`);
    v.issues.forEach((i) => log(`  • ${i}`));
    log(`final.mp4 ✔ → ${out}`);
    return r;
  },
};

/** Remotion inputProps for the whole reel. Paths are relative to the job folder (the render's public dir). */
function reelProps(job, edl) {
  const assets = fs.existsSync(f(job, 'assets.json')) ? JSON.parse(fs.readFileSync(f(job, 'assets.json'), 'utf8')) : undefined;
  const screens = {};
  for (const s of edl.scenes.filter((x) => x.kind === 'Screen')) {
    const file = `screens/${s.props.shot}.png`;
    const [w, h] = pngSize(f(job, file));
    screens[s.props.shot] = { file, w, h, focus: SCREENS[s.props.shot]?.focus };
  }
  return { video: 'tight.mp4', duration: edl.duration, scenes: edl.scenes.map(({ id, start, dur, kind, props }) => ({ id, start, dur, kind, props })), zooms: edl.zooms, assets, screens };
}
/** Width/height from a PNG header (no dependency). */
export function pngSize(file) {
  const b = fs.readFileSync(file).subarray(0, 24);
  return b.toString('ascii', 1, 4) === 'PNG' ? [b.readUInt32BE(16), b.readUInt32BE(20)] : [1600, 1000];
}

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
