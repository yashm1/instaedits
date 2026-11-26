// The split-screen geometry, per frame, in ONE place. Used by Reel.tsx (graphics) and by the pipeline's ffmpeg compositor
// (which places the untouched speaker pixels), so both layers move identically. Plain TS with no React: Node imports it directly.
import {Easing, interpolate, spring} from 'remotion';

export const PANEL_H = 960; // the card panel = top half of 1080x1920
export const FULL_H = 1920; // a FULL-SCREEN card covers the whole frame (the voice continues)
export const EASE_F = 11; // frames for the split to open/close
export const MERGE_GAP = 0.7; // cards closer than this keep the split open (no bounce back to full-frame)
// In the split, the speaker fills the area below the seam with object-fit: cover and objectPosition 50% 30%. For a
// 1080x1920 video in a 1080x(1920-seam) box that is exactly a downward shift of 0.7·seam (the top 30% of the cut is hidden).
export const SPEAKER_SHIFT = 0.7;
export const ZOOM_ORIGIN = {x: 0.5, y: 0.34}; // punch-ins scale around this point of the full frame

export type Win = {start: number; end: number};
export type Scene = {start: number; dur: number; layout?: 'split' | 'full'};
export const heightOf = (s: Scene) => (s.layout === 'full' ? FULL_H : PANEL_H);
export type Zoom = {start: number; dur: number; scale: number; style?: 'smooth' | 'jump'};

/** Merge card windows separated by < MERGE_GAP seconds into continuous split-layout windows. */
export function splitWindows(scenes: Scene[]): Win[] {
  const ws: Win[] = [];
  for (const s of [...scenes].sort((a, b) => a.start - b.start)) {
    const last = ws[ws.length - 1];
    if (last && s.start - last.end < MERGE_GAP) last.end = Math.max(last.end, s.start + s.dur);
    else ws.push({start: s.start, end: s.start + s.dur});
  }
  return ws;
}

/** Split amount 0..1 at a frame (spring in at window start, out at window end). */
export function splitAt(f: number, fps: number, wins: Win[]): number {
  let split = 0;
  for (const w of wins) {
    const a = Math.round(w.start * fps), b = Math.round(w.end * fps);
    if (f < a - 1 || f > b + EASE_F) continue;
    // a card at frame 0 (the opening hook) is fully open on the very first frame — no empty first frame / thumbnail
    const open = a === 0 ? 1 : spring({frame: f - a, fps, config: {damping: 200}, durationInFrames: EASE_F});
    const close = spring({frame: f - (b - EASE_F), fps, config: {damping: 200}, durationInFrames: EASE_F});
    split = Math.max(split, Math.min(open, 1 - close));
  }
  return split;
}

/**
 * The card panel at a frame: `open` 0..1 (slides in/out with the split windows) and its `height` (960 split / 1920 full).
 * Between two cards of one window that differ in layout the height springs from one to the other.
 */
export function panelAt(f: number, fps: number, scenes: Scene[], wins: Win[] = splitWindows(scenes)): {open: number; height: number} {
  const open = splitAt(f, fps, wins);
  const sorted = [...scenes].sort((a, b) => a.start - b.start);
  let cur: Scene | null = null, prev: Scene | null = null;
  for (const s of sorted) if (Math.round(s.start * fps) <= f) { prev = cur; cur = s; }
  if (!cur) return {open, height: sorted[0] ? heightOf(sorted[0]) : PANEL_H};
  const sameWindow = !!prev && cur.start - (prev.start + prev.dur) < MERGE_GAP;
  const k = sameWindow ? spring({frame: f - Math.round(cur.start * fps), fps, config: {damping: 200}, durationInFrames: EASE_F}) : 1;
  const from = prev && sameWindow ? heightOf(prev) : heightOf(cur);
  return {open, height: from + (heightOf(cur) - from) * k};
}

/** Punch-in scale at a frame — only on the full-frame speaker (fades out as the split opens). */
export function zoomAt(f: number, fps: number, zooms: Zoom[], split: number): number {
  const t = f / fps;
  let zoom = 1;
  for (const z of zooms) {
    // 'jump' = a jump-cut punch-in: snaps in/out over ~2 frames; 'smooth' eases over 0.25 s
    const r = z.style === 'jump' ? 0.067 : 0.25;
    const k = interpolate(t, [z.start, z.start + r, z.start + z.dur - r, z.start + z.dur], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)});
    zoom = Math.max(zoom, 1 + (z.scale - 1) * k * (1 - split));
  }
  return zoom;
}

/** Per-frame speaker placement for the compositor: y offset (px) and zoom. */
export function speakerTrack(scenes: Scene[], zooms: Zoom[], fps: number, frames: number): {y: number; zoom: number}[] {
  const wins = splitWindows(scenes);
  return Array.from({length: frames}, (_, f) => {
    const {open, height} = panelAt(f, fps, scenes, wins);
    return {y: +(SPEAKER_SHIFT * height * open).toFixed(2), zoom: +zoomAt(f, fps, zooms, open).toFixed(5)};
  });
}
