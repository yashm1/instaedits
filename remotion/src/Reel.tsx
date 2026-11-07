import React from 'react';
import {AbsoluteFill, Easing, interpolate, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {Bullets, Chart, Code, Compare, Fanout, Flow, Hook, PanelContext, Repo, Screen, Site, Stat, Steps, theme, Title} from './lib';

// The whole reel in one composition: the speaker video + every card, laid out SPLIT (card panel on top, speaker below)
// whenever a card is on screen, full-frame speaker (with punch-ins) otherwise. Timing comes from the EDL in seconds, so
// cards land on the exact frame the words are spoken — nothing downstream re-times them.
export type ReelScene = {id: string; start: number; dur: number; kind: string; props: Record<string, unknown>};
export type ReelProps = {
  video: string; // path inside the bundle's public dir (the job folder), e.g. "tight.mp4"
  duration: number;
  scenes: ReelScene[];
  zooms: {start: number; dur: number; scale: number}[];
  assets?: unknown; // read by Repo/Site via getInputProps()
  screens?: unknown; // read by Screen via getInputProps()
};

const KINDS: Record<string, React.FC<any>> = {Hook, Title, Flow, Fanout, Steps, Chart, Code, Stat, Bullets, Compare, Repo, Site, Screen};

export const PANEL_H = 960; // top half of 1080x1920
const EASE_F = 11; // frames for the split to open/close
const MERGE_GAP = 0.7; // cards closer than this keep the split open (no bounce back to full-frame)

/** Merge card windows separated by < MERGE_GAP seconds into continuous split-layout windows. Exported for tests. */
export function splitWindows(scenes: ReelScene[]): {start: number; end: number}[] {
  const ws: {start: number; end: number}[] = [];
  for (const s of [...scenes].sort((a, b) => a.start - b.start)) {
    const last = ws[ws.length - 1];
    if (last && s.start - last.end < MERGE_GAP) last.end = Math.max(last.end, s.start + s.dur);
    else ws.push({start: s.start, end: s.start + s.dur});
  }
  return ws;
}

class Guard extends React.Component<{children: React.ReactNode}, {bad: boolean}> {
  state = {bad: false};
  static getDerivedStateFromError() { return {bad: true}; }
  render() { return this.state.bad ? <AbsoluteFill style={{background: theme.bg}} /> : this.props.children; }
}

export const Reel: React.FC<ReelProps> = ({video, scenes, zooms}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = f / fps;

  // split amount 0..1 (spring in at window start, out at window end)
  let split = 0;
  for (const w of splitWindows(scenes)) {
    const a = Math.round(w.start * fps), b = Math.round(w.end * fps);
    if (f < a - 1 || f > b + EASE_F) continue;
    const open = spring({frame: f - a, fps, config: {damping: 200}, durationInFrames: EASE_F});
    const close = spring({frame: f - (b - EASE_F), fps, config: {damping: 200}, durationInFrames: EASE_F});
    split = Math.max(split, Math.min(open, 1 - close));
  }

  // punch-in on the full-frame speaker only (never while split)
  let zoom = 1;
  for (const z of zooms) {
    const k = interpolate(t, [z.start, z.start + 0.25, z.start + z.dur - 0.25, z.start + z.dur], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)});
    zoom = Math.max(zoom, 1 + (z.scale - 1) * k * (1 - split));
  }

  const seam = PANEL_H * split;
  return (
    <AbsoluteFill style={{background: '#000'}}>
      {/* speaker: fills everything below the seam; object-fit keeps the face in the visible window */}
      <div style={{position: 'absolute', left: 0, right: 0, top: seam, bottom: 0, overflow: 'hidden'}}>
        <OffthreadVideo src={staticFile(video)} style={{width: '100%', height: '100%', objectFit: 'cover', objectPosition: '50% 30%', transform: `scale(${zoom})`, transformOrigin: '50% 34%'}} />
      </div>
      {/* card panel slides down from the top */}
      <div style={{position: 'absolute', left: 0, right: 0, top: 0, height: PANEL_H, transform: `translateY(${-(1 - split) * PANEL_H}px)`, overflow: 'hidden', background: theme.bg}}>
        <PanelContext.Provider value={{height: PANEL_H}}>
          {scenes.map((s) => {
            const C = KINDS[s.kind];
            if (!C) return null;
            const from = Math.round(s.start * fps), dur = Math.max(1, Math.round(s.dur * fps));
            return (
              <Sequence key={s.id} from={from} durationInFrames={dur} layout="none">
                <CardFade dur={dur}><Guard><C {...s.props} /></Guard></CardFade>
              </Sequence>
            );
          })}
        </PanelContext.Provider>
      </div>
      {/* seam: one accent hairline with a soft glow */}
      {split > 0.01 ? <div style={{position: 'absolute', left: 0, right: 0, top: seam - 2, height: 4, background: theme.accent, opacity: split, boxShadow: `0 0 24px ${theme.accent}`}} /> : null}
    </AbsoluteFill>
  );
};

/** Card-to-card handoff inside an open split: quick fade + small lift, so consecutive cards don't hard-cut. */
const CardFade: React.FC<{children: React.ReactNode; dur: number}> = ({children, dur}) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [0, 6, dur - 6, dur], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return <AbsoluteFill style={{opacity: o, transform: `translateY(${(1 - o) * 18}px)`}}>{children}</AbsoluteFill>;
};
