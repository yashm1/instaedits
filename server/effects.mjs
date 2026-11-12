// Face-tracked effects on the speaker's own footage (words BEHIND the head, spotlight, a comment box typing itself, a
// Follow tap, checklists…) from github.com/Vibha-Ramprakash/claude-video-effects (MIT; models MIT/Apache-2.0; fonts OFL).
// Optional: installed by `npm run effects:install` into vendor/ at a reviewed commit. Only SHORT segments around each
// effect are rendered, and the composite swaps them in only inside the effect windows — everywhere else the camera's
// original pixels stay untouched (and QA's colour check skips the windows).
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.mjs';

export const FX_COMMIT = '60840ac';

/** The curated subset the director may use: no extra assets needed, made for talking-head pattern interrupts. */
export const FX_CATALOG = {
  'backdrop-word': { about: 'a giant word drops in BEHIND the speaker\'s head', text: 'one word, ≤10 letters', max: 10 },
  spotlight: { about: 'the room goes dark, the speaker stays lit, a glowing word behind them', text: 'one word', max: 12 },
  'glitter-spotlight': { about: 'golden rays burst from behind the head, a big gold word, sparkles — for a WOW/result moment', text: 'one word', max: 12 },
  'crayon-write': { about: 'a red crayon writes a word behind the head, then underlines it', text: 'one word', max: 10 },
  'huge-strike': { about: 'one huge serif word behind the head gets crossed out in red — busting a myth / "not X"', text: 'the word being rejected', max: 10 },
  'led-sign': { about: 'the lights drop and a glowing LED sign types itself out behind the speaker', text: '1-2 short lines joined by |', max: 24 },
  'tape-label': { zone: 'low', about: 'a strip of yellow tape with a short line lands on the chest', text: '2-4 words', max: 24 },
  'reject-stamp': { about: 'a big red stamp slams down — NO / WRONG / MYTH', text: 'one word', max: 10 },
  'lean-in': { about: 'a fast camera punch-in on one emphatic word', text: null },
  'locked-on': { about: 'corner brackets snap onto the face and the camera follows', text: 'optional tag, 1-2 words', max: 16 },
  'slow-push': { about: 'a slow cinematic push-in while the room melts out of focus — for a serious beat', text: null },
  todo: { zone: 'low', about: 'a checklist card beside the head ticks off as the speaker talks', text: '2-4 items joined by |', max: 70 },
  checklist: { zone: 'low', about: 'a task list under the chin, each step spins then ticks green', text: '2-4 steps joined by |', max: 70 },
  'apple-toggles': { zone: 'low', about: 'iPhone switches flip on one line at a time', text: '2-4 rows joined by |', max: 70 },
  'liquid-glass-graph': { zone: 'low', about: 'a glass card where a graph climbs and a number counts up (needs the real number)', text: 'label (and set opts.to, e.g. "10x")', max: 24 },
  messages: { zone: 'low', about: 'iMessage notifications pop in one after another', text: '2-3 short messages joined by |', max: 90 },
  'comment-box': { zone: 'low', about: 'an Instagram comment types a word and posts — perfect for "comment X" calls to action', text: 'the word to comment', max: 12 },
  tap: { zone: 'low', about: 'a Follow button pops up and flips to Following — for a "follow" call to action', text: null },
  'select-resize': { about: 'a selection box grabs a number above the head and a cursor drags it bigger', text: 'a short number like 10X', max: 8 },
  'countdown-flip': { about: 'a 3, 2, 1 flip clock above the head', text: null },
  'pause-point': { about: 'freeze frame with a hand-drawn arrow pointing at the speaker', text: 'a 1-3 word label', max: 20 },
  scribble: { about: 'marker doodles draw themselves around the speaker', text: 'optional 1-2 word label', max: 16 },
};
/** Where an effect draws: 'low' = chest/chin UI (captions move above the head while it shows); otherwise behind/around the head. */
export const fxZone = (name) => FX_CATALOG[name]?.zone ?? 'high';
export const FX_LIMITS = { max: 4, durMin: 1.5, durMax: 4, pad: 0.5, merge: 1.0 };

export const fxDir = () => path.join(config.effectsDir);
export const fxPython = () => path.join(fxDir(), '.venv', 'bin', 'python');
export const fxScript = () => path.join(fxDir(), 'scripts', 'fx.py');
/** Installed = the pinned checkout and its venv are present. */
export function fxInstalled() { return fs.existsSync(fxScript()) && fs.existsSync(fxPython()); }

/**
 * Segments to render: effect windows merged when < FX_LIMITS.merge apart, padded by FX_LIMITS.pad (the tracker wants a
 * little context), clipped to the clip. Each segment carries its effects with times RELATIVE to the segment. Pure.
 */
export function fxSegments(effects, duration) {
  const sorted = [...effects].sort((a, b) => a.start - b.start);
  const groups = [];
  for (const e of sorted) {
    const g = groups.at(-1);
    if (g && e.start - g.end < FX_LIMITS.merge) { g.items.push(e); g.end = Math.max(g.end, e.end); } else groups.push({ start: e.start, end: e.end, items: [e] });
  }
  return groups.map((g) => {
    const a = Math.max(0, g.start - FX_LIMITS.pad), b = Math.min(duration, g.end + FX_LIMITS.pad);
    return {
      offset: +a.toFixed(3), length: +(b - a).toFixed(3),
      windows: g.items.map((e) => [e.start, e.end]),
      plan: { effects: g.items.map(({ fx, start, end, text, opts }) => ({ fx, start: +(start - a).toFixed(3), end: +(end - a).toFixed(3), ...(text ? { text } : {}), ...(opts ?? {}) })) },
    };
  });
}
