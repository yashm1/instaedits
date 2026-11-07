import { config } from './config.mjs';
import { CAPTION_STYLES, TRANSITIONS, SFX, MUSIC_QUERIES, SCENE_KINDS } from './catalog.mjs';

// ───────────────────────── 1. DIRECTOR (Opus) ─────────────────────────
// Opus makes EVERY creative decision here. Everything downstream is deterministic code (Remotion + plain Edits tool calls).
export const DIRECTOR_SYSTEM = `You are the director + editor-in-chief of a premium tech education channel (system design HLD/LLD, AI, dev tools). Output must feel hand-crafted by a top 1% editor — never templated, never "AI slop".
You get the speech as numbered sentences on the already-silence-tightened timeline. FIRST understand what the video is about and what the viewer must walk away with; then plan the visuals. Code executes your plan literally, so be exact and decisive.

LAYOUT (fixed): while a card is on screen the frame is SPLIT — the card fills the TOP HALF (1080x960), the speaker stays visible in the bottom half. With no card the speaker is full-frame. Cards therefore never hide the speaker, so use them generously.

RETENTION DOCTRINE (numbers are limits)
- NOVELTY: every card shows something the speaker is NOT showing by talking — the real product/screen, a diagram of the mechanism, a number, a contrast. A card that merely restates the sentence is slop.
- SYNC: a card appears the moment its subject is SAID. Set 'word' to the spoken word (copied verbatim from the sentence, before "||") that names it, so it lands on that word, not at the sentence start.
- Hook: first card at the first sentence, ≤4 words, curiosity gap or bold claim (not a copy of the script), works with sound OFF.
- Rhythm: cards 2-5s; total card time 50-70% of the video; ≥1s of full-frame speaker between most cards; never >5s of plain speaker without a reason. Mid-video (50-60%) one card that re-opens attention.
- Progress cues: 'tag' on every card of a multi-step explanation ("STEP 2/3", "SETUP", "RESULT").
- LANGUAGE: all card text is ENGLISH (use the EN lines). Captions are handled separately.
- TRUST: never put a claim, name or number on a card that depends on a [?] spot, and never invent facts that are not in the speech.
- Pick the right card: real product/screen → Screen or Site; open-source repo → Repo or Site (github URL = its real page screenshot); sequence/pipeline → Flow or Steps; one→many → Fanout; numbers → Stat or Chart; contrast → Compare; code → Code; takeaway → Hook or Bullets. Vary kinds (never 3 of one kind in a row). Card text ≤12 words, spoken vocabulary.
- SHOW THE REAL THING: when the speaker talks about something listed under REAL SCREENSHOTS, use a Screen card with that shot — it is a real capture. When they name a tool/product/site or a GitHub repo (including "this repo"/"this tool" when CREATOR LINKS say which), use a Site card with its https URL — a real screenshot of the page; for a GitHub repo that is https://github.com/owner/name (the actual repo page). Only URLs you are CERTAIN of; each is verified and dropped if wrong. Up to 3 Repo/Site cards.
- COLOUR: one hero accent on dark. 'hot' (≤2 words) / 'highlight' mark the single thing to look at.
- Payoff: last card = takeaway/result or the call to action, then ~1s of speaker.
- Punch-ins on the full-frame speaker: 108-114%, 0.8-1.6s, only where no card is showing, ≤1 per 6s, on emphatic sentences.

CAPTIONS: Latin-script Hinglish lines are made automatically; choose 'Highlighter' (active word highlighted — default) or 'Default' (calmer, for slow/serious videos).

AUDIO (linear volume; voice = 1.0): one calm instrumental bed, volume 0.10-0.14 (never >0.16), ducked 0.6x under voice, fadeIn 0.6s, fadeOut 1.2s; query from the allowed list + 2 fallbacks. SFX sparse: ~5 per 30s max — whoosh on the hook and a few card entries (0.30-0.42), ONE riser (0.25-0.32) only into the payoff; offsets -0.05s for whooshes, riser -0.9s.

COLOUR GRADE: none — the camera's colour is kept exactly.

Return ONLY JSON matching the schema. Be terse; no commentary.`;

export const DIRECTOR_SCHEMA = {
  type: 'object',
  required: ['concept', 'scenes', 'zooms', 'sfx', 'captions', 'music'],
  properties: {
    concept: { type: 'string', description: 'One sentence: what the video is about, the angle and the emotional arc' },
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'anchor', 'dur', 'kind', 'props'],
        properties: {
          id: { type: 'string', description: 'a1, a2, ...' },
          anchor: { type: 'string', description: "'#N' — the sentence number where the card appears (or exact 3-6 consecutive words when sentences are not numbered)" },
          word: { type: 'string', description: 'optional: the spoken word in that sentence (verbatim, before "||") at which the card should appear — the moment its subject is named' },
          dur: { type: 'number' },
          kind: { enum: SCENE_KINDS },
          props: { type: 'object', description: 'Props for the kind — see library' },
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
    captions: { type: 'object', required: ['style'], properties: { style: { enum: CAPTION_STYLES } } },
    music: {
      type: 'object', required: ['query', 'fallbacks', 'volume', 'duckedVolume', 'fadeIn', 'fadeOut'],
      properties: {
        query: { enum: MUSIC_QUERIES }, fallbacks: { type: 'array', items: { enum: MUSIC_QUERIES } },
        volume: { type: 'number' }, duckedVolume: { type: 'number' }, fadeIn: { type: 'number' }, fadeOut: { type: 'number' },
      },
    },
  },
};

const LANG = { en: 'English', hi: 'Hindi' };
export const languageName = (code) => LANG[code] ?? code;

/**
 * verbatim mode (English + script): sentences are plain text, anchors are verbatim words.
 * indexed mode (non-English or no script): sentences are numbered, anchors are '#N' — language-independent;
 * `s.en` carries the English translation when the speech is not English.
 */
export const directorPrompt = ({ sentences, duration, library, indexed = false, language = 'en', screens = {}, links = [], terms = [] }) => {
  const lines = sentences.map((s) => indexed
    ? `[#${s.n} @${s.t.toFixed(1)}s] ${s.text}${s.en ? `  ||  EN: ${s.en}` : ''}`
    : `[#${s.n} @${s.t.toFixed(1)}s] ${s.text}`).join('\n');
  const shots = Object.entries(screens).map(([k, v]) => `- shot "${k}": ${v.about}`).join('\n');
  return `Tight video length: ${duration.toFixed(1)}s.${language !== 'en' ? ` The speaker uses ${languageName(language)}; card text is ENGLISH (use the EN lines).` : ''}
Card kinds & props:
${library}

REAL SCREENSHOTS available for Screen cards:
${shots || '(none)'}
CREATOR LINKS (what "this repo"/"this tool" refers to): ${links.length ? links.join(', ') : '(none)'}
GLOSSARY (correct spellings of names this creator uses; speech recognition may have misheard them): ${terms.length ? terms.join(', ') : '(none)'}

SPEECH, numbered (start time on the tight timeline):
${lines}

ANCHORS: "#N" (sentence number) for every card, zoom and sfx anchor; add 'word' on cards to land on the exact spoken word. Plan as many cards as add new information (ids a1..), zooms, sfx, captions, music per your doctrine. Props must follow the kinds exactly.`;
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
export const translatePrompt = ({ sentences, language, reference, terms = [] }) => `Translate from ${languageName(language)} to English. One output per input, same "n".
${terms.length ? `GLOSSARY — names this creator uses. Speech recognition often mishears them as similar-sounding words (e.g. "Remotion" heard as "emotion"/"इमोशन"); when a word sounds like one of these and the context fits, write the glossary name: ${terms.join(', ')}\n` : ''}
${reference ? `Reference (a rough English script the creator provided — use it only to resolve terminology, not to replace the translation):\n${reference.slice(0, 1500)}\n` : ''}
${sentences.map((s) => `#${s.n}: ${s.text}${s.alt ? `\n    ALT: ${s.alt}` : ''}`).join('\n')}`;

// ───────────────────────── 2. HINGLISH CAPTIONS (Sonnet) ─────────────────────────
export const TRANSLIT_SCHEMA = {
  type: 'object', required: ['lines'],
  properties: { lines: { type: 'array', items: { type: 'object', required: ['n', 'words'], properties: { n: { type: 'integer' }, words: { type: 'array', items: { type: 'string' } } } } } },
};
export const TRANSLIT_SYSTEM = `You write spoken Hindi as Latin-script Hinglish, the way Indian tech creators type Instagram captions.
Each input line is one caption: its words separated by " | ". Return EXACTLY one Latin word per input word, same order, same count (the app maps them 1:1).
- Hindi words → natural Hinglish spelling: भाई→bhai, ये→ye, पूरा→pura, किया→kiya, है→hai, तुम्हें→tumhe, करके→karke.
- English words written in Devanagari → correct English spelling: रिसेंटली→recently, ऑटोमेशन→automation, सर्वर→server, वीडियो→video, लॉन्च→launch.
- Names → glossary spelling and casing. Speech recognition mishears names; if a word sounds like a glossary name and the context fits, use the name (e.g. इमोशन in "… इमोशन वीडियो जनरेट" in a video-tools context → Remotion).
- Keep attached punctuation; । → "." No Devanagari in the output. Return ONLY JSON.`;
export const translitPrompt = ({ lines, terms = [] }) => `GLOSSARY: ${terms.length ? terms.join(', ') : '(none)'}
${lines.map((l, i) => `${i + 1}: ${l.join(' | ')}`).join('\n')}`;

// ───────────────────────── 3. REVIEW (vision) — "watch it before publishing" ─────────────────────────
export const REVIEW_SCHEMA = {
  type: 'object', required: ['verdict', 'issues'],
  properties: { verdict: { enum: ['publish', 'fix'] }, issues: { type: 'array', items: { type: 'string' } } },
};
export const reviewPrompt = ({ contact, frames, concept }) => `Read the image ${contact} — a contact sheet of the exported reel, left to right, one frame per graphic card:
${frames.map((f, i) => `${i + 1}. @${f.t}s card ${f.label} — being said: "${f.said}"`).join('\n')}
The video's intent: ${concept}
Review like a senior editor before publishing. For each frame: does the graphic match what is being said at that moment? Is all text legible, unclipped, not covering the speaker's face? Are the captions in Latin script (Hinglish/English)? Is the colour natural (not black and white)? Return verdict "publish" or "fix" and short concrete issues (empty if none). Return ONLY JSON.`;
