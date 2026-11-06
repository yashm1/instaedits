// Hard rules applied to the director's output. The prompt asks; this file enforces.
// Every number here comes from rules several independent editing guides agree on (see docs/research.md).
export const LIMITS = {
  musicMax: 0.16, duckRatio: 0.6,
  sfxMin: 0.15, sfxMax: 0.45, sfxPerSeconds: 6, sfxFloor: 2,
  zoomMin: 1.06, zoomMax: 1.14, zoomDurMin: 0.6, zoomDurMax: 1.8,
  cardDurMin: 1.5, cardDurMax: 4.5,
  keywordShare: 0.1, // ≤10% of spoken words may be emphasised
  hookWordsMax: 4, maxSameKindInRow: 2,
};

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const words = (t) => String(t ?? '').trim().split(/\s+/).filter(Boolean);

/** Returns { direction, notes } — a corrected deep copy plus a human-readable list of what was changed/flagged. */
export function applyGuardrails(input, { totalSeconds, scriptWordCount }) {
  const d = structuredClone(input), notes = [];
  const L = LIMITS;

  // cards
  d.scenes = (d.scenes ?? []).map((s) => {
    const dur = clamp(s.dur, L.cardDurMin, L.cardDurMax);
    if (dur !== s.dur) notes.push(`card ${s.id}: duration ${s.dur}s → ${dur}s`);
    return { ...s, dur };
  });
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

  // captions: ≤10% of words emphasised
  if (d.captions) {
    const max = Math.max(3, Math.floor(scriptWordCount * L.keywordShare));
    if (d.captions.keywords.length > max) { notes.push(`caption keywords ${d.captions.keywords.length} → ${max} (≤10% of words)`); d.captions.keywords = d.captions.keywords.slice(0, max); }
  }

  // music: must sit well under the voice
  if (d.music) {
    const v = clamp(d.music.volume, 0, L.musicMax);
    if (v !== d.music.volume) notes.push(`music volume ${d.music.volume} → ${v}`);
    d.music.volume = v;
    d.music.duckedVolume = Math.min(d.music.duckedVolume, +(v * L.duckRatio).toFixed(3));
  }
  return { direction: d, notes };
}
