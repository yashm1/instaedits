// Hard rules applied to the director's output. The prompt asks; this file enforces.
// Every number here comes from rules several independent editing guides agree on (see docs/research.md).
import { config } from './config.mjs';
import { isRefKind, parseRepo } from './references.mjs';
import { FX_CATALOG, FX_LIMITS } from './effects.mjs';

export const LIMITS = {
  musicMax: 0.16, duckRatio: 0.6,
  sfxMin: 0.15, sfxMax: 0.45, sfxPerSeconds: 6, sfxFloor: 2,
  zoomMin: 1.10, zoomMax: 1.18, zoomDurMin: 1.5, zoomDurMax: 4, // punch-ins 10-20 %, held (docs/research-retention.md)
  readWps: 2.5, readMin: 1.8, // text must stay up long enough to read: ≥1 s per 2-3 words
  cardDurMin: 1.5, cardDurMax: 5.5, // split layout: the speaker stays visible, so cards may hold longer
  keywordShare: 0.1, // ≤10% of spoken words may be emphasised
  hookWordsMax: 4, maxSameKindInRow: 2,
  maxFullCards: 2, fullDurMin: 2.5, // full-screen cards hide the speaker: rare and readable
};

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const isHttps = (u) => { try { return new URL(String(u)).protocol === 'https:'; } catch { return false; } };
/** Words a viewer must read on a card (titles, labels, points, items — not code). */
export function wordsOnCard(s) {
  const p = s.props ?? {}, acc = [];
  const add = (v) => { if (typeof v === 'string') acc.push(v); else if (Array.isArray(v)) v.forEach(add); else if (v && typeof v === 'object') ['label', 'title', 'note', 'text'].forEach((k) => add(v[k])), add(v.points); };
  ['text', 'sub', 'title', 'label', 'caption', 'items'].forEach((k) => add(p[k])); add(p.nodes); add(p.steps); add(p.bars); add(p.from); add(p.to); add(p.left); add(p.right);
  return acc.join(' ').split(/\s+/).filter(Boolean).length;
}
const REQUIRED = { Hook: ['text'], Title: ['text'], Flow: ['nodes'], Fanout: ['from', 'to'], Steps: ['steps'], Chart: ['bars'], Code: ['code'], Stat: ['value', 'label'], Bullets: ['items'], Compare: ['left', 'right'], Repo: ['repo'], Site: ['url'], Screen: ['shot'] };
/** Reason string if a card lacks a prop its component needs (or a list prop is empty), else null. */
export function missingProps(s) {
  const p = s.props ?? {};
  const miss = (REQUIRED[s.kind] ?? []).filter((k) => p[k] == null || p[k] === '' || (Array.isArray(p[k]) && !p[k].length));
  return miss.length ? `missing ${miss.join(', ')}` : null;
}
const words = (t) => String(t ?? '').trim().split(/\s+/).filter(Boolean);

/** Returns { direction, notes } — a corrected deep copy plus a human-readable list of what was changed/flagged. */
export function applyGuardrails(input, { totalSeconds, scriptWordCount, screens = {}, effectsAvailable = false }) {
  const d = structuredClone(input), notes = [];
  const L = LIMITS;

  // cards
  d.scenes = (d.scenes ?? []).map((s) => {
    const need = Math.min(L.cardDurMax, Math.max(L.readMin, wordsOnCard(s) / L.readWps)); // reading time
    if (s.dur < need) { notes.push(`card ${s.id}: ${wordsOnCard(s)} words need ${need.toFixed(1)}s to read — was ${s.dur}s`); s = { ...s, dur: +need.toFixed(1) }; }
    const dur = clamp(s.dur, L.cardDurMin, L.cardDurMax);
    if (dur !== s.dur) notes.push(`card ${s.id}: duration ${s.dur}s → ${dur}s`);
    return { ...s, dur };
  });
  // GitHub repos are shown as the REAL repo page (a screenshot), not a stats card: the creator asked for the actual page,
  // and a young repo's "★ 0" weakens the proof. A Repo card becomes a Site card for https://github.com/owner/name.
  d.scenes = d.scenes.map((s) => {
    if (s.kind !== 'Repo' || !parseRepo(s.props?.repo)) return s;
    const repo = parseRepo(s.props.repo);
    notes.push(`card ${s.id}: GitHub repo ${repo} shown as its real page screenshot`);
    return { ...s, kind: 'Site', props: { url: `https://github.com/${repo}`, name: repo, tag: s.props.tag ?? 'GITHUB' } };
  });
  // real-world references: valid shape only, capped; anything dropped here also loses its attached sfx
  const droppedIds = new Set(); let refs = 0;
  d.scenes = d.scenes.filter((s) => {
    if (!isRefKind(s.kind)) return true;
    const valid = s.kind === 'Repo' ? !!parseRepo(s.props?.repo) : isHttps(s.props?.url);
    const reason = !valid ? 'invalid reference' : refs >= config.maxReferenceCards ? `over the ${config.maxReferenceCards}-reference limit` : null;
    if (reason) { notes.push(`${s.kind} card ${s.id} dropped: ${reason}`); droppedIds.add(s.id); return false; }
    if (s.kind === 'Repo') s.props.repo = parseRepo(s.props.repo); // normalise (accepts a github.com URL)
    else s.props.url = new URL(s.props.url).href; // canonical form = the key the fetched assets are stored under
    refs++; return true;
  });
  // full-screen cards: at most 2 (they hide the speaker), each long enough to read
  let fulls = 0;
  for (const s of d.scenes) {
    if (s.layout !== 'full') { delete s.layout; continue; }
    if (++fulls > LIMITS.maxFullCards) { notes.push(`card ${s.id}: more than ${LIMITS.maxFullCards} full-screen cards — shown split`); delete s.layout; continue; }
    if (s.dur < LIMITS.fullDurMin) { notes.push(`card ${s.id}: full-screen card lengthened to ${LIMITS.fullDurMin}s`); s.dur = LIMITS.fullDurMin; }
  }
  // a Hook backdrop must be a real captured screenshot — otherwise drop just the backdrop, keep the hook
  for (const s of d.scenes) if (s.kind === 'Hook' && s.props?.shot && !screens[s.props.shot]) { notes.push(`hook ${s.id}: backdrop "${s.props.shot}" not available — removed`); delete s.props.shot; }
  // Screen cards: only real captured shots; required props per kind (a malformed card would render blank)
  d.scenes = d.scenes.filter((s) => {
    const why = s.kind === 'Screen' && !screens[s.props?.shot] ? `screenshot "${s.props?.shot}" is not available` : missingProps(s);
    if (why) { notes.push(`${s.kind} card ${s.id} dropped: ${why}`); droppedIds.add(s.id); return false; }
    return true;
  });
  d.sfx = (d.sfx ?? []).filter((x) => !droppedIds.has(x.on_scene));
  const first = d.scenes[0];
  if (first && first.kind !== 'Hook') notes.push(`warning: first card is ${first.kind}, not a Hook`);
  if (first?.kind === 'Hook' && words(first.props?.text).length > L.hookWordsMax) {
    const cut = words(first.props.text).slice(0, L.hookWordsMax).join(' ');
    notes.push(`opening hook trimmed to ${L.hookWordsMax} words: "${cut}"`);
    first.props.text = cut;
    if (Array.isArray(first.props.hot)) first.props.hot = first.props.hot.filter((h) => cut.toLowerCase().includes(String(h).toLowerCase()));
  }
  let run = 1;
  d.scenes.forEach((s, i) => {
    run = i && d.scenes[i - 1].kind === s.kind ? run + 1 : 1;
    if (run > L.maxSameKindInRow) notes.push(`warning: ${run} ${s.kind} cards in a row at ${s.id}`);
  });

  // face-tracked effects: only when the pack is installed; known names, 1.5-4 s, ≤4, text trimmed to the effect's limit
  const fx = [];
  for (const e of d.effects ?? []) {
    const spec = FX_CATALOG[e?.fx];
    if (!effectsAvailable) { if (e) notes.push(`effect ${e.fx}: the effects pack is not installed — skipped`); continue; }
    if (!spec) { notes.push(`effect "${e?.fx}" is not in the catalog — dropped`); continue; }
    if (fx.length >= FX_LIMITS.max) { notes.push(`effect ${e.fx}: more than ${FX_LIMITS.max} effects — dropped`); continue; }
    const out = { fx: e.fx, anchor: e.anchor, ...(e.word ? { word: e.word } : {}), dur: clamp(Number(e.dur) || 2.5, FX_LIMITS.durMin, FX_LIMITS.durMax) };
    if (spec.text && e.text) out.text = String(e.text).slice(0, spec.max);
    if (e.opts && typeof e.opts === 'object') out.opts = Object.fromEntries(Object.entries(e.opts).filter(([k, v]) => /^[a-z_]{1,12}$/.test(k) && ['string', 'number'].includes(typeof v)).map(([k, v]) => [k, String(v).slice(0, 24)]));
    fx.push(out);
  }
  d.effects = fx;

  // zooms
  d.zooms = (d.zooms ?? []).map((z) => ({ ...z, scale: clamp(z.scale, L.zoomMin, L.zoomMax), dur: clamp(z.dur, L.zoomDurMin, L.zoomDurMax) }));

  // sfx: sparse, subtle. Keep ≤1 riser, cap total by length (≈5 per 30s), prefer card entries.
  const cap = Math.max(L.sfxFloor, Math.ceil(totalSeconds / L.sfxPerSeconds));
  let sfx = (d.sfx ?? []).map((x) => ({ ...x, volume: clamp(x.volume, L.sfxMin, L.sfxMax) }));
  let risers = 0;
  sfx = sfx.filter((x) => (/^Riser/.test(x.name) ? ++risers <= 1 : true));
  if (sfx.length > cap) {
    const rank = (x) => (/^Riser/.test(x.name) ? 0 : x.edge === 'out' ? 2 : 1);
    const keep = new Set([...sfx].sort((a, b) => rank(a) - rank(b)).slice(0, cap));
    notes.push(`sfx ${sfx.length} → ${cap} (sparse sound design)`);
    sfx = sfx.filter((x) => keep.has(x));
  }
  d.sfx = sfx;

  // music: must sit well under the voice
  if (d.music) {
    const v = clamp(d.music.volume, 0, L.musicMax);
    if (v !== d.music.volume) notes.push(`music volume ${d.music.volume} → ${v}`);
    d.music.volume = v;
    d.music.duckedVolume = Math.min(d.music.duckedVolume, +(v * L.duckRatio).toFixed(3));
  }
  return { direction: d, notes };
}
