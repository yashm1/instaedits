// Executes the edit in the Edits app with plain tool calls — no LLM. Every value is exact and every step is checked.
// Why: an LLM executor improvised (it set saturation 0.04 — a MULTIPLIER in Edits — and turned the video black and white,
// and snapped a card 9 s late). The picture (speaker + cards, split layout) is already final from Remotion; Edits adds
// what it is best at: captions, licensed music, SFX, voice polish, and the export.
import fs from 'node:fs';
import { tool as editsTool } from './edits-mcp.mjs';
import { isTransient } from './media.mjs';
import { lineSplits, splitWindows, captionY, latinLine, hasDevanagari } from './captions.mjs';
import { CAPTION_STYLES } from './catalog.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const capsOf = async (tool) => ((await tool('captions', {}))?.captions ?? []).slice().sort((a, b) => a.startTime - b.startTime);

/**
 * @param o.video  staged reel.mp4 (final picture + loudness-normalised voice)
 * @param o.edl    { duration, language, scenes, sfx, captions:{style}, music }
 * @param o.words  [{start,end}] spoken words on the reel timeline (for caption line breaks)
 * @param o.transliterate async (lines: string[][]) => string[][] | null — Latin Hinglish for non-English captions
 * @returns { report: string[] }
 */
export async function runEdit({ video, edl, out, words = [], transliterate = null, log = () => {}, tool = editsTool, sleep = wait, exportTimeoutMs = 15 * 60_000 }) {
  const report = [];
  const note = (m) => { report.push(m); log(m); };
  const soft = async (what, fn) => { try { return await fn(); } catch (e) { note(`⚠️ ${what}: ${String(e.message).replace(/\s+/g, ' ').slice(0, 140)}`); return null; } };

  // 1. project + the finished picture
  await tool('newProject');
  await tool('setAspectRatio', { ratio: '9:16' });
  const imp = await tool('importMedia', { path: video });
  const id = imp?.id;
  if (!id) throw new Error('importMedia returned no clip id: ' + JSON.stringify(imp).slice(0, 160));
  log('imported the reel');
  // never grade: the colour is the camera's. Verify nothing upstream left a filter on the clip.
  const adj = await soft('adjust check', () => tool('getAdjustState', { id }));
  if (adj && adj.isDefault === false) note(`⚠️ the clip has non-default adjustments (saturation ${adj.saturation}) — check the colour`);

  // 2. voice polish (loudness is already -14 LUFS from the render step)
  await soft('voice enhance', async () => {
    await tool('selectById', { id, addToSelection: false });
    await tool('selectTool', { tool: 'volume' }); // Voice Enhance lives in the Volume panel, which must be presented first
    await tool('setVoiceEnhance', { reduceNoise: 0.35, enhanceVoice: 0.5 });
    await tool('dismissVolumePanel', {}).catch(() => {});
    log('voice enhance on');
  });

  // 3. captions: generate (cloud — retry), short lines at real word gaps, Latin Hinglish, style, position
  const lang = edl.language ?? 'en';
  let caps = [];
  for (let i = 1; i <= 4 && !caps.length; i++) {
    try {
      if (i > 1) { log(`captions: retry ${i}/4…`); await sleep(4000 * (i - 1)); }
      await tool('generateCaptions', { source: 'video', language: lang, curseWords: false });
      caps = await capsOf(tool);
    } catch (e) { if (!isTransient(e.message) || i === 4) throw new Error(`captions failed: ${e.message.slice(0, 160)}`); }
  }
  if (!caps.length) throw new Error('Edits generated no captions (4 attempts)');
  let splits = 0;
  for (const c of [...caps]) {
    const inside = words.filter((w) => w.start >= c.startTime - 0.05 && w.end <= c.endTime + 0.05);
    for (const t of lineSplits(inside, 3)) {
      const cur = (await capsOf(tool)).find((x) => x.startTime < t && x.endTime > t);
      if (!cur) continue;
      const r = await tool('splitCaption', { id: cur.id, time: t }).catch(() => null);
      if (r?.ok) splits++;
    }
  }
  caps = await capsOf(tool);
  log(`captions: ${caps.length} lines (${splits} splits)`);
  if (lang !== 'en' || caps.some((c) => c.tokens.some((t) => hasDevanagari(t.text)))) {
    const lines = caps.map((c) => c.tokens.map((t) => t.text));
    const llm = transliterate ? await soft('Hinglish transliteration', () => transliterate(lines)) : null;
    let fallback = 0;
    for (const [i, c] of caps.entries()) {
      const latin = latinLine(lines[i], llm?.[i]);
      if (!llm?.[i] || latin.join(' ') !== llm[i].map((w) => String(w).trim()).join(' ')) fallback++;
      await tool('editCaption', { id: c.id, text: latin.join(' ') });
    }
    note(`captions in Latin-script Hinglish${fallback ? ` (${fallback} line(s) via the rule-based fallback)` : ''}`);
  }
  // only readable styles; plans made before the catalog was narrowed are corrected here. The app's own highlight colour is kept.
  const style = CAPTION_STYLES.includes(edl.captions?.style) ? edl.captions.style : CAPTION_STYLES[0];
  await tool('setCaptionStyle', { style });
  const wins = splitWindows(edl.scenes ?? []);
  for (const c of await capsOf(tool)) await tool('setTextPosition', { id: c.id, x: 0.5, y: captionY(c, wins) });
  const left = (await capsOf(tool)).filter((c) => c.tokens.some((t) => hasDevanagari(t.text)));
  if (left.length && lang !== 'en') note(`⚠️ ${left.length} caption line(s) still contain Devanagari`);

  // 4. music: one licensed instrumental bed under the voice
  const m = edl.music;
  if (m) {
    await soft('music', async () => {
      let pick = null;
      for (const q of [m.query, ...(m.fallbacks ?? [])]) {
        const res = (await tool('searchMusic', { query: q }))?.results ?? [];
        pick = res.find((r) => r.relevant !== false)?.title; if (pick) break;
      }
      if (!pick) throw new Error('no track found');
      const det = await tool('getMusicTrackDetails', { track: pick });
      const song = await tool('addSongToComposition', { track: pick, audioAssetId: String(det.audioAssetId ?? det.id) });
      await tool('setVolume', { id: song.id, volume: m.volume });
      await tool('setFade', { id: song.id, fadeIn: m.fadeIn, fadeOut: m.fadeOut });
      await soft('ducking', () => tool('setDucking', { id: song.id, behavior: 'video', level: m.duckedVolume }));
      note(`music: "${pick}" @ ${m.volume}, ducked to ${m.duckedVolume}`);
    });
  }

  // 5. SFX at exact times
  let placed = 0;
  for (const x of edl.sfx ?? []) {
    await soft(`sfx ${x.name} @${x.at}s`, async () => {
      await tool('seek', { seconds: x.at });
      const r = await tool('addSoundEffect', { effect: x.name });
      if (r?.id) await tool('setVolume', { id: r.id, volume: x.volume });
      placed++;
    });
  }
  if (edl.sfx?.length) log(`sfx: ${placed}/${edl.sfx.length} placed`);

  // 6. export (HEVC is what the app offers; 1080x1920 30 fps, 20 Mbit/s — well above the app default) and wait for it
  // a COMPLETE preset (verified values): a partial one makes export() fail with "incomplete preset row"
  await tool('setExportSettings', { quality: 'high', frameRate: 30, resolution: '1080x1920', resolutionType: 'HD', aspectRatio: 'nineBySixteen', dynamicRange: 'SDR', bitrate: 20_000_000 });
  await tool('export', { path: out });
  const t0 = Date.now(); let st = null;
  while (Date.now() - t0 < exportTimeoutMs) {
    await sleep(2000);
    st = await tool('exportStatus', {}).catch(() => null);
    const s = String(st?.state ?? st?.status ?? '').toLowerCase();
    if (/complete|finish|done|success/.test(s)) break;
    if (s === 'idle' && Date.now() - t0 > 6000 && fs.existsSync(out) && fs.statSync(out).size > 0) break; // finished between polls
    if (/fail|error|cancel/.test(s)) throw new Error(`export failed: ${JSON.stringify(st).slice(0, 200)}`);
    if (st?.progress != null) log(`export ${Math.round(Number(st.progress) * (Number(st.progress) <= 1 ? 100 : 1))}%`);
  }
  if (Date.now() - t0 >= exportTimeoutMs) throw new Error('export timed out');
  note(`exported → ${out}`);
  return { report };
}
