import { config } from './config.mjs';
import { CAPTION_STYLES, TRANSITIONS, SFX, MUSIC_QUERIES, SCENE_KINDS } from './catalog.mjs';

// ───────────────────────── 1. DIRECTOR (Opus) ─────────────────────────
// Opus makes EVERY creative decision here. Downstream models only execute — they never improvise.
export const DIRECTOR_SYSTEM = `You are the director + editor-in-chief of a premium tech education channel (system design HLD/LLD, AI). Output must feel hand-crafted by a top 1% editor — never templated, never "AI slop".
You are given the creator's script (they speak it verbatim; timestamps are on the already-silence-tightened timeline). Produce the complete edit direction. Later models execute it literally, so be exact and decisive.

RETENTION DOCTRINE (distilled from editing guides; numbers are limits, not suggestions)
- NOVELTY beats cut speed: every card must add NEW information the speaker is not showing by talking (a diagram of the mechanism, a number, a contrast). A card that merely restates the sentence is slop — omit it. Change the visual when the IDEA changes.
- Hook: the first frame must work with sound OFF. First card is a Hook whose text is ≤4 words, a curiosity gap or bold claim (not a copy of the script), shown in the upper third from ~0.1s, with a sharp whoosh. Open a loop in the hook that the payoff closes.
- Rhythm: shots last 1.5-6s; never leave the plain talking head >4s untouched without a purpose. Cards 1.8-4.2s; after a card return to the speaker for ≥1.2s. Total card time 40-55% of the video.
- Mid-video micro-hook: around 50-60% of the video, one Hook card (question or "here is the catch") that re-opens attention.
- Progress cues: on multi-step explanations put 'tag' on every card ("STEP 2/4", "HLD", "RESULT").
- LANGUAGE: all on-screen card text and hook text is ENGLISH, even if the speaker is not speaking English. Captions stay in the spoken language.
- TRUST: the English lines may contain [?] where speech recognition dropped a word. Never put a claim, name or number on a card that depends on a [?] spot — pick a different idea for that sentence or keep the card generic. Never invent facts that are not in the text.
- Pick the right card: sequence/pipeline → Flow or Steps; one→many → Fanout; numbers/proof → Stat or Chart; contrast → Compare; code/class/interface (LLD) → Code; takeaway → Hook or Bullets. Vary kinds (never 3 of one kind in a row). Card text ≤12 words, spoken vocabulary, real numbers from the script only. Never invent facts.
- REFERENCES (show the real thing): when the speaker names a specific open-source project, tool, product or website (a proper name — not a generic word like "database" or "cache"), give it a reference card at the sentence where it is first named: a Repo card with its exact owner/name (e.g. apache/kafka) for open-source projects, or a Site card with its official https URL for tools and products. Viewers want to see the real thing. Up to 3 per video — if more are named, pick the most central. Only when you are CERTAIN of the exact repo/URL: every one is verified by fetching it and dropped if wrong, so a guess just wastes a card. 2.5-3.5s each; never as the opening card; skip names that are only an example in passing.
- COLOUR: one hero accent on dark. Use 'hot' (≤2 words) and 'highlight' to mark the single thing to look at per card; do not decorate.
- Payoff: last card = takeaway/result (Stat or Hook), then ~1s of speaker.
- Punch-ins on the talking head: 108-114%, 0.8-1.6s, only where no card is showing, ≤1 per 6s, on emphatic sentences.
- Transitions: straight cuts are the default feel. Use transitions only on card in/out, from the allowed list, ONE family for the whole video (e.g. blur for in, blur for out).

CAPTIONS
- Choose ONE style from the allowed list. highlightColor: #FFD84D (warm yellow; best contrast on skin and dark) unless the style needs the teal #4DE3C1. 'keywords': verbatim spoken technical terms/numbers/impact verbs; at most 10% of the words in the script; at most one per caption line.

AUDIO (linear volume; speaker voice = 1.0)
- Voice: enhance + normalise to -14 LUFS (fixed).
- Music: ONE instrumental bed, no vocals, calm. volume 0.10-0.14 (never >0.16), ducked to 0.6x under voice, fadeIn 0.6s, fadeOut 1.2s. Query from the allowed list + 2 fallbacks. Must be inaudible-as-music on phone speakers at half volume: it is texture, not content.
- SFX: sparse and purposeful — about 5 per 30 seconds at most. Whoosh on the hook and on a few card entries (0.30-0.42), a softer one on an abrupt exit only (0.2-0.3), ONE riser (0.25-0.32) only into the payoff. Allowed names only. Offsets: -0.05s for whooshes, riser -0.9s before the payoff.

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
          anchor: { type: 'string', description: "EXACT 3-6 consecutive words from the script where the card appears — or '#N' (sentence number) when the sentences are numbered" },
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

const LANG = { en: 'English', hi: 'Hindi' };
export const languageName = (code) => LANG[code] ?? code;

/**
 * verbatim mode (English + script): sentences are plain text, anchors are verbatim words.
 * indexed mode (non-English or no script): sentences are numbered, anchors are '#N' — language-independent;
 * `s.en` carries the English translation when the speech is not English.
 */
export const directorPrompt = ({ sentences, duration, library, indexed = false, language = 'en' }) => {
  const lines = sentences.map((s) => indexed
    ? `[#${s.n} @${s.t.toFixed(1)}s] ${s.text}${s.en ? `  ||  EN: ${s.en}` : ''}`
    : `[${s.t.toFixed(1)}] ${s.text}`).join('\n');
  const rules = indexed
    ? `ANCHORS: use "#N" (the sentence number, e.g. "#3") for every anchor, zoom and sfx anchor — never words.
Card and hook text: ENGLISH (use the EN lines${language === 'en' ? '' : `; the speaker uses ${languageName(language)}`}).
Caption "keywords": copy words VERBATIM from the spoken text (the part before "||"), because captions stay in the spoken language.`
    : 'Anchors MUST be verbatim from the script above.';
  return `Tight video length: ${duration.toFixed(1)}s.
Card kinds & props:
${library}

${indexed ? 'SPEECH, numbered (start time on the tight timeline)' : 'SCRIPT AS SPOKEN (start time on tight timeline → sentence)'}:
${lines}

Plan only as many cards as add new information (typically 1 per 3-4s of speech; ids a1..), zooms, sfx, captions, music, grade per your doctrine. Props must follow the kinds exactly. ${rules}`;
};

// ───────────────────────── 1b. TRANSLATE (Sonnet) — only for non-English speech ─────────────────────────
export const TRANSLATE_SCHEMA = {
  type: 'object', required: ['sentences'],
  properties: { sentences: { type: 'array', items: { type: 'object', required: ['n', 'en'], properties: { n: { type: 'integer' }, en: { type: 'string' } } } } },
};
export const TRANSLATE_SYSTEM = `You translate spoken sentences into natural, concise English for an explainer video script. Keep technical terms, product names, code identifiers and numbers exactly (Hinglish: English words stay as they are). Do not summarise, merge, split or omit sentences.
IMPORTANT — the main transcript comes from speech recognition that OFTEN DROPS English words said inside non-English speech (product names like Kafka, numbers, acronyms). Some sentences also carry an ALT line: a second, independent transcription of the same audio. ALT often keeps the English terms and numbers the main transcript dropped (but may garble the native words). Use ALT to fill gaps and to fix truncated numbers when it agrees with the sentence; the main transcript decides the sentence itself. Signs: a postposition or verb with its noun missing (e.g. Hindi "में नहीं" with nothing before it), or a number that looks truncated.
- NEVER guess a product name, technology or number that is not in the text. Write [?] where a word was probably dropped, and keep every word you can see.
- Fill a gap, or correct a number that looks truncated, only when ALT or the optional reference text supports it unambiguously. If neither does, write [?].
Return ONLY JSON.`;
export const translatePrompt = ({ sentences, language, reference }) => `Translate from ${languageName(language)} to English. One output per input, same "n".
${reference ? `Reference (a rough English script the creator provided — use it only to resolve terminology, not to replace the translation):\n${reference.slice(0, 1500)}\n` : ''}
${sentences.map((s) => `#${s.n}: ${s.text}${s.alt ? `\n    ALT: ${s.alt}` : ''}`).join('\n')}`;

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
  return `Execute this EDL. Total length ${edl.duration.toFixed(1)}s, canvas 9:16 ${config.canvas.width}x${config.canvas.height}, ${config.canvas.fps}fps.

1) PROJECT: new project, set 9:16, import ${tight} onto the main track (it is already silence-tightened — do NOT cut or trim it).
2) VOICE: enable voice enhance on the clip; normalise loudness to -14 LUFS (loudness/processAudio).
3) CARDS (overlay layer above the video; import each mp4, place at exact start, set exact duration; MUTE card audio; never move the main clip):
${sc}
   For each card add transition_in at its start and transition_out at its end using the listed filter ids (addTransition).
4) PUNCH-INS on the talking head (transform keyframes, smooth ease; return to 100% after the hold):
${zm}
5) CAPTIONS: generateCaptions (source = composition audio, language ${edl.language ?? 'en'}; do NOT enable extra auto-captions elsewhere), then setCaptionStyle "${c.style}", setCaptionHighlightColor ${c.highlightColor}, then setCaptionHighlights for these words wherever spoken: ${c.keywords.join(', ')}. Layout: 2-3 words per line (re-split if needed), as large as fits, centred horizontally with the caption block centred at ≈68% of frame height (inside the safe area: keep top 14% and bottom 20% clear). Cards deliberately leave that band empty. Highlight at most one word per line.${edl.language && edl.language !== 'en' ? ` The captions are in the SPOKEN language (${edl.language}): during QA confirm the caption style renders those glyphs correctly (no missing characters); if it does not, switch to caption style "Default" and say so in your final reply.` : ''}
6) MUSIC: searchMusic "${m.query}" (fallbacks: ${m.fallbacks.join(' | ')}); add the best instrumental match at 0s, trim to ${edl.duration.toFixed(1)}s, volume ${m.volume}, fade in ${m.fadeIn}s, fade out ${m.fadeOut}s, auto-duck under voice (setDucking) to volume ${m.duckedVolume}.
7) SFX (searchSoundEffects by exact name, pick exact title; place at the exact time, set the volume):
${fx}
8) GRADE: ${edl.grade?.note ?? 'subtle contrast/saturation lift'} — apply with adjust tools (no LUT/filter presets).
9) ${quality === 'high' ? 'QA: previewVideoFrames at ~5 points (each card start, 2 captioned talking-head moments, the last second). Fix: caption overlapping card text, clipped card, any clip not at its exact time, music louder than voice. Re-check only what you changed.' : 'No QA pass.'}
10) EXPORT: H.264, ${config.canvas.width}x${config.canvas.height}, ${config.canvas.fps}fps, high quality, to ${out}; wait until exportStatus is finished.
Final reply (max 3 lines): exported path, plus any deviations from the EDL.`;
};
