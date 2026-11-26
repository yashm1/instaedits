// Editorial look: warm paper, ink, ONE natural accent. No gradients, no glows, no neon — it should read like a
// well-designed magazine page laid over the video, not "AI". Colour is spent ONLY on what the viewer must look at.
// Keep this file dependency-free: it is unit-tested for WCAG contrast (test/theme.test.mjs).
export const theme = {
  bg: '#f3efe6', // warm paper
  card: '#fbf9f4', // a lighter sheet on the paper
  cardHi: '#ffffff', // the focused sheet
  line: '#d9d2c3', // hairlines
  text: '#16130e', // ink
  dim: '#4a443a', // secondary ink
  accent: '#c2410c', // burnt orange — the ONE thing to look at
  warm: '#2f4b7c', // slate blue — the second side of a Compare
  mute: '#8a8173', // graphics that are not the focus
  glow: '#e9e3d6', // a slightly darker paper for subtle fills (never a glow)
};

// Instagram UI covers ~14% top and ~20% bottom; captions live at ~68% height. Cards keep clear of all three.
export const safe = { top: 270, bottom: 620, tagTop: 276, contentTop: 350 };

// Canvas for every scene. server/config.mjs must match (enforced by test/config.test.mjs).
export const canvas = { width: 1080, height: 1920, fps: 30 };
