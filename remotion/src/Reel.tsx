import React from 'react';
import {AbsoluteFill, Easing, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {FULL_H, heightOf, panelAt, splitWindows, zoomAt} from './geometry';
import {loadFont} from '@remotion/google-fonts/Inter';
const captionFont = loadFont('normal', {weights: ['800'], subsets: ['latin']}).fontFamily;
import {Bullets, CardContext, Chart, Code, Compare, Fanout, Flow, Hook, PanelContext, Repo, Screen, Site, Stat, Steps, theme, Title} from './lib';

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
  /** face-tracked effect windows on the speaker; 'low' ones draw UI at chest height, so captions move above the head */
  effects?: {start: number; end: number; zone: 'low' | 'high'}[];
};
export type CaptionLine = {start: number; end: number; y: number; words: {text: string; start: number; end: number}[]};

const KINDS: Record<string, React.FC<any>> = {Hook, Title, Flow, Fanout, Steps, Chart, Code, Stat, Bullets, Compare, Repo, Site, Screen};

export {PANEL_H, FULL_H, splitWindows} from './geometry';

class Guard extends React.Component<{children: React.ReactNode}, {bad: boolean}> {
  state = {bad: false};
  static getDerivedStateFromError() { return {bad: true}; }
  render() { return this.state.bad ? <AbsoluteFill style={{background: theme.bg}} /> : this.props.children; }
}

export const Reel: React.FC<ReelProps> = ({video, scenes, zooms, overlayOnly, captions = [], effects = []}) => {
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
                <PanelContext.Provider value={{height: heightOf(s)}}><CardContext.Provider value={{dur}}>
                  <div style={{position: 'absolute', left: 0, right: 0, top: 0, height: heightOf(s), overflow: 'hidden'}}><CardFade dur={dur} noFadeIn={from === 0}><Guard><C {...s.props} /></Guard></CardFade></div>
                </CardContext.Provider></PanelContext.Provider>
              </Sequence>
            );
          })}
      </div>
      {/* seam: a thin ink line (hidden when a full-screen card covers the frame) */}
      {split > 0.01 && seam < FULL_H - 4 ? <div style={{position: 'absolute', left: 0, right: 0, top: seam - 2, height: 4, background: theme.text, opacity: split}} /> : null}
      <Captions lines={captions} t={f / fps} split={split} panelH={panelH} lift={effects.some((e) => e.zone === 'low' && f / fps >= e.start - 0.1 && f / fps < e.end + 0.1)} />
    </AbsoluteFill>
  );
};

/**
 * Every card performs for its whole time on screen (motion doctrine):
 * - SEAMS move with one current (LEFT): enter from the right already in motion (power4.out), leave to the left still
 *   moving (power4.in) — never a crossfade, never starting or ending at rest.
 * - CAMERA WITH INTENT: a slow push-in drifting with the current across the card's life (not an idle wobble).
 */
const CardFade: React.FC<{children: React.ReactNode; dur: number; noFadeIn?: boolean}> = ({children, dur, noFadeIn}) => {
  const f = useCurrentFrame();
  const IN = 9, OUT = 7, D = 90;
  // Carbon expressive entrance / exit curves; entrance 300 ms > exit ~230 ms (NN/g)
  const enter = noFadeIn ? 1 : interpolate(f, [0, IN], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0, 0, 0.3, 1)});
  const exit = interpolate(f, [dur - OUT, dur], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.4, 0.14, 1, 1)});
  const x = (1 - enter) * D - exit * D;
  const opacity = Math.min(noFadeIn ? 1 : interpolate(f, [0, 4], [0, 1], {extrapolateRight: 'clamp'}), 1 - interpolate(f, [dur - 4, dur], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}));
  const life = interpolate(f, [0, dur], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.sin)});
  return <AbsoluteFill style={{opacity, transform: `translateX(${x + 10 - life * 20}px) scale(${1 + life * 0.045})`, transformOrigin: '50% 45%'}}>{children}</AbsoluteFill>;
};

// Captions: bold white words; the word being spoken sits on an accent box.
const CAPTION_PINK = theme.accent; // the one accent, also behind the spoken word
// Position follows the layout frame by frame: on the seam while a card shows, lower-middle on the full-frame speaker —
// so a line that outlives its card never ends up over the face.
const CAPTION_Y_FULL = 0.72, CAPTION_Y_ON_CARD = 0.745; // on a full card: below its content zone (ends ~1300 px), above the IG bottom UI
const LEAD = 0.15; // captions appear 0.1-0.3 s BEFORE the audio (research): the eye arrives as the word is heard
const CAPTION_Y_LIFTED = 0.215; // above the head, just below Instagram's top bar — while a chest-height effect shows
const Captions: React.FC<{lines: CaptionLine[]; t: number; split: number; panelH: number; lift?: boolean}> = ({lines, t: now, split, panelH, lift}) => {
  const t = now + LEAD;
  const line = lines.find((l) => t >= l.start && t < l.end);
  if (!line) return null;
  // speaker full-frame → lower-middle; split → on the seam; full-screen card → low on the card, as INK on paper
  const target = Math.min(panelH, CAPTION_Y_ON_CARD * 1920);
  const y = lift && split < 0.01 ? CAPTION_Y_LIFTED * 1920 : CAPTION_Y_FULL * 1920 + (target - CAPTION_Y_FULL * 1920) * split;
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
