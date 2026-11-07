import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../server/prompts.mjs';
import * as C from '../server/catalog.mjs';
import { LIMITS } from '../server/guardrails.mjs';
import { SCREENS } from '../server/screens.mjs';

const props = P.DIRECTOR_SCHEMA.properties;

test('director schema enums are exactly the verified catalog (incl. the Screen card)', () => {
  assert.deepEqual(props.scenes.items.properties.kind.enum, C.SCENE_KINDS);
  assert.ok(C.SCENE_KINDS.includes('Screen'));
  assert.deepEqual(props.sfx.items.properties.name.enum, C.SFX);
  assert.deepEqual(props.music.properties.query.enum, C.MUSIC_QUERIES);
});

test('schema requires every section the resolver reads, and has NO grade (the camera colour is kept)', () => {
  for (const k of ['scenes', 'zooms', 'sfx', 'music']) assert.ok(P.DIRECTOR_SCHEMA.required.includes(k), k);
  assert.ok(!('grade' in props), 'a grade instruction is what turned a video black and white');
  assert.match(P.DIRECTOR_SYSTEM, /COLOUR GRADE: none/);
  assert.ok(props.scenes.items.properties.word, 'cards can land on an exact spoken word');
});

test('director prompt: numbered sentences with EN lines, screenshots, creator links and glossary', () => {
  const p = P.directorPrompt({
    sentences: [{ n: 3, t: 7.25, text: 'यह तेज़ है', en: 'It is fast' }], duration: 20, library: '- `Hook`', indexed: true, language: 'hi',
    screens: { 'edits-automation': SCREENS['edits-automation'] }, links: ['https://github.com/yashm1/instaedits'], terms: ['Remotion', 'Claude Code'],
  });
  assert.match(p, /\[#3 @7\.3s\] यह तेज़ है {2}\|\| {2}EN: It is fast/);
  assert.match(p, /20\.0s/); assert.match(p, /- `Hook`/);
  assert.match(p, /shot "edits-automation": the Automation \(MCP\) server/);
  assert.match(p, /CREATOR LINKS[^\n]*https:\/\/github\.com\/yashm1\/instaedits/);
  assert.match(p, /GLOSSARY[^\n]*Remotion, Claude Code/);
  assert.match(p, /Hindi/); assert.match(p, /ENGLISH/); assert.match(p, /"#N"/);
});

test('director prompt without extras says so explicitly (no empty headings the model could misread)', () => {
  const p = P.directorPrompt({ sentences: [{ n: 1, t: 1, text: 'Hello.' }], duration: 5, library: 'L' });
  assert.match(p, /\[#1 @1\.0s\] Hello\./);
  assert.match(p, /REAL SCREENSHOTS[^\n]*\n\(none\)/); assert.match(p, /CREATOR LINKS[^\n]*\(none\)/);
});

test('director must not build claims on [?] spots', () => {
  assert.match(P.DIRECTOR_SYSTEM, /TRUST/); assert.match(P.DIRECTOR_SYSTEM, /\[\?\]/); assert.match(P.DIRECTOR_SYSTEM, /never invent facts/);
});

// ───────── translator ─────────
test('translate prompt: numbered input, keeps terms, optional reference, schema demands n+en', () => {
  const p = P.translatePrompt({ sentences: [{ n: 1, text: 'नमस्ते' }, { n: 2, text: 'Kafka तेज़ है' }], language: 'hi', reference: 'rough english draft' });
  assert.match(p, /from Hindi to English/); assert.match(p, /#1: नमस्ते/); assert.match(p, /#2: Kafka तेज़ है/); assert.match(p, /rough english draft/);
  assert.doesNotMatch(P.translatePrompt({ sentences: [{ n: 1, text: 'x' }], language: 'hi' }), /Reference|GLOSSARY/);
  assert.deepEqual(P.TRANSLATE_SCHEMA.properties.sentences.items.required, ['n', 'en']);
  assert.match(P.TRANSLATE_SYSTEM, /technical terms/); assert.match(P.TRANSLATE_SYSTEM, /Do not summarise/);
  assert.equal(P.languageName('hi'), 'Hindi'); assert.equal(P.languageName('fr'), 'fr');
});

test('translate prompt carries the glossary and the "emotion" → Remotion mishearing hint', () => {
  const p = P.translatePrompt({ sentences: [{ n: 1, text: 'इमोशन वीडियो जनरेट कर लेगा' }], language: 'hi', terms: ['Remotion', 'Codex'] });
  assert.match(p, /GLOSSARY[^\n]*Remotion, Codex/); assert.match(p, /emotion/);
});

test('translator must flag likely-dropped words with [?] and never guess names or numbers', () => {
  assert.match(P.TRANSLATE_SYSTEM, /OFTEN DROPS English words/);
  assert.match(P.TRANSLATE_SYSTEM, /NEVER guess a product name/);
  assert.match(P.TRANSLATE_SYSTEM, /\[\?\]/);
  assert.match(P.TRANSLATE_SYSTEM, /supports it unambiguously/);
  assert.match(P.TRANSLATE_SYSTEM, /correct a number that looks truncated/);
});

test('translate prompt shows ALT lines only where present; system explains how to use them', () => {
  const p = P.translatePrompt({ sentences: [{ n: 1, text: 'फिर लाइक्स पहले में लिखे', alt: 'फिर लाइक्स पहले कैच में लिखे Kafka' }, { n: 2, text: 'नतीजा' }], language: 'hi' });
  assert.match(p, /#1: फिर लाइक्स पहले में लिखे\n {4}ALT: फिर लाइक्स पहले कैच में लिखे Kafka/);
  assert.doesNotMatch(p.split('#2:')[1], /ALT/);
  assert.match(P.TRANSLATE_SYSTEM, /ALT line/); assert.match(P.TRANSLATE_SYSTEM, /main transcript decides the sentence/);
  assert.match(P.TRANSLATE_SYSTEM, /If neither does, write \[\?\]/);
});

// ───────── Hinglish captions + review ─────────
test('Hinglish prompt: one numbered line per caption, words separated by " | ", glossary included', () => {
  const p = P.translitPrompt({ lines: [['ओ', 'भाई,'], ['इमोशन', 'वीडियो']], terms: ['Remotion'] });
  assert.match(p, /^GLOSSARY: Remotion/); assert.match(p, /1: ओ \| भाई,/); assert.match(p, /2: इमोशन \| वीडियो/);
  assert.match(P.TRANSLIT_SYSTEM, /EXACTLY one Latin word per input word/); assert.match(P.TRANSLIT_SYSTEM, /No Devanagari/);
  assert.match(P.TRANSLIT_SYSTEM, /रिसेंटली→recently/); assert.match(P.TRANSLIT_SYSTEM, /Remotion/);
  assert.deepEqual(P.TRANSLIT_SCHEMA.properties.lines.items.required, ['n', 'words']);
});

test('review prompt: points at the contact sheet, lists what is said at each frame, asks for publish/fix', () => {
  const p = P.reviewPrompt({ contact: '/j/qa/contact.jpg', frames: [{ t: 2.5, label: 's1 Hook', said: 'Claude edited this video' }], concept: 'Claude edits reels' });
  assert.match(p, /Read the image \/j\/qa\/contact\.jpg/); assert.match(p, /@2\.5s card s1 Hook — being said: "Claude edited this video"/);
  assert.match(p, /Latin script/); assert.match(p, /black and white/); assert.match(p, /covering the speaker's face/);
  assert.deepEqual(P.REVIEW_SCHEMA.properties.verdict.enum, ['publish', 'fix']);
});

test('no prompt asks a model to write code or drive the editor any more', () => {
  for (const k of ['codegenPrompt', 'repairPrompt', 'editPrompt', 'editSystem']) assert.ok(!(k in P), k);
});

test('a fresh take shows the director earlier takes and demands a different angle, hook and cards', () => {
  const p = P.directorPrompt({ sentences: [{ n: 1, t: 0, text: 'x' }], duration: 5, library: 'L', previousTakes: [{ concept: 'Proof-first reveal', hook: 'Claude edited this', cards: ['Hook: Claude edited this', 'Screen'] }] });
  assert.match(p, /PREVIOUS TAKES of this same video/); assert.match(p, /Do NOT repeat them/); assert.match(p, /different opening hook/);
  assert.match(p, /Take 1: concept "Proof-first reveal" · hook "Claude edited this" · cards: Hook: Claude edited this \| Screen/);
  assert.match(p, /Keep every fact true to the speech/);
  assert.doesNotMatch(P.directorPrompt({ sentences: [{ n: 1, t: 0, text: 'x' }], duration: 5, library: 'L' }), /PREVIOUS TAKES/, 'reuse mode: no takes section');
});

test('doctrine carries the research numbers and agrees with the enforced guardrails', () => {
  const t = P.DIRECTOR_SYSTEM;
  assert.match(t, /FIRST 3 SECONDS/); assert.match(t, /0\.25 s/); assert.match(t, /≤4 words/);
  assert.match(t, /START BY 4\.0 s/, 'proof by 4 s');
  assert.match(t, /never static >3–4 s/); assert.match(t, /cards 2–5 s/); assert.ok(LIMITS.cardDurMax >= 5);
  assert.match(t, /110–118%/); assert.ok(LIMITS.zoomMin >= 1.1 && LIMITS.zoomMax <= 1.2);
  assert.match(t, /never >0\.16/); assert.equal(LIMITS.musicMax, 0.16);
  assert.match(t, /≥1 s per 2–3 words/); assert.equal(LIMITS.readWps, 2.5);
  assert.match(t, /SPLITS the frame/); assert.match(t, /layout 'full' on 1-2 cards/);
  assert.match(t, /SHOW, DON'T REPEAT/); assert.match(t, /https:\/\/github\.com\/owner\/name/); assert.match(t, /CERTAIN/);
  assert.match(t, /LANGUAGE: card text is ENGLISH/); assert.match(t, /PAYOFF/); assert.match(t, /loops/);
});

test('pass 1 — the script breakdown asks what a real director would: promise, open loop, 3 hooks, beat roles, first seconds, risks', () => {
  const t = P.BREAKDOWN_SYSTEM;
  for (const k of ['promise', 'open_loop', 'payoff', 'hooks', 'beats', 'first_seconds', 'risks']) assert.match(t, new RegExp(k), k);
  assert.match(t, /3 candidate opening hooks/); assert.match(t, /sound OFF/); assert.match(t, /hook\/body match/);
  assert.deepEqual(P.BREAKDOWN_SCHEMA.properties.beats.items.properties.role.enum, ['hook', 'promise', 'proof', 'mechanism', 'payoff', 'cta']);
  const p = P.breakdownPrompt({ sentences: [{ n: 1, t: 0.1, text: 'ओ भाई', en: 'Hey bro' }], duration: 24, language: 'hi', links: ['https://github.com/a/b'] });
  assert.match(p, /\[#1 @0\.1s\] ओ भाई {2}\|\| {2}EN: Hey bro/); assert.match(p, /CREATOR LINKS: https:\/\/github\.com\/a\/b/);
});

test('pass 2 — the shot list is built FROM the breakdown', () => {
  const p = P.directorPrompt({ sentences: [{ n: 1, t: 0, text: 'x' }], duration: 5, library: 'L', breakdown: { chosen_hook: 'Script in, reel out', promise: 'p' } });
  assert.match(p, /YOUR SCRIPT BREAKDOWN/); assert.match(p, /Script in, reel out/);
  assert.doesNotMatch(P.directorPrompt({ sentences: [{ n: 1, t: 0, text: 'x' }], duration: 5, library: 'L' }), /SCRIPT BREAKDOWN/);
});
