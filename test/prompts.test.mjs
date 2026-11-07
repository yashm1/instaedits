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

test('doctrine text agrees with the enforced guardrail numbers and the split layout', () => {
  const t = P.DIRECTOR_SYSTEM;
  assert.match(t, /≤4 words/);
  assert.match(t, /never >0\.16/); assert.equal(LIMITS.musicMax, 0.16);
  assert.match(t, /108-114%/); assert.ok(LIMITS.zoomMin >= 1.06 && LIMITS.zoomMax <= 1.14);
  assert.match(t, /cards 2-5s/); assert.ok(LIMITS.cardDurMax >= 5);
  assert.match(t, /SPLIT/); assert.match(t, /TOP HALF/); assert.match(t, /speaker stays visible/);
  assert.match(t, /NOVELTY/); assert.match(t, /sound OFF/);
  assert.match(t, /FIRST understand what the video is about/);
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

test('doctrine: card text English, real screenshots preferred, references only when certain', () => {
  const t = P.DIRECTOR_SYSTEM;
  assert.match(t, /LANGUAGE: all card text is ENGLISH/);
  assert.match(t, /SHOW THE REAL THING/); assert.match(t, /Screen card/); assert.match(t, /Site card/); assert.match(t, /github\.com\/owner\/name \(the actual repo page\)/);
  assert.match(t, /CERTAIN/); assert.match(t, /dropped if wrong/); assert.match(t, /Up to 3 Repo\/Site cards/);
  assert.match(t, /"this repo"/);
  assert.match(P.DIRECTOR_SCHEMA.properties.scenes.items.properties.anchor.description, /#N/);
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
