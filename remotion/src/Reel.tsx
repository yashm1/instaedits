import React from 'react';
import {AbsoluteFill, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {FULL_H, heightOf, panelAt, splitWindows, zoomAt} from './geometry';
import {loadFont} from '@remotion/google-fonts/Inter';
const captionFont = loadFont('normal', {weights: ['800'], subsets: ['latin']}).fontFamily;
import {Bullets, Chart, Code, Compare, Fanout, Flow, Hook, PanelContext, Repo, Screen, Site, Stat, Steps, theme, Title} from './lib';

// The whole reel in one composition: the speaker video + every card, laid out SPLIT (card panel on top, speaker below)
// whenever a card is on screen, full-frame speaker (with punch-ins) otherwise. Timing comes from the EDL in seconds, so
// cards land on the exact frame the words are spoken — nothing downstream re-times them.
export type ReelScene = {id: string; start: number; dur: number; kind: string; props: Record<string, unknown>; layout?: 'split' | 'full'};
export type ReelProps = {
  video: string; // path inside the bundle's public dir (the job folder), e.g. "tight.mp4"
  duration: number;
  scenes: ReelScene[];
  zooms: {start: number; dur: number; scale: number}[];
  assets?: unknown; // read by Repo/Site via getInputProps()
  screens?: unknown; // read by Screen via getInputProps()
  /** true: render ONLY the graphics on transparency; ffmpeg composites the untouched speaker pixels underneath (exact colour). */
  overlayOnly?: boolean;
  /** Caption lines (text + timing from the Edits app, Latin-script Hinglish). y = normalised centre (seam during a card). */
  captions?: CaptionLine[];
};
export type CaptionLine = {start: number; end: number; y: number; words: {text: string; start: number; end: number}[]};

const KINDS: Record<string, React.FC<any>> = {Hook, Title, Flow, Fanout, Steps, Chart, Code, Stat, Bullets, Compare, Repo, Site, Screen};

export {PANEL_H, FULL_H, splitWindows} from './geometry';

class Guard extends React.Component<{children: React.ReactNode}, {bad: boolean}> {
  state = {bad: false};
  static getDerivedStateFromError() { return {bad: true}; }
  render() { return this.state.bad ? <AbsoluteFill style={{background: theme.bg}} /> : this.props.children; }
}

export const Reel: React.FC<ReelProps> = ({video, scenes, zooms, overlayOnly, captions = []}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();

  // split amount and punch-in from the shared geometry (the ffmpeg compositor uses the very same functions)
  const {open: split, height: panelH} = panelAt(f, fps, scenes, splitWindows(scenes));
  const zoom = zoomAt(f, fps, zooms, split);

  const seam = panelH * split;
  return (
    <AbsoluteFill style={{background: overlayOnly ? 'transparent' : '#000'}}>
      {/* speaker: fills everything below the seam; object-fit keeps the face in the visible window.
          In overlayOnly mode ffmpeg reproduces exactly this geometry (y = SPEAKER_SHIFT·seam, same zoom) from the original file. */}
      {overlayOnly ? null : (
        <div style={{position: 'absolute', left: 0, right: 0, top: seam, bottom: 0, overflow: 'hidden'}}>
          <OffthreadVideo src={staticFile(video)} style={{width: '100%', height: '100%', objectFit: 'cover', objectPosition: '50% 30%', transform: `scale(${zoom})`, transformOrigin: '50% 34%'}} />
        </div>
      )}
      {/* card panel slides down from the top */}
      <div style={{position: 'absolute', left: 0, right: 0, top: 0, height: panelH, transform: `translateY(${-(1 - split) * panelH}px)`, overflow: 'hidden', background: theme.bg}}>
          {scenes.map((s) => {
            const C = KINDS[s.kind];
            if (!C) return null;
            const from = Math.round(s.start * fps), dur = Math.max(1, Math.round(s.dur * fps));
            return (
              <Sequence key={s.id} from={from} durationInFrames={dur} layout="none">
                {/* each card lays out for ITS own height: the split panel (960) or the full screen (1920) */}
                <PanelContext.Provider value={{height: heightOf(s)}}>
                  <div style={{position: 'absolute', left: 0, right: 0, top: 0, height: heightOf(s)}}><CardFade dur={dur} noFadeIn={from === 0}><Guard><C {...s.props} /></Guard></CardFade></div>
                </PanelContext.Provider>
              </Sequence>
            );
          })}
      </div>
      {/* seam: a thin ink line (hidden when a full-screen card covers the frame) */}
      {split > 0.01 && seam < FULL_H - 4 ? <div style={{position: 'absolute', left: 0, right: 0, top: seam - 2, height: 4, background: theme.text, opacity: split}} /> : null}
      <Captions lines={captions} t={f / fps} split={split} panelH={panelH} />
    </AbsoluteFill>
  );
};

/** Card-to-card handoff inside an open split: quick fade + small lift, so consecutive cards don't hard-cut. */
const CardFade: React.FC<{children: React.ReactNode; dur: number; noFadeIn?: boolean}> = ({children, dur, noFadeIn}) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [0, 6, dur - 6, dur], [noFadeIn ? 1 : 0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return <AbsoluteFill style={{opacity: o, transform: `translateY(${(1 - o) * 18}px)`}}>{children}</AbsoluteFill>;
};

// Captions: bold white words; the word being spoken sits on an accent box.
const CAPTION_PINK = theme.accent; // the one accent, also behind the spoken word
// Position follows the layout frame by frame: on the seam while a card shows, lower-middle on the full-frame speaker —
// so a line that outlives its card never ends up over the face.
const CAPTION_Y_FULL = 0.72, CAPTION_Y_ON_CARD = 0.76;
const Captions: React.FC<{lines: CaptionLine[]; t: number; split: number; panelH: number}> = ({lines, t, split, panelH}) => {
  const line = lines.find((l) => t >= l.start && t < l.end);
  if (!line) return null;
  // speaker full-frame → lower-middle; split → on the seam; full-screen card → low on the card, as INK on paper
  const target = Math.min(panelH, CAPTION_Y_ON_CARD * 1920);
  const y = CAPTION_Y_FULL * 1920 + (target - CAPTION_Y_FULL * 1920) * split;
  const onPaper = panelH * split > 1300;
  return (
    <div style={{position: 'absolute', left: 60, right: 60, top: y, transform: 'translateY(-50%)', display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '6px 14px', fontFamily: captionFont, fontWeight: 800, fontSize: 68, lineHeight: 1.12, color: onPaper ? theme.text : '#fff', textShadow: onPaper ? 'none' : '0 3px 12px rgba(0,0,0,0.55)'}}>
      {line.words.map((w, i) => {
        const on = t >= w.start && t < w.end;
        return <span key={i} style={{padding: '2px 12px', borderRadius: 12, background: on ? CAPTION_PINK : 'transparent', color: on ? '#fff' : undefined, textShadow: on ? 'none' : undefined}}>{w.text}</span>;
      })}
    </div>
  );
};
