// One hero accent on a dark ground; everything else is neutral. Rationale: luminance contrast and
// saturation are what pull the eye first, so colour is spent ONLY on what the viewer must look at.
// Keep this file dependency-free: it is unit-tested for WCAG contrast (test/theme.test.mjs).
export const theme = {
  bg: '#080d1c',
  card: '#121a33',
  cardHi: '#18224a',
  line: '#27345f',
  text: '#f5f7ff',
  dim: '#a9b4da',
  accent: '#4de3c1', // the ONE thing to look at
  warm: '#ffd84d', // second side of a Compare / caption highlight on skin tones
  mute: '#7a88b8', // everything that is not the focus
  glow: '#2a3a9a', // background atmosphere only
};

// Instagram UI covers ~14% top and ~20% bottom; captions live at ~68% height. Cards keep clear of all three.
export const safe = { top: 270, bottom: 620, tagTop: 276, contentTop: 350 };

// Canvas for every scene. server/config.mjs must match (enforced by test/config.test.mjs).
export const canvas = { width: 1080, height: 1920, fps: 30 };
