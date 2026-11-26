import { test } from 'node:test';
import assert from 'node:assert/strict';
import { theme, safe } from '../remotion/src/lib/theme.ts';

const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('primary text on background: AAA (≥7:1)', () => assert.ok(contrast(theme.text, theme.bg) >= 7));
test('secondary text on background: AAA (≥7:1)', () => assert.ok(contrast(theme.dim, theme.bg) >= 7));
test('hero accent on background and on cards: ≥4.5:1', () => {
  assert.ok(contrast(theme.accent, theme.bg) >= 4.5);
  assert.ok(contrast(theme.accent, theme.card) >= 4.5);
});
test('warm highlight (captions/compare) ≥7:1 on background', () => assert.ok(contrast(theme.warm, theme.bg) >= 7));
test('muted graphics are visible (≥3:1) but quieter than the accent', () => {
  assert.ok(contrast(theme.mute, theme.bg) >= 3);
  assert.ok(contrast(theme.mute, theme.bg) < contrast(theme.accent, theme.bg));
});
test('palette stays small and natural: paper, ink, one accent + one second colour', () => {
  assert.deepEqual(Object.keys(theme).sort(), ['accent', 'bg', 'card', 'cardHi', 'dim', 'glow', 'line', 'mute', 'text', 'warm']);
});
test('safe zones keep ≥14% top and ≥20% bottom clear on a 1920 canvas', () => {
  assert.ok(safe.tagTop >= 1920 * 0.14);
  assert.ok(safe.bottom >= 1920 * 0.2);
  assert.ok(safe.contentTop > safe.tagTop);
});

test('no "AI" look: warm light paper ground, and no gradients or glows anywhere in the card library', async () => {
  const fs = await import('node:fs');
  assert.ok(lum(theme.bg) > 0.8, 'light paper background');
  const n = parseInt(theme.bg.slice(1), 16); assert.ok((n >> 16) >= (n & 255), 'warm (red ≥ blue), not a cold/purple ground');
  const src = fs.readFileSync('remotion/src/lib/index.tsx', 'utf8') + fs.readFileSync('remotion/src/Reel.tsx', 'utf8');
  assert.doesNotMatch(src, /radial-gradient|linear-gradient\(/, 'no gradient backgrounds');
  assert.doesNotMatch(src, /boxShadow: `0 0 \d+px/, 'no coloured glows');
});

test('every card kind animates: no component renders static text only', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync('remotion/src/lib/index.tsx', 'utf8');
  const { SCENE_KINDS } = await import('../server/catalog.mjs');
  for (const k of SCENE_KINDS.filter((x) => x !== 'Title')) {
    const start = src.indexOf(`export const ${k}: React.FC`); assert.ok(start >= 0, k);
    const next = src.indexOf('export const ', start + 10);
    const body = src.slice(start, next < 0 ? undefined : next);
    assert.match(body, /useCurrentFrame|useSpring|interpolate|spring\(|<Cursor|<DrawIcon|<Marker|<FlowRow|<Link/, `${k} has no motion`);
  }
});
