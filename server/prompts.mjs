import { CAPTION_STYLES, TRANSITIONS, SFX, MUSIC_QUERIES, SCENE_KINDS } from './catalog.mjs';

// ───────────────────────── 1. DIRECTOR (Opus) ─────────────────────────
// Opus makes EVERY creative decision here. Downstream models only execute — they never improvise.
export const DIRECTOR_SYSTEM = `You are the director + editor-in-chief of a premium tech education channel (system design HLD/LLD, AI). Output must feel hand-crafted by a top 1% editor — never templated, never "AI slop".
You are given the creator's script (they speak it verbatim; timestamps are on the already-silence-tightened timeline). Produce the complete edit direction. Later models execute it literally, so be exact and decisive.

RETENTION DOCTRINE
- Hook: the first 1.5s needs a pattern interrupt: a Hook card (or hard punch-in) that lands on the first spoken words. Hook text is a sharper, shorter version of the claim (≤8 words), not a copy of the script.
- Rhythm: something visually changes every 2-3.5s (card in/out, punch-in, or caption emphasis). Never leave the plain talking head >4s untouched.
- Cards: one idea per card. Card shows the CONCEPT the speaker is describing, appearing as the phrase is said (lead the word by ~0.1s). Duration 1.8-4.2s. After a card, return to the speaker for ≥1.2s before the next card (face time builds trust). Total card time 40-55% of the video.
- Pick the right card for the idea: sequence/pipeline → Flow or Steps; one thing distributing to many → Fanout; numbers/proof → Stat or Chart; contrasts → Compare; code/class/interface (LLD) → Code; takeaway → Hook or Bullets. Vary kinds — never the same kind 3 times in a row. Text on cards ≤12 words; use the script's own vocabulary and real numbers from the script only. Never invent facts.
- Payoff: last card = the takeaway/result (Stat or Hook), then ~1s of speaker.
- Punch-ins (zooms) on the talking head: 108-114% only, on emphatic sentences with no card, alternating in/out, 0.8-1.6s hold. Max 1 per 6s. Zooms may ONLY happen where no card is showing: anchor them to phrases that are NOT covered by any card's anchor window (a card covers its anchor phrase through ~2-4s after it).
- Transitions: pick from the allowed list; use 2 families max across the video (e.g. blur + zoom_in) for visual consistency.

CAPTIONS
- Choose ONE style from the allowed list; highlightColor must be a hex that matches the card theme (#4DE3C1 teal or #FFD84D warm for contrast) — pick for readability on skin tones. List 6-14 'keywords' (verbatim spoken words: technical terms, numbers, verbs of impact) to emphasise.

AUDIO (levels are linear volume where speaker voice = 1.0)
- Voice: enhance + normalise to -14 LUFS (fixed, do not change).
- Music: ONE instrumental bed, no vocals, calm/minimal so voice stays dominant. volume 0.10-0.14 (never above 0.16), auto-duck under voice to 0.55x of that, fadeIn 0.6s, fadeOut 1.2s, starts at 0, ends with the video. Provide search query from allowed list + 2 fallback queries.
- SFX: tasteful, purposeful, ≤1 per 3s on average and never more than 8 total. Whoosh at card ENTRY (volume 0.30-0.42), a softer/shorter one at card exit only when the cut is abrupt (0.2-0.3), one Riser (0.25-0.32) ONLY leading into the payoff or Stat reveal, none on every card. Use only the allowed names. Offsets: whooshes -0.05s (just before the visual), riser starts 0.9s before the payoff (offset -0.9 on that scene).

GRADE
- Subtle: contrast +6%, saturation +4%, slight warmth; set 'grade.note' to one sentence. No heavy filters/LUT.

Return ONLY JSON matching the schema. Be terse; no commentary.`;

export const DIRECTOR_SCHEMA = {
  type: 'object',
  required: ['concept', 'scenes', 'zooms', 'sfx', 'captions', 'music', 'grade', 'remotion_brief'],
  properties: {
    concept: { type: 'string', description: 'One sentence: the video\'s angle and the emotional arc' },
    remotion_brief: { type: 'string', description: '≤80 words: visual notes for Remotion dev (palette emphasis, which element glows, motion feel)' },
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'anchor', 'dur', 'kind', 'props', 'transition_in', 'transition_out'],
        properties: {
          id: { type: 'string', description: 'a1, a2, ...' },
          anchor: { type: 'string', description: 'EXACT 3-6 consecutive words from the script where the card appears' },
          dur: { type: 'number' },
          kind: { enum: SCENE_KINDS },
          props: { type: 'object', description: 'Props for the kind — see library' },
          transition_in: { enum: TRANSITIONS },
          transition_out: { enum: TRANSITIONS },
        },
      },
    },
    zooms: { type: 'array', items: { type: 'object', required: ['anchor', 'dur', 'scale'], properties: { anchor: { type: 'string' }, dur: { type: 'number' }, scale: { type: 'number', description: '1.08-1.14' } } } },
    sfx: {
      type: 'array',
      items: {
        type: 'object', required: ['name', 'volume'],
        properties: {
          name: { enum: SFX },
          volume: { type: 'number' },
          on_scene: { type: 'string', description: 'scene id (a1..) to attach to' },
          edge: { enum: ['in', 'out'] },
          anchor: { type: 'string', description: 'use instead of on_scene for non-card moments' },
          offset: { type: 'number' },
        },
      },
    },
    captions: {
      type: 'object', required: ['style', 'highlightColor', 'keywords'],
      properties: { style: { enum: CAPTION_STYLES }, highlightColor: { type: 'string' }, keywords: { type: 'array', items: { type: 'string' } } },
    },
    music: {
      type: 'object', required: ['query', 'fallbacks', 'volume', 'duckedVolume', 'fadeIn', 'fadeOut'],
      properties: {
        query: { enum: MUSIC_QUERIES }, fallbacks: { type: 'array', items: { enum: MUSIC_QUERIES } },
        volume: { type: 'number' }, duckedVolume: { type: 'number' }, fadeIn: { type: 'number' }, fadeOut: { type: 'number' },
      },
    },
    grade: { type: 'object', required: ['note'], properties: { note: { type: 'string' } } },
  },
};

export const directorPrompt = ({ script, sentences, duration, library }) => `Tight video length: ${duration.toFixed(1)}s.
Card kinds & props:
${library}

SCRIPT AS SPOKEN (start time on tight timeline → sentence):
${sentences.map((s) => `[${s.t.toFixed(1)}] ${s.text}`).join('\n')}

Plan 7-12 cards (ids a1..), zooms, sfx, captions, music, grade per your doctrine. Props must follow the kinds exactly. Anchors MUST be verbatim from the script above.`;

// ───────────────────────── 2. CODEGEN (Sonnet) ─────────────────────────
export const codegenPrompt = ({ jobId }) => `Read ./LIBRARY.md and ../jobs/${jobId}/scenes.json, then write ./src/Scenes.tsx per the output contract exactly.
Use each scene's kind + props verbatim as the library component; durationInFrames = round(dur*30); ids as given (s1, s2, ...). remotion_brief in the JSON is context only — do not restyle. Do not read any other file, do not run commands. Reply "done".`;

export const repairPrompt = (err) => `Rendering/typecheck failed:\n${err.slice(0, 1500)}\nFix ./src/Scenes.tsx with the smallest possible edit. Reply "done".`;

// ───────────────────────── 3. EDITOR (Sonnet high / Haiku fast) ─────────────────────────
// Pure execution of a pre-computed Edit Decision List. No creative decisions.
export const editSystem = `You operate the "Edits" video editor via tools. You are an EXECUTOR: every timing, level and choice is already decided in the EDL — never improvise creatively, never re-time, never pick other styles. Don't re-inspect state unless a step fails. If a step is impossible, do the closest faithful thing and note it in your final reply. Times are seconds on the composition timeline.`;

export const editPrompt = ({ tight, clipsDir, edl, out, quality }) => {
  const sc = edl.scenes.map((s) => `${s.id} | ${s.start}s +${s.dur}s | ${s.kind} | in:${s.tin} out:${s.tout} | ${clipsDir}/${s.id}.mp4`).join('\n');
  const zm = edl.zooms.map((z) => `${z.start}s +${z.dur}s → ${Math.round(z.scale * 100)}% (ease in/out, centre on face)`).join('\n') || '(none)';
  const fx = edl.sfx.map((x) => `${x.at}s | ${x.name} | vol ${x.volume}`).join('\n') || '(none)';
  const m = edl.music, c = edl.captions;
  return `Execute this EDL. Total length ${edl.duration.toFixed(1)}s, canvas 9:16 1080x1920, 30fps.

1) PROJECT: new project, set 9:16, import ${tight} onto the main track (it is already silence-tightened — do NOT cut or trim it).
2) VOICE: enable voice enhance on the clip; normalise loudness to -14 LUFS (loudness/processAudio).
3) CARDS (overlay layer above the video; import each mp4, place at exact start, set exact duration; MUTE card audio; never move the main clip):
${sc}
   For each card add transition_in at its start and transition_out at its end using the listed filter ids (addTransition).
4) PUNCH-INS on the talking head (transform keyframes, smooth ease; return to 100% after the hold):
${zm}
5) CAPTIONS: generateCaptions (source = composition audio, language en), then setCaptionStyle "${c.style}", setCaptionHighlightColor ${c.highlightColor}, then setCaptionHighlights for these words wherever spoken: ${c.keywords.join(', ')}. Keep captions in the lower third, clear of the bottom 8% edge; do not let them sit on cards' key content (cards leave the bottom 420px empty by design).
6) MUSIC: searchMusic "${m.query}" (fallbacks: ${m.fallbacks.join(' | ')}); add the best instrumental match at 0s, trim to ${edl.duration.toFixed(1)}s, volume ${m.volume}, fade in ${m.fadeIn}s, fade out ${m.fadeOut}s, auto-duck under voice (setDucking) to volume ${m.duckedVolume}.
7) SFX (searchSoundEffects by exact name, pick exact title; place at the exact time, set the volume):
${fx}
8) GRADE: ${edl.grade?.note ?? 'subtle contrast/saturation lift'} — apply with adjust tools (no LUT/filter presets).
9) ${quality === 'high' ? 'QA: previewVideoFrames at ~5 points (each card start, 2 captioned talking-head moments, the last second). Fix: caption overlapping card text, clipped card, any clip not at its exact time, music louder than voice. Re-check only what you changed.' : 'No QA pass.'}
10) EXPORT: H.264, 1080x1920, 30fps, high quality, to ${out}; wait until exportStatus is finished.
Final reply (max 3 lines): exported path, plus any deviations from the EDL.`;
};
