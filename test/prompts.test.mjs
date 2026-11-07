import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../server/prompts.mjs';
import * as C from '../server/catalog.mjs';
import { LIMITS } from '../server/guardrails.mjs';

const props = P.DIRECTOR_SCHEMA.properties;

test('director schema enums are exactly the verified catalog', () => {
  assert.deepEqual(props.scenes.items.properties.kind.enum, C.SCENE_KINDS);
  assert.deepEqual(props.scenes.items.properties.transition_in.enum, C.TRANSITIONS);
  assert.deepEqual(props.sfx.items.properties.name.enum, C.SFX);
  assert.deepEqual(props.captions.properties.style.enum, C.CAPTION_STYLES);
  assert.deepEqual(props.music.properties.query.enum, C.MUSIC_QUERIES);
});

test('schema requires every section the resolver reads', () => {
  for (const k of ['scenes', 'zooms', 'sfx', 'captions', 'music', 'grade', 'remotion_brief']) assert.ok(P.DIRECTOR_SCHEMA.required.includes(k), k);
});

test('doctrine text agrees with the enforced guardrail numbers', () => {
  const t = P.DIRECTOR_SYSTEM;
  assert.match(t, /≤4 words/);
  assert.match(t, /never >0\.16/);
  assert.equal(LIMITS.musicMax, 0.16);
  assert.match(t, /108-114%/);
  assert.ok(LIMITS.zoomMin >= 1.06 && LIMITS.zoomMax <= 1.14);
  assert.match(t, /at most 10% of the words/);
  assert.match(t, /NOVELTY/);
  assert.match(t, /sound OFF/);
});

test('director prompt carries sentences with timestamps and the library', () => {
  const p = P.directorPrompt({ sentences: [{ n: 1, t: 1.234, text: 'Hello world.' }], duration: 20, library: '- `Hook`' });
  assert.match(p, /\[1\.2\] Hello world\./);
  assert.match(p, /20\.0s/);
  assert.match(p, /- `Hook`/);
});

const edl = {
  duration: 20.5,
  scenes: [{ id: 's1', start: 0.1, dur: 2, kind: 'Hook', tin: 'transition_blur', tout: 'transition_blur' }, { id: 's2', start: 5, dur: 3, kind: 'Flow', tin: 'transition_blur', tout: 'transition_blur' }],
  zooms: [{ start: 9, dur: 1, scale: 1.1 }],
  sfx: [{ at: 0.05, name: 'Whoosh (sharp)', volume: 0.3 }],
  captions: { style: 'Short Pop', highlightColor: '#FFD84D', keywords: ['Kafka', 'uptime'] },
  music: { query: 'minimal tech', fallbacks: ['lofi focus'], volume: 0.12, duckedVolume: 0.07, fadeIn: 0.6, fadeOut: 1.2 },
  grade: { note: 'subtle lift' },
};
const ep = (q = 'high') => P.editPrompt({ tight: '/j/tight.mp4', clipsDir: '/j/clips', edl, out: '/j/final.mp4', quality: q });

test('edit prompt contains every EDL decision verbatim', () => {
  const t = ep();
  for (const s of ['/j/tight.mp4', '/j/clips/s1.mp4', '/j/clips/s2.mp4', '0.1s +2s', 'Whoosh (sharp)', 'vol 0.3', 'Short Pop', '#FFD84D', 'Kafka, uptime', 'minimal tech', 'volume 0.12', '0.07', '110%', '-14 LUFS', '/j/final.mp4', '20.5s'])
    assert.ok(t.includes(s), `missing ${s}`);
});

test('edit prompt places captions at ~68% height inside safe zones, 2-3 words per line', () => {
  const t = ep();
  assert.match(t, /68%/); assert.match(t, /2-3 words/); assert.match(t, /top 14% and bottom 20%/);
});

test('high quality adds the QA pass; fast does not', () => {
  assert.match(ep('high'), /QA: previewVideoFrames/);
  assert.match(ep('fast'), /No QA pass/);
});

test('edit prompt forbids cutting the pre-tightened clip and mutes card audio', () => {
  assert.match(ep(), /do NOT cut or trim/); assert.match(ep(), /MUTE card audio/);
});

test('codegen prompt points at scenes.json for the right job and forbids restyling', () => {
  const t = P.codegenPrompt({ jobId: 'job-1' });
  assert.match(t, /jobs\/job-1\/scenes\.json/); assert.match(t, /do not restyle/);
});

test('verbatim mode (English): plain sentences, word anchors', () => {
  const p = P.directorPrompt({ sentences: [{ n: 1, t: 1, text: 'Hello.' }], duration: 5, library: 'L' });
  assert.match(p, /\[1\.0\] Hello\./); assert.match(p, /verbatim from the script/); assert.doesNotMatch(p, /#1/);
});

test('indexed mode (non-English): numbered speech with EN lines, "#N" anchors, English cards, spoken-language keywords', () => {
  const p = P.directorPrompt({ sentences: [{ n: 3, t: 7.25, text: 'यह तेज़ है', en: 'It is fast' }], duration: 20, library: 'L', indexed: true, language: 'hi' });
  assert.match(p, /\[#3 @7\.3s\] यह तेज़ है {2}\|\| {2}EN: It is fast/);
  assert.match(p, /use "#N"/); assert.match(p, /never words/);
  assert.match(p, /ENGLISH/); assert.match(p, /Hindi/);
  assert.match(p, /VERBATIM from the spoken text/);
  assert.doesNotMatch(p, /verbatim from the script/);
});

test('doctrine: card text is English regardless of spoken language; schema allows #N anchors', () => {
  assert.match(P.DIRECTOR_SYSTEM, /LANGUAGE: all on-screen card text and hook text is ENGLISH/);
  assert.match(P.DIRECTOR_SCHEMA.properties.scenes.items.properties.anchor.description, /#N/);
});

test('translate prompt: numbered input, keeps terms, optional reference, schema demands n+en', () => {
  const p = P.translatePrompt({ sentences: [{ n: 1, text: 'नमस्ते' }, { n: 2, text: 'Kafka तेज़ है' }], language: 'hi', reference: 'rough english draft' });
  assert.match(p, /from Hindi to English/); assert.match(p, /#1: नमस्ते/); assert.match(p, /#2: Kafka तेज़ है/); assert.match(p, /rough english draft/);
  assert.doesNotMatch(P.translatePrompt({ sentences: [{ n: 1, text: 'x' }], language: 'hi' }), /Reference/);
  assert.deepEqual(P.TRANSLATE_SCHEMA.properties.sentences.items.required, ['n', 'en']);
  assert.match(P.TRANSLATE_SYSTEM, /technical terms/); assert.match(P.TRANSLATE_SYSTEM, /Do not summarise/);
  assert.equal(P.languageName('hi'), 'Hindi'); assert.equal(P.languageName('fr'), 'fr');
});

test('edit prompt: caption language follows the EDL; non-English adds the glyph check', () => {
  assert.match(ep(), /language en;/); assert.doesNotMatch(ep(), /SPOKEN language/);
  const hi = P.editPrompt({ tight: '/t.mp4', clipsDir: '/c', edl: { ...edl, language: 'hi' }, out: '/o.mp4', quality: 'high' });
  assert.match(hi, /language hi;/); assert.match(hi, /SPOKEN language \(hi\)/); assert.match(hi, /glyphs/); assert.match(hi, /"Default"/);
});

test('translator must flag likely-dropped words with [?] and never guess names or numbers', () => {
  assert.match(P.TRANSLATE_SYSTEM, /OFTEN DROPS English words/);
  assert.match(P.TRANSLATE_SYSTEM, /NEVER guess a product name/);
  assert.match(P.TRANSLATE_SYSTEM, /\[\?\]/);
  assert.match(P.TRANSLATE_SYSTEM, /supports it unambiguously/);
  assert.match(P.TRANSLATE_SYSTEM, /correct a number that looks truncated/);
});

test('director must not build claims on [?] spots', () => {
  assert.match(P.DIRECTOR_SYSTEM, /TRUST/);
  assert.match(P.DIRECTOR_SYSTEM, /\[\?\]/);
  assert.match(P.DIRECTOR_SYSTEM, /Never invent facts/);
});

test('translate prompt shows ALT lines only where present; system explains how to use them', () => {
  const p = P.translatePrompt({ sentences: [{ n: 1, text: 'फिर लाइक्स पहले में लिखे', alt: 'फिर लाइक्स पहले कैच में लिखे Kafka' }, { n: 2, text: 'नतीजा' }], language: 'hi' });
  assert.match(p, /#1: फिर लाइक्स पहले में लिखे\n {4}ALT: फिर लाइक्स पहले कैच में लिखे Kafka/);
  assert.doesNotMatch(p.split('#2:')[1], /ALT/);
  assert.match(P.TRANSLATE_SYSTEM, /ALT line/); assert.match(P.TRANSLATE_SYSTEM, /main transcript decides the sentence/);
  assert.match(P.TRANSLATE_SYSTEM, /If neither does, write \[\?\]/);
});

test('doctrine tells the director to show real repos/sites only when certain, capped, never first', () => {
  const t = P.DIRECTOR_SYSTEM;
  assert.match(t, /REFERENCES/); assert.match(t, /Repo card/); assert.match(t, /Site card/);
  assert.match(t, /CERTAIN/); assert.match(t, /dropped if wrong/); assert.match(t, /Up to 3 per video/); assert.match(t, /never as the opening card/);
  assert.match(t, /where it is first named/); assert.match(t, /proper name/); assert.doesNotMatch(t, /never for a passing mention/, 'too timid: central tools (Kafka) were being skipped');
  assert.ok(P.DIRECTOR_SCHEMA.properties.scenes.items.properties.kind.enum.includes('Repo'));
  assert.ok(P.DIRECTOR_SCHEMA.properties.scenes.items.properties.kind.enum.includes('Site'));
});
