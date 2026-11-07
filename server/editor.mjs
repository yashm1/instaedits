// The Edits app step, as plain tool calls — no LLM. Every value is exact and every step is checked.
// Edits does what only it can: licensed MUSIC, SFX and voice polish. Its export is used for the AUDIO MIX only — never
// the picture (Edits re-encodes video, HEVC only, with a small magenta shift; the picture is composited by ffmpeg from
// the original camera pixels). Captions come from the transcript (exact word times), not from caption round trips.
// History: an LLM executor once set saturation 0.04 (a MULTIPLIER) → black and white.
import fs from 'node:fs';
import { tool as editsTool } from './edits-mcp.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param o.video  staged tight.mp4 (the speaker, silence-tightened; same timeline as the final reel)
 * @param o.edl    { duration, sfx, music }
 * @param o.out    export path (staging folder); only its audio is used
 * @returns { report: string[] }
 */
export async function runEdit({ video, edl, out, log = () => {}, tool = editsTool, sleep = wait, exportTimeoutMs = 15 * 60_000 }) {
  const report = [];
  const note = (m) => { report.push(m); log(m); };
  const soft = async (what, fn) => { try { return await fn(); } catch (e) { note(`⚠️ ${what}: ${String(e.message).replace(/\s+/g, ' ').slice(0, 140)}`); return null; } };

  // 1. project + the finished picture
  await tool('newProject');
  await tool('setAspectRatio', { ratio: '9:16' });
  await soft('project frame rate', () => tool('setFrameRate', { fps: 30 })); // the camera's rate; without it the export came out at 60 fps
  const imp = await tool('importMedia', { path: video });
  const id = imp?.id;
  if (!id) throw new Error('importMedia returned no clip id: ' + JSON.stringify(imp).slice(0, 160));
  log('imported the speaker clip');
  // never grade: the colour is the camera's. Verify nothing upstream left a filter on the clip.
  const adj = await soft('adjust check', () => tool('getAdjustState', { id }));
  if (adj && adj.isDefault === false) note(`⚠️ the clip has non-default adjustments (saturation ${adj.saturation}) — check the colour`);

  // 2. voice polish (loudness is already -14 LUFS from the render step)
  await soft('voice enhance', async () => {
    // idempotent, so one retry on a dropped connection ("fetch failed") is safe
    try { await tool('selectById', { id, addToSelection: false }); } catch (e) { if (!/fetch failed|ECONNRESET|socket/i.test(e.message)) throw e; await sleep(1500); await tool('selectById', { id, addToSelection: false }); }
    await tool('selectTool', { tool: 'volume' }); // Voice Enhance lives in the Volume panel, which must be presented first
    await tool('setVoiceEnhance', { reduceNoise: 0.35, enhanceVoice: 0.5 });
    await tool('dismissVolumePanel', {}).catch(() => {});
    log('voice enhance on');
  });

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
      // the playhead sometimes lags while the app is busy ("playhead did not reach …"): retry briefly before giving up
      for (let i = 1; ; i++) {
        try { await tool('seek', { seconds: x.at }); break; } catch (e) { if (i >= 4 || !/playhead/i.test(e.message)) throw e; await sleep(400 * i); }
      }
      const r = await tool('addSoundEffect', { effect: x.name });
      if (r?.id) await tool('setVolume', { id: r.id, volume: x.volume });
      placed++;
    });
  }
  if (edl.sfx?.length) log(`sfx: ${placed}/${edl.sfx.length} placed`);

  // 6. export — only the AUDIO is used, so the picture is small and fast (720p, 2 Mbit/s). A COMPLETE preset (verified
  //    values): a partial one makes export() fail with "incomplete preset row".
  await tool('setExportSettings', { quality: 'High', frameRate: 30, resolution: '720x1280', resolutionType: '720p', aspectRatio: 'nineBySixteen', dynamicRange: 'SDR', bitrate: 2_000_000 });
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
  note(`exported the audio mix → ${out}`);
  return { report };
}
