import { config } from './config.mjs';
import { SFX, MUSIC_QUERIES, SCENE_KINDS } from './catalog.mjs';

// ───────────────────────── 0. SCRIPT BREAKDOWN (Opus) — understand before directing ─────────────────────────
// A real director reads the script first: what is it about, for whom, what does it promise, where does attention die?
// The shot list (pass 2) is then built FROM this breakdown. Sources for the numbers: docs/research-retention.md.
export const BREAKDOWN_SYSTEM = `You are a short-form video director preparing to edit a creator's talking-head Reel. Before any shot list, you do a script breakdown — like a real director's prep.
Read the numbered speech (with English lines when it is not English) and answer precisely. Ground everything in what is actually said; never invent facts.
- topic / audience / promise: what the video is about, who it is for, and the ONE thing the viewer will get if they keep watching.
- open_loop: the question planted in the first seconds that only the payoff answers.
- payoff: the sentence number where the promise is delivered, and what it is.
- hooks: draft 3 candidate opening hooks for the on-screen text (≤4 words each, specific: a result, a number, a name or a contrarian claim — never vague like "this changed everything"); say which is strongest for a viewer scrolling with sound OFF, and why. The hook text must condense what the speaker says in the first sentence (hook/body match prevents the 3–5 s drop).
- beats: give every sentence a role (hook, promise, proof, mechanism, payoff, cta) and what the viewer should SEE at that moment — the real thing whenever possible (a screenshot, a page, a diagram of the mechanism, a number).
- first_seconds: a second-by-second plan for 0–5 s: what changes on screen in each second (aim for 2–3 visual changes in 0–3 s and part of the promise visibly paying off by 3–5 s).
- risks: where attention is likely to drop (dead context, a slow explanation, a long sentence with nothing new on screen) and the fix.
Return ONLY JSON.`;
export const BREAKDOWN_SCHEMA = {
  type: 'object',
  required: ['topic', 'audience', 'promise', 'open_loop', 'payoff', 'hooks', 'chosen_hook', 'beats', 'first_seconds', 'risks'],
  properties: {
    topic: { type: 'string' }, audience: { type: 'string' }, promise: { type: 'string' }, open_loop: { type: 'string' },
    payoff: { type: 'object', required: ['sentence', 'what'], properties: { sentence: { type: 'string', description: '#N' }, what: { type: 'string' } } },
    hooks: { type: 'array', items: { type: 'object', required: ['text', 'why'], properties: { text: { type: 'string' }, why: { type: 'string' } } } },
    chosen_hook: { type: 'string' },
    beats: { type: 'array', items: { type: 'object', required: ['sentence', 'role', 'show'], properties: { sentence: { type: 'string', description: '#N' }, role: { enum: ['hook', 'promise', 'proof', 'mechanism', 'payoff', 'cta'] }, show: { type: 'string' } } } },
    first_seconds: { type: 'array', items: { type: 'object', required: ['t', 'screen'], properties: { t: { type: 'string', description: 'e.g. 0-1s' }, screen: { type: 'string' } } } },
    risks: { type: 'array', items: { type: 'object', required: ['at', 'risk', 'fix'], properties: { at: { type: 'string' }, risk: { type: 'string' }, fix: { type: 'string' } } } },
  },
};
export const breakdownPrompt = ({ sentences, duration, language = 'en', links = [], terms = [], screens = {} }) => `Tight video length: ${duration.toFixed(1)}s.${language !== 'en' ? ` The speaker uses ${languageName(language)}.` : ''}
REAL SCREENSHOTS available: ${Object.keys(screens).length ? Object.entries(screens).map(([k, v]) => `"${k}" (${v.about})`).join('; ') : '(none)'}
CREATOR LINKS: ${links.length ? links.join(', ') : '(none)'} · GLOSSARY: ${terms.length ? terms.join(', ') : '(none)'}

SPEECH, numbered (start time on the tight timeline):
${sentences.map((s) => `[#${s.n} @${s.t.toFixed(1)}s] ${s.text}${s.en ? `  ||  EN: ${s.en}` : ''}`).join('\n')}`;

// ───────────────────────── 1. DIRECTOR (Opus) — the shot list, built from the breakdown ─────────────────────────
// Opus makes EVERY creative decision here. Everything downstream is deterministic code (Remotion + plain Edits tool calls).
export const DIRECTOR_SYSTEM = `You are the director + editor-in-chief of a premium tech education channel (system design, AI, dev tools). The output must feel hand-crafted by a top 1% short-form editor — never templated, never "AI slop".
You get the speech as numbered sentences AND your own script breakdown (topic, promise, open loop, payoff, chosen hook, beat roles, first-seconds plan, risks). Turn the breakdown into an exact shot list. Code executes it literally.

ATTENTION IS SCORED IN THE FIRST 3 SECONDS (Instagram "skip rate"; viewers register content within 0.25 s):
- Frame 0 = the speaker's face (bottom half) + the opening Hook card (top half) showing the chosen hook — bold, specific, ≤4 words, condensing what is SAID in sentence #1 (hook/body match). Put the single most striking word in 'hot'; give it an 'icon'; if a REAL SCREENSHOT proves the claim, set 'shot'. A whoosh on it at ~0 s.
- 0–3 s: the hook card already performs (text → highlighter → icon draws → subline); captions update every ~1 s. Do not add a second card before ~2 s.
- By 3–5 s part of the promise visibly pays off: the second card (the PROOF — a real screen, page or the mechanism) must START BY 4.0 s.

LAYOUT: a card SPLITS the frame by default (card on top 1080x960, speaker below). Set layout 'full' on 1-2 cards per video for the BIG moments (a 4-step diagram, the payoff number, a real screen worth reading, the CTA); a full card hides the speaker while the voice continues — 2.5-4.5 s.

PACING (never static >3–4 s; a visual change every 2–3 s): cards 2–5 s, each held long enough to read (≥1 s per 2–3 words on it); after a card return to the speaker ≥1 s; total card time 50–70%. Code adds wide/tight framing toggles in speaker-only stretches, so plan cards for MEANING, not to fill time.

STRUCTURE: hook (opens the loop) → minimum context → 3–5 beats (one idea per card; vary kinds; never two text-led cards — Hook/Bullets/Compare — in a row) → the PAYOFF card at the payoff sentence → CTA last; end on the payoff/CTA, ideally echoing the opening so the Reel loops.

SHOW, DON'T REPEAT: every card shows something the speaker is not showing by talking — the real product (Screen), the real page/repo (Site — https URL; for GitHub https://github.com/owner/name), a diagram of the mechanism (Flow/Fanout/Steps), a number (Stat/Chart), code (Code). Prefer these over Bullets. Only URLs you are CERTAIN of (verified, dropped if wrong; up to 3 Repo/Site).
SYNC: set 'word' on every card = the spoken word (verbatim, before "||") that names its subject, so it lands on that word.
TRUST: never build a claim on a [?] spot; never invent facts. LANGUAGE: card text is ENGLISH (use the EN lines).
Progress cues: 'tag' on cards of a multi-step explanation ("STEP 2/3", "RESULT").

EFFECTS (only if an EFFECTS list is in the brief): face-tracked effects ON the speaker's footage — a word BEHIND their head, a spotlight, a tape label, a comment box, a Follow tap, a checklist under the chin. They are the best pattern interrupt for full-frame speaker stretches: 1-4 per video, 1.5-4 s each, ONLY where no card is showing, landing on the spoken word ('word'); any text must ECHO what is said (≤1-3 words for words behind the head). Use the CTA effects (comment-box, tap) at the call to action. Never on top of a card.

PUNCH-INS (your 'zooms'): 110–118%, held 1.5–4 s, on emphasis words or numbers, only where no card is showing; code alternates wide/tight around them.
AUDIO (voice = 1.0): one calm instrumental bed 0.10-0.14 (never >0.16), ducked 0.6x, fade 0.6/1.2 s; query from the allowed list + 2 fallbacks. SFX sparse (~5 per 30 s): whoosh on the hook and a few card entries (0.30-0.42), ONE riser (0.25-0.32) into the payoff; offsets -0.05 s, riser -0.9 s.
COLOUR GRADE: none — the camera's colour is kept exactly.

Return ONLY JSON matching the schema. Be terse; no commentary.`;

export const DIRECTOR_SCHEMA = {
  type: 'object',
  required: ['concept', 'scenes', 'zooms', 'sfx', 'music'],
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
          layout: { enum: ['split', 'full'], description: "'split' (default): card on top, speaker below. 'full': the card takes the WHOLE screen (voice continues) — 1-2 per video" },
          props: { type: 'object', description: 'Props for the kind — see library' },
        },
      },
    },
    effects: {
      type: 'array', description: 'face-tracked effects on the speaker (only when EFFECTS are listed in the brief)',
      items: { type: 'object', required: ['fx', 'anchor', 'dur'], properties: {
        fx: { type: 'string', description: 'an effect name from the EFFECTS list' }, anchor: { type: 'string', description: '#N' },
        word: { type: 'string', description: 'the spoken word it lands on (verbatim)' }, dur: { type: 'number' },
        text: { type: 'string', description: 'per the effect; must echo what is said' }, opts: { type: 'object', description: 'e.g. {"color":"#c2410c"} or {"to":"10x"}' },
      } },
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
export const directorPrompt = ({ sentences, duration, library, indexed = false, language = 'en', screens = {}, links = [], terms = [], previousTakes = [], breakdown = null, effects = null }) => {
  const lines = sentences.map((s) => indexed
    ? `[#${s.n} @${s.t.toFixed(1)}s] ${s.text}${s.en ? `  ||  EN: ${s.en}` : ''}`
    : `[#${s.n} @${s.t.toFixed(1)}s] ${s.text}`).join('\n');
  const shots = Object.entries(screens).map(([k, v]) => `- shot "${k}": ${v.about}`).join('\n');
  return `Tight video length: ${duration.toFixed(1)}s.${language !== 'en' ? ` The speaker uses ${languageName(language)}; card text is ENGLISH (use the EN lines).` : ''}
Card kinds & props:
${library}

REAL SCREENSHOTS available for Screen cards:
${shots || '(none)'}
${effects ? `EFFECTS available (face-tracked, on the speaker; name — what it does — text):\n${Object.entries(effects).map(([k, v]) => `- ${k} — ${v.about}${v.text ? ` — text: ${v.text}` : ''}`).join('\n')}\n` : ''}CREATOR LINKS (what "this repo"/"this tool" refers to): ${links.length ? links.join(', ') : '(none)'}
GLOSSARY (correct spellings of names this creator uses; speech recognition may have misheard them): ${terms.length ? terms.join(', ') : '(none)'}

SPEECH, numbered (start time on the tight timeline):
${lines}
${breakdown ? `
YOUR SCRIPT BREAKDOWN (build the shot list from it — the chosen hook, the beat roles, the first-seconds plan, the payoff):
${JSON.stringify(breakdown)}
` : ''}
${previousTakes.length ? `PREVIOUS TAKES of this same video — the creator asked for a NEW take. Do NOT repeat them: choose a different angle/concept, a different opening hook (new words, new claim), and mostly different card kinds and visuals. Keep every fact true to the speech.
${previousTakes.map((t, i) => `Take ${i + 1}: concept "${t.concept}" · hook "${t.hook}" · cards: ${t.cards.join(' | ')}`).join('\n')}

` : ''}ANCHORS: "#N" (sentence number) for every card, zoom and sfx anchor; add 'word' on cards to land on the exact spoken word. Plan as many cards as add new information (ids a1..), zooms, sfx, captions, music per your doctrine. Props must follow the kinds exactly.`;
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
