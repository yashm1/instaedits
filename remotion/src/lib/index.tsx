import React from 'react';
import {AbsoluteFill, Easing, getInputProps, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {loadFont} from '@remotion/google-fonts/Inter';
import {loadFont as loadMono} from '@remotion/google-fonts/JetBrainsMono';
import {theme, safe} from './theme';

const {fontFamily} = loadFont('normal', {weights: ['500', '700', '800'], subsets: ['latin']});
const mono = loadMono('normal', {weights: ['500'], subsets: ['latin']}).fontFamily;

export {theme, safe};

// paper, not glow: a soft contact shadow and a barely-there grain (an SVG noise tile, inline)
const SHADOW = '0 1px 0 #0000000a, 0 12px 28px -14px #3a2f1f55';
const FULL_ZOOM = 1.32; // type scale of a full-screen card relative to the split panel
const SHADOW_BIG = '0 2px 0 #0000000d, 0 26px 60px -24px #3a2f1f66';
const GRAIN = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0.35  0 0 0 0 0.3  0 0 0 0 0.22  0 0 0 0.09 0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>')}")`;

// ───────── motion helpers ─────────
// Entrances: IBM Carbon "expressive entrance" cubic-bezier(0,0,0.3,1) over 300 ms — ease-out, no bounce, never linear
// (NN/g: 200-400 ms for substantial moves). The name stays for the call sites; extra args are ignored.
const ENTER = Easing.bezier(0, 0, 0.3, 1);
const useSpring = (delay = 0, _stiffness?: number, _damping?: number) => {
  const f = useCurrentFrame();
  return interpolate(f - delay, [0, 9], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ENTER});
};
const pop = (p: number, rise = 36) => ({opacity: Math.min(1, p * 1.4), transform: `translateY(${(1 - p) * rise}px) scale(${0.95 + 0.05 * p})`});
const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

// ───────── stage: background, safe zones (IG UI top, captions bottom) ─────────
/**
 * Cards render either full-frame (1080x1920, standalone) or inside the TOP PANEL of the split layout (1080x960, the speaker
 * is in the bottom half). In the panel, content is measured and scaled down to fit, so no card ever clips or overflows.
 */
export const PanelContext = React.createContext<{height: number} | null>(null);
/** How long THIS card is on screen (frames). useVideoConfig() inside a Sequence still reports the whole reel. */
export const CardContext = React.createContext<{dur: number} | null>(null);
const useCardDur = () => { const c = React.useContext(CardContext); const {durationInFrames} = useVideoConfig(); return c?.dur ?? durationInFrames; };
/**
 * STAGED REVEALS (motion doctrine: "pause at any second — something meaningful must be mid-flight"): reveal i of n lands
 * between the card's first frames and ~60% of its time on screen, so the frame keeps gaining information until it leaves.
 */
const useBeats = (n: number) => {
  const D = useCardDur();
  const first = 5, last = Math.max(first + (n - 1) * 7, Math.round(D * 0.6));
  return (i: number) => (n <= 1 ? first : Math.round(first + ((last - first) * i) / (n - 1)));
};

const FitBox: React.FC<{children: React.ReactNode; maxH: number; align: 'center' | 'start'}> = ({children, maxH, align}) => {
  const ref = React.useRef<HTMLDivElement>(null);
  const [h, setH] = React.useState<number | null>(null);
  React.useLayoutEffect(() => { const n = ref.current?.scrollHeight ?? 0; if (n && n !== h) setH(n); });
  const k = h ? Math.min(1, maxH / h) : 1;
  const top = align === 'center' && h ? Math.max(0, (maxH - h * k) / 2) : 0;
  return (
    <div style={{position: 'relative', height: maxH}}>
      <div ref={ref} style={{position: 'absolute', left: 0, right: 0, top, transform: `scale(${k})`, transformOrigin: 'top center'}}>{children}</div>
    </div>
  );
};

const Stage: React.FC<{children: React.ReactNode; tag?: string; align?: 'center' | 'start'; typeZoom?: boolean}> = ({children, tag, align = 'center', typeZoom = true}) => {
  const f = useCurrentFrame();
  const t = f / 30;
  const ctx = React.useContext(PanelContext);
  const panel = ctx && ctx.height < 1200 ? ctx : null; // a FULL-SCREEN card lays out with the full-frame safe zones
  const full = !!ctx && ctx.height >= 1200 && typeZoom; // the bigger type scale (screenshots opt out: they size to the frame)
  // panel: IG's top bar covers ~120px of the frame; keep the tag below it and leave a margin above the seam
  const z = panel ? {tagTop: 128, contentTop: 196, bottom: 54, side: 64} : {tagTop: safe.tagTop, contentTop: safe.contentTop, bottom: safe.bottom, side: 76};
  const H = panel ? panel.height : 1920;
  const tagP = useSpring(0);
  return (
    <AbsoluteFill style={{background: theme.bg, fontFamily, color: theme.text, overflow: 'hidden'}}>
      <AbsoluteFill style={{backgroundImage: GRAIN, opacity: 0.5, mixBlendMode: 'multiply'}} />
      {tag ? (
        <div style={{position: 'absolute', top: z.tagTop, left: z.side, display: 'flex', alignItems: 'center', gap: 16, ...pop(tagP)}}>
          <div style={{width: 14, height: 14, borderRadius: 7, background: theme.accent}} />
          <div style={{fontSize: 30, letterSpacing: 7, color: theme.accent, textTransform: 'uppercase', fontWeight: 800}}>{tag}</div>
        </div>
      ) : null}
      <div style={{position: 'absolute', left: z.side, right: z.side, top: z.contentTop}}>
        {/* a FULL-SCREEN card has 2× the room: a bigger type scale (CSS zoom reflows, unlike transform); FitBox still guards overflow */}
        <FitBox maxH={(H - z.contentTop - z.bottom) / (full ? FULL_ZOOM : 1)} align={align}><div style={full ? {zoom: FULL_ZOOM} : undefined}>{children}</div></FitBox>
      </div>
    </AbsoluteFill>
  );
};

// ───────── icons ─────────
const ICONS: Record<string, React.ReactNode> = {
  client: <><rect x="14" y="6" width="20" height="36" rx="5" /><circle cx="24" cy="36" r="1.6" /></>,
  server: <><rect x="8" y="10" width="32" height="13" rx="3" /><rect x="8" y="26" width="32" height="13" rx="3" /><circle cx="15" cy="16.5" r="1.6" /><circle cx="15" cy="32.5" r="1.6" /></>,
  db: <><ellipse cx="24" cy="12" rx="14" ry="5" /><path d="M10 12v24c0 3 6 5 14 5s14-2 14-5V12" /><path d="M10 24c0 3 6 5 14 5s14-2 14-5" /></>,
  queue: <><rect x="5" y="16" width="10" height="16" rx="2" /><rect x="19" y="16" width="10" height="16" rx="2" /><rect x="33" y="16" width="10" height="16" rx="2" /></>,
  cache: <path d="M27 5L11 27h11l-2 16 17-23H26z" />,
  lb: <><circle cx="24" cy="10" r="4.5" /><circle cx="9" cy="38" r="4.5" /><circle cx="24" cy="38" r="4.5" /><circle cx="39" cy="38" r="4.5" /><path d="M24 15v6M24 21L9 33.5M24 21v12.5M24 21l15 12.5" /></>,
  cloud: <path d="M14 37a8.5 8.5 0 010-17 11 11 0 0120-3 8.5 8.5 0 011 20z" />,
  lock: <><rect x="10" y="22" width="28" height="19" rx="4" /><path d="M16 22v-6a8 8 0 0116 0v6" /></>,
  ai: <><circle cx="24" cy="24" r="6" /><path d="M24 4v8M24 36v8M4 24h8M36 24h8M10 10l6 6M32 32l6 6M38 10l-6 6M16 32l-6 6" /></>,
  user: <><circle cx="24" cy="15" r="8" /><path d="M8 42c0-9 7-14 16-14s16 5 16 14" /></>,
  api: <><path d="M16 14l-10 10 10 10M32 14l10 10-10 10M28 10L20 38" /></>,
};
export type IconName = keyof typeof ICONS | string;
const Icon: React.FC<{name?: IconName; size?: number; color?: string}> = ({name, size = 64, color = theme.accent}) =>
  name && ICONS[name] ? (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">{ICONS[name]}</svg>
  ) : null;

const usePanel = () => { const c = React.useContext(PanelContext); return c !== null && c.height < 1200; }; // split panel (not full screen)
// ───────── motion toolkit: nothing on screen is static text ─────────
/** A library icon that DRAWS ITSELF on (every stroke animates from 0 to full length), then settles. */
const DrawIcon: React.FC<{name?: IconName; size?: number; color?: string; delay?: number; dur?: number}> = ({name, size = 120, color = theme.accent, delay = 0, dur = 18}) => {
  const f = useCurrentFrame();
  if (!name || !ICONS[name]) return null;
  const p = interpolate(f - delay, [0, dur], [0, 1], {...clamp, easing: Easing.inOut(Easing.cubic)});
  const kids = React.Children.toArray((ICONS[name] as React.ReactElement<{children?: React.ReactNode}>).props.children ?? ICONS[name]);
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke={color} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" style={{transform: `scale(${0.92 + 0.08 * p})`, opacity: p > 0.01 ? 1 : 0}}>
      {kids.map((el, i) => React.isValidElement(el) ? React.cloneElement(el as React.ReactElement<Record<string, unknown>>, {key: i, pathLength: 1, strokeDasharray: 1, strokeDashoffset: 1 - p}) : null)}
    </svg>
  );
};
/** A highlighter stroke that sweeps in behind a word (left → right). */
const Marker: React.FC<{children: React.ReactNode; delay?: number; color?: string; ink?: string}> = ({children, delay = 0, color = theme.accent, ink = '#fff'}) => {
  const f = useCurrentFrame();
  const p = interpolate(f - delay, [0, 9], [0, 1], {...clamp, easing: Easing.out(Easing.cubic)});
  return (
    <span style={{position: 'relative', display: 'inline-block', padding: '0 14px', color: p > 0.5 ? ink : 'inherit'}}>
      <span style={{position: 'absolute', left: 0, top: '8%', bottom: '4%', width: `${p * 100}%`, background: color, borderRadius: 10, transform: 'skewX(-6deg)', zIndex: 0}} />
      <span style={{position: 'relative', zIndex: 1}}>{children}</span>
    </span>
  );
};
/** A pointer that glides in from below-right to (x, y) — fractions of its parent — then clicks (press + ripple). */
const Cursor: React.FC<{x: number; y: number; delay?: number; travel?: number}> = ({x, y, delay = 8, travel = 22}) => {
  const f = useCurrentFrame();
  const p = interpolate(f - delay, [0, travel], [0, 1], {...clamp, easing: Easing.inOut(Easing.cubic)});
  const click = f - delay - travel;
  const press = click >= 0 && click < 6 ? 0.86 : 1;
  const ring = interpolate(click, [0, 14], [0, 1], clamp);
  const cx = interpolate(p, [0, 1], [x + 0.28, x]), cy = interpolate(p, [0, 1], [y + 0.32, y]);
  return (
    <div style={{position: 'absolute', left: `${cx * 100}%`, top: `${cy * 100}%`, pointerEvents: 'none', opacity: interpolate(f - delay, [0, 4], [0, 1], clamp)}}>
      {click >= 0 ? <div style={{position: 'absolute', left: -28, top: -28, width: 56, height: 56, borderRadius: 28, border: `3px solid ${theme.accent}`, opacity: 1 - ring, transform: `scale(${0.4 + ring})`}} /> : null}
      <svg width="46" height="46" viewBox="0 0 24 24" style={{transform: `scale(${press})`, transformOrigin: '2px 2px', filter: 'drop-shadow(0 3px 4px #0005)'}}><path d="M2 2l7.5 19 2.6-7.9L20 10.5z" fill="#111" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" /></svg>
    </div>
  );
};

const Heading: React.FC<{text?: string}> = ({text}) => {
  const panel = usePanel();
  const p = useSpring(0);
  return text ? <div style={{fontSize: panel ? 66 : 68, fontWeight: 800, lineHeight: 1.06, marginBottom: panel ? 30 : 54, ...pop(p)}}>{text}</div> : null;
};

// ───────── scenes ─────────
/** Hook / statement — kinetic words, the `hot` word gets a highlighter sweep, an icon draws itself on. `opening`: FRAME 0
 * of the reel — fully legible on the first frame, then the marker sweeps and the icon draws; optional real `shot` behind. */
export const Hook: React.FC<{text: string; hot?: string[]; sub?: string; tag?: string; opening?: boolean; shot?: string; icon?: IconName}> = ({text, hot = [], sub, tag, opening, shot, icon}) => {
  const f = useCurrentFrame();
  const panel = usePanel();
  const words = text.split(' ');
  const isHot = (w: string) => hot.some((h) => w.toLowerCase().replace(/[^a-z0-9]/g, '') === h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const D = useCardDur();
  const subP = useSpring(opening ? Math.round(D * 0.35) : Math.max(words.length * 4 + 4, Math.round(D * 0.4)));
  const size = panel ? (text.length > 22 ? 112 : 136) : 124;
  const line = (
    <div style={{fontSize: opening ? size + 12 : size, fontWeight: 800, lineHeight: 1.04, letterSpacing: -3, display: 'flex', flexWrap: 'wrap', gap: '4px 24px'}}>
      {words.map((w, i) => {
        const p = opening ? 1 : spring({frame: f - i * 4, fps: 30, config: {damping: 14, stiffness: 190}});
        return <span key={i} style={{display: 'inline-block', ...pop(p, 46)}}>{isHot(w) ? <Marker delay={opening ? 3 : i * 4 + 6}>{w}</Marker> : w}</span>;
      })}
    </div>
  );
  // a hand-drawn underline that draws in after the words (motion even when there is no icon)
  const u = interpolate(f, [opening ? 8 : words.length * 4 + 6, (opening ? 8 : words.length * 4 + 6) + 14], [0, 1], {...clamp, easing: Easing.out(Easing.cubic)});
  const underline = <svg width="420" height="26" viewBox="0 0 420 26" style={{marginTop: 18, display: 'block'}}><path d="M4 16 C 90 4, 180 24, 270 12 S 380 8, 416 14" fill="none" stroke={theme.accent} strokeWidth="7" strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - u} opacity={u > 0.01 ? 1 : 0} /></svg>;
  const body = (
    <div style={{display: 'flex', alignItems: 'center', gap: 34}}>
      <div style={{flex: 1, minWidth: 0}}>
        {line}{underline}
        {sub ? <div style={{fontSize: panel ? 50 : 48, color: theme.dim, marginTop: 18, fontWeight: 600, ...pop(subP, 20)}}>{sub}</div> : null}
      </div>
      {icon ? <div style={{flex: 'none'}}><DrawIcon name={icon} size={panel ? 190 : 220} delay={opening ? 4 : 8} /></div> : null}
    </div>
  );
  if (opening) {
    const screens = (getInputProps() as {screens?: Record<string, {file: string}>}).screens ?? {};
    const bg = shot ? screens[shot] : undefined;
    const settle = interpolate(f, [0, 24], [1.04, 1], {...clamp, easing: Easing.out(Easing.cubic)});
    return (
      <AbsoluteFill style={{background: theme.bg, fontFamily, color: theme.text, overflow: 'hidden'}}>
        {bg ? <><Img src={staticFile(bg.file)} style={{position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${1.12 + (settle - 1) * 2})`}} /><AbsoluteFill style={{background: theme.bg, opacity: 0.9}} /></> : null}
        <AbsoluteFill style={{backgroundImage: GRAIN, opacity: 0.5, mixBlendMode: 'multiply'}} />
        <AbsoluteFill style={{padding: panel ? '150px 64px 70px' : '360px 76px 620px', justifyContent: 'center', transform: `scale(${settle})`, transformOrigin: '30% 50%'}}>
          {tag ? <div style={{fontSize: 28, letterSpacing: 6, color: theme.accent, fontWeight: 800, textTransform: 'uppercase', marginBottom: 20}}>{tag}</div> : null}
          {body}
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }
  return <Stage tag={tag} align={panel ? 'center' : 'start'}>{body}</Stage>;
};
export const Title: React.FC<{text: string; sub?: string; tag?: string}> = ({text, sub, tag}) => <Hook text={text} sub={sub} tag={tag} />;

/** Vertical architecture flow with animated data packets. */
export const Flow: React.FC<{title?: string; nodes: {label: string; note?: string; icon?: IconName}[]; highlight?: number | string; tag?: string}> = ({title, nodes, highlight, tag}) => {
  const f = useCurrentFrame();
  const panel = usePanel();
  // accept a node index OR its label (directors naturally write the label)
  const hi = typeof highlight === 'string' ? nodes.findIndex((n) => n.label.toLowerCase() === highlight.toLowerCase()) : highlight;
  // inside the reel every Flow uses the wide row/2×2 layout (split panel and full screen alike); the tall stack is standalone-only
  const beat = useBeats(nodes.length);
  if (panel || React.useContext(PanelContext)) return <FlowRow title={title} nodes={nodes} hi={hi} tag={tag} />;
  return (
    <Stage tag={tag}>
      <Heading text={title} />
      {nodes.map((n, i) => {
        const p = useSpring(beat(i));
        const hot = hi === i;
        const grow = interpolate(f - (beat(i) + 6), [0, 10], [0, 1], {...clamp, easing: Easing.out(Easing.quad)});
        const packet = ((f - beat(i) - 16) % 36) / 36;
        return (
          <React.Fragment key={i}>
            <div style={{display: 'flex', alignItems: 'center', gap: 28, background: hot ? theme.cardHi : theme.card, border: `3px solid ${hot ? theme.accent : theme.line}`, borderRadius: 30, padding: '26px 34px', boxShadow: hot ? SHADOW : 'none', ...pop(p)}}>
              <Icon name={n.icon} size={78} color={hot ? theme.accent : theme.mute} />
              <div><div style={{fontSize: 54, fontWeight: 800}}>{n.label}</div>{n.note ? <div style={{fontSize: 34, color: theme.dim, marginTop: 4}}>{n.note}</div> : null}</div>
            </div>
            {i < nodes.length - 1 ? (
              <div style={{position: 'relative', height: 64, width: 6, margin: '0 auto'}}>
                <div style={{position: 'absolute', inset: 0, background: theme.mute, transform: `scaleY(${grow})`, transformOrigin: 'top', borderRadius: 3}} />
                {grow >= 1 && packet >= 0 ? <div style={{position: 'absolute', left: -7, top: packet * 56, width: 20, height: 20, borderRadius: 10, background: theme.accent}} /> : null}
              </div>
            ) : null}
          </React.Fragment>
        );
      })}
    </Stage>
  );
};

/** Flow laid out left→right for the wide split panel: nodes pop in one by one, links draw, packets travel. */
const FlowRow: React.FC<{title?: string; nodes: {label: string; note?: string; icon?: IconName}[]; hi?: number; tag?: string}> = ({title, nodes, hi, tag}) => {
  // ≤3 nodes: one row. 4 nodes: two rows of two (A → B, then C → D) so every label stays big enough for a phone.
  const rows = nodes.length > 3 ? [nodes.slice(0, 2), nodes.slice(2)] : [nodes];
  const beat = useBeats(nodes.length);
  return (
    <Stage tag={tag}>
      <Heading text={title} />
      {rows.map((row, r) => (
        <React.Fragment key={r}>
          {r > 0 ? <Link vertical delay={beat(2) - 4} /> : null}
          <div style={{display: 'flex', alignItems: 'stretch'}}>
            {row.map((nd, j) => {
              const i = r * 2 + j;
              return (
                <React.Fragment key={i}>
                  <FlowNode nd={nd} hot={hi === i} delay={beat(i)} />
                  {j < row.length - 1 ? <Link delay={beat(i) + 4} /> : null}
                </React.Fragment>
              );
            })}
          </div>
        </React.Fragment>
      ))}
    </Stage>
  );
};
const FlowNode: React.FC<{nd: {label: string; note?: string; icon?: IconName}; hot: boolean; delay: number}> = ({nd, hot, delay}) => {
  const p = useSpring(delay);
  return (
    <div style={{flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18, textAlign: 'left', background: hot ? theme.cardHi : theme.card, border: `3px solid ${hot ? theme.accent : theme.line}`, borderRadius: 26, padding: '26px 20px', boxShadow: hot ? SHADOW : 'none', ...pop(p)}}>
      <Icon name={nd.icon} size={72} color={hot ? theme.accent : theme.mute} />
      <div style={{minWidth: 0}}>
        <div style={{fontSize: 44, fontWeight: 800, lineHeight: 1.06}}>{nd.label}</div>
        {nd.note ? <div style={{fontSize: 30, color: theme.dim, lineHeight: 1.15, marginTop: 4}}>{nd.note}</div> : null}
      </div>
    </div>
  );
};
/** Animated connector: draws in, then a packet travels along it. */
const Link: React.FC<{delay: number; vertical?: boolean}> = ({delay, vertical}) => {
  const f = useCurrentFrame();
  const L = vertical ? 44 : 44;
  const grow = interpolate(f - delay, [0, 8], [0, 1], {...clamp, easing: Easing.out(Easing.quad)});
  const packet = ((f - delay - 8) % 28) / 28;
  const box: React.CSSProperties = vertical ? {position: 'relative', height: L, width: 6, margin: '0 auto'} : {position: 'relative', width: L, height: 6, alignSelf: 'center', flexShrink: 0};
  return (
    <div style={box}>
      <div style={{position: 'absolute', inset: 0, background: theme.mute, borderRadius: 3, transform: vertical ? `scaleY(${grow})` : `scaleX(${grow})`, transformOrigin: vertical ? 'top' : 'left'}} />
      {grow >= 1 && packet >= 0 ? <div style={{position: 'absolute', width: 20, height: 20, borderRadius: 10, background: theme.accent, ...(vertical ? {left: -7, top: packet * (L - 20)} : {top: -7, left: packet * (L - 20)})}} /> : null}
    </div>
  );
};

/** One source fanning out to up to 4 targets (load balancer → servers, topic → consumers). */
export const Fanout: React.FC<{title?: string; from: {label: string; icon?: IconName}; to: {label: string; icon?: IconName}[]; tag?: string}> = ({title, from, to, tag}) => {
  const f = useCurrentFrame();
  const n = to.length;
  const panel = usePanel();
  const W = panel ? 952 : 928, colW = W / n;
  const LH = panel ? 120 : 190; // link height
  const beat = useBeats(n + 1); // the source lands first, then each target on its own beat
  return (
    <Stage tag={tag}>
      <Heading text={title} />
      <div style={{display: 'flex', justifyContent: 'center', ...pop(useSpring(0))}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 24, background: theme.cardHi, border: `3px solid ${theme.accent}`, borderRadius: 30, padding: '24px 40px', boxShadow: SHADOW}}>
          <Icon name={from.icon} size={panel ? 88 : 80} /><div style={{fontSize: panel ? 62 : 56, fontWeight: 800}}>{from.label}</div>
        </div>
      </div>
      <svg width={W} height={LH} style={{display: 'block', margin: '0 auto'}}>
        {to.map((_, i) => {
          const x2 = colW * i + colW / 2;
          const d = interpolate(f - (beat(i + 1) - 6), [0, 12], [0, 1], {...clamp, easing: Easing.out(Easing.cubic)});
          const path = `M ${W / 2} 0 C ${W / 2} ${LH * 0.53}, ${x2} ${LH * 0.42}, ${x2} ${LH}`;
          const dot = ((f - beat(i + 1) - 8) % 30) / 30;
          return (
            <g key={i}>
              <path d={path} stroke={theme.mute} strokeWidth={5} fill="none" strokeDasharray={400} strokeDashoffset={400 * (1 - d)} strokeLinecap="round" />
              {d >= 1 && dot >= 0 ? <circle r={9} fill={theme.accent} cx={(1 - dot) * (1 - dot) * (1 - dot) * (W / 2) + 3 * (1 - dot) * (1 - dot) * dot * (W / 2) + 3 * (1 - dot) * dot * dot * x2 + dot * dot * dot * x2} cy={3 * (1 - dot) * (1 - dot) * dot * LH * 0.53 + 3 * (1 - dot) * dot * dot * LH * 0.42 + dot * dot * dot * LH} /> : null}
            </g>
          );
        })}
      </svg>
      <div style={{display: 'flex'}}>
        {to.map((t, i) => (
          <div key={i} style={{width: colW, padding: '0 8px', ...pop(useSpring(beat(i + 1)))}}>
            <div style={{background: theme.card, border: `3px solid ${theme.line}`, borderRadius: 24, padding: '22px 6px', textAlign: 'center'}}>
              <div style={{display: 'flex', justifyContent: 'center'}}><Icon name={t.icon} size={panel ? 80 : 64} color={theme.mute} /></div>
              <div style={{fontSize: panel ? (n > 3 ? 34 : 44) : n > 3 ? 28 : 34, fontWeight: 800, marginTop: 12, lineHeight: 1.08}}>{t.label}</div>
            </div>
          </div>
        ))}
      </div>
    </Stage>
  );
};

/** Numbered steps (request lifecycle, algorithm). Max 5. */
export const Steps: React.FC<{title?: string; steps: {label: string; note?: string}[]; tag?: string}> = ({title, steps, tag}) => {
  const f = useCurrentFrame();
  const beat = useBeats(steps.length);
  const prog = interpolate(f, [beat(0), beat(steps.length - 1) + 8], [0, 1], {...clamp, easing: Easing.inOut(Easing.quad)});
  return (
    <Stage tag={tag} align="start">
      <Heading text={title} />
      <div style={{position: 'relative'}}>
        <div style={{position: 'absolute', left: 39, top: 40, bottom: 40, width: 5, background: theme.line, borderRadius: 3}} />
        <div style={{position: 'absolute', left: 39, top: 40, height: `calc((100% - 80px) * ${prog})`, width: 5, background: theme.accent, borderRadius: 3}} />
        {steps.map((s, i) => (
          <div key={i} style={{display: 'flex', gap: 34, alignItems: 'center', marginBottom: 40, ...pop(useSpring(beat(i)))}}>
            <div style={{width: 84, height: 84, borderRadius: 42, background: theme.accent, color: '#fff', fontSize: 46, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: 'none'}}>{i + 1}</div>
            <div><div style={{fontSize: 52, fontWeight: 800, lineHeight: 1.1}}>{s.label}</div>{s.note ? <div style={{fontSize: 34, color: theme.dim, marginTop: 4}}>{s.note}</div> : null}</div>
          </div>
        ))}
      </div>
    </Stage>
  );
};

/** Animated horizontal bars (latency, throughput, cost). */
export const Chart: React.FC<{title?: string; bars: {label: string; value: number; unit?: string}[]; tag?: string}> = ({title, bars, tag}) => {
  const f = useCurrentFrame();
  const max = Math.max(...bars.map((b) => b.value));
  const top = bars.findIndex((b) => b.value === max);
  const beat = useBeats(bars.length);
  return (
    <Stage tag={tag}>
      <Heading text={title} />
      {bars.map((b, i) => {
        const w = interpolate(spring({frame: f - beat(i), fps: 30, config: {damping: 18, stiffness: 90}}), [0, 1], [0, b.value / max]);
        return (
          <div key={i} style={{marginBottom: 38, ...pop(useSpring(beat(i) - 2))}}>
            <div style={{display: 'flex', justifyContent: 'space-between', fontSize: 40, fontWeight: 700, marginBottom: 10}}>
              <span>{b.label}</span><span style={{color: i === top ? theme.accent : theme.dim}}>{Math.round(b.value * Math.min(1, w / (b.value / max || 1)))}{b.unit ?? ''}</span>
            </div>
            <div style={{height: 46, background: theme.card, borderRadius: 23, overflow: 'hidden', border: `2px solid ${theme.line}`}}>
              <div style={{height: '100%', width: `${w * 100}%`, borderRadius: 23, background: i === top ? theme.accent : theme.mute}} />
            </div>
          </div>
        );
      })}
    </Stage>
  );
};

const TOKEN = /(\/\/.*|#.*|"[^"]*"|'[^']*'|\b\d+(?:\.\d+)?\b|\b(?:class|def|function|const|let|var|return|interface|public|private|protected|async|await|if|else|for|while|new|import|from|type|struct|enum|int|string|void|null|None|true|false|self|this|extends|implements)\b)/g;
const colorOf = (t: string) => (/^(\/\/|#)/.test(t) ? '#8a8173' : /^["']/.test(t) ? '#e9b872' : /^\d/.test(t) ? '#f08a5d' : '#8fb3e8');
/** Syntax-highlighted code that types in; `lines` (1-based) get an accent bar. */
export const Code: React.FC<{code: string; title?: string; highlightLines?: number[]; tag?: string}> = ({code, title, highlightLines = [], tag}) => {
  const f = useCurrentFrame();
  let budget = Math.floor(Math.max(0, f - 6) * 2.6);
  const lines = code.split('\n');
  return (
    <Stage tag={tag}>
      <Heading text={title} />
      <div style={{background: '#1d1a16', border: `3px solid ${theme.line}`, borderRadius: 30, overflow: 'hidden', ...pop(useSpring(0))}}>
        <div style={{display: 'flex', gap: 12, padding: '20px 28px', background: theme.card}}>{['#ff5f57', '#febc2e', '#28c840'].map((c) => <div key={c} style={{width: 18, height: 18, borderRadius: 9, background: c}} />)}</div>
        <div style={{padding: '28px 0', fontFamily: mono, fontSize: 36, lineHeight: 1.5}}>
          {lines.map((ln, li) => {
            const shown = ln.slice(0, Math.max(0, budget)); budget -= ln.length + 1;
            const parts = shown.split(TOKEN).filter(Boolean);
            const hi = highlightLines.includes(li + 1) && budget > 0;
            return (
              <div key={li} style={{padding: '0 36px', background: hi ? `${theme.accent}18` : 'transparent', borderLeft: `6px solid ${hi ? theme.accent : 'transparent'}`, whiteSpace: 'pre', minHeight: 54}}>
                {parts.map((p, pi) => <span key={pi} style={{color: TOKEN.test(p) || /^(\/\/|#|"|')/.test(p) ? colorOf(p) : '#efe9dd'}}>{p}</span>)}
              </div>
            );
          })}
        </div>
      </div>
    </Stage>
  );
};

/** One huge number counting up inside a ring that fills with it (a percentage fills to its value, anything else to full). */
export const Stat: React.FC<{value: string; label: string; sub?: string; tag?: string}> = ({value, label, sub, tag}) => {
  const f = useCurrentFrame();
  const panel = usePanel();
  const m = value.match(/^([^\d-]*)(-?[\d,.]+)(.*)$/);
  const D = useCardDur();
  const k = interpolate(f, [4, Math.max(34, Math.round(D * 0.55))], [0, 1], {...clamp, easing: Easing.out(Easing.cubic)});
  let shown = value;
  if (m) {
    const target = parseFloat(m[2].replace(/,/g, '')), dec = (m[2].split('.')[1] || '').length, v = target * k;
    shown = m[1] + (m[2].includes(',') ? Math.round(v).toLocaleString('en-US') : v.toFixed(dec)) + m[3];
  }
  const pct = m && /%/.test(m[3]) ? Math.min(1, parseFloat(m[2]) / 100) : 1;
  const R = 118, C = 2 * Math.PI * R, S = panel ? 300 : 340;
  return (
    <Stage tag={tag}>
      <div style={{display: 'flex', alignItems: 'center', gap: 40}}>
        <div style={{position: 'relative', width: S, height: S, flex: 'none', ...pop(useSpring(0))}}>
          <svg width={S} height={S} viewBox="0 0 280 280" style={{position: 'absolute', inset: 0, transform: 'rotate(-90deg)'}}>
            <circle cx="140" cy="140" r={R} fill="none" stroke={theme.line} strokeWidth="18" />
            <circle cx="140" cy="140" r={R} fill="none" stroke={theme.accent} strokeWidth="18" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pct * k)} />
          </svg>
          <div style={{position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: shown.length > 6 ? 70 : 92, fontWeight: 900, letterSpacing: -3, color: theme.text}}>{shown}</div>
        </div>
        <div style={{minWidth: 0}}>
          <div style={{fontSize: 64, fontWeight: 800, lineHeight: 1.06, ...pop(useSpring(10))}}>{label}</div>
          {sub ? <div style={{fontSize: 42, color: theme.dim, marginTop: 16, ...pop(useSpring(18))}}>{sub}</div> : null}
        </div>
      </div>
    </Stage>
  );
};

/** Checklist: each item slides in and its check DRAWS itself; the line under the items grows as they land. */
export const Bullets: React.FC<{title?: string; items: string[]; tag?: string}> = ({title, items, tag}) => {
  const f = useCurrentFrame();
  const panel = usePanel();
  const beat = useBeats(items.length);
  return (
    <Stage tag={tag}>
      <Heading text={title} />
      {items.map((it, i) => {
        const d = beat(i);
        const p = useSpring(d);
        const c = interpolate(f - d - 4, [0, 10], [0, 1], {...clamp, easing: Easing.out(Easing.cubic)});
        return (
          <div key={i} style={{display: 'flex', gap: 26, alignItems: 'center', fontSize: panel ? 62 : 54, fontWeight: 800, lineHeight: 1.1, padding: '18px 0', borderBottom: `3px solid ${theme.line}`, ...pop(p, 30)}}>
            <svg width="66" height="66" viewBox="0 0 48 48" style={{flex: 'none'}}>
              <circle cx="24" cy="24" r="21" fill={c > 0.98 ? theme.accent : 'none'} stroke={theme.accent} strokeWidth="3.5" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - c} />
              <path d="M14 25l7 7 13-15" fill="none" stroke={c > 0.98 ? '#fff' : theme.accent} strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - interpolate(c, [0.4, 1], [0, 1], clamp)} />
            </svg>
            <div>{it}</div>
          </div>
        );
      })}
    </Stage>
  );
};

/** Two sides slide in from opposite edges, a VS badge pops between them, points tick in one by one. */
export const Compare: React.FC<{left: {title: string; points: string[]}; right: {title: string; points: string[]}; tag?: string}> = ({left, right, tag}) => {
  const f = useCurrentFrame();
  const vs = useSpring(12, 220, 12);
  const total = left.points.length + right.points.length;
  const beat = useBeats(total + 1);
  const side = (s: {title: string; points: string[]}, si: number) => {
    const c = si ? theme.warm : theme.accent;
    const x = interpolate(useSpring(si * 6, 120, 18), [0, 1], [si ? 140 : -140, 0]);
    return (
      <div key={si} style={{flex: 1, minWidth: 0, background: theme.card, border: `3px solid ${c}`, borderRadius: 26, padding: '28px 28px', boxShadow: SHADOW, transform: `translateX(${x}px)`, opacity: 1 - Math.min(1, Math.abs(x) / 140)}}>
        <div style={{fontSize: 52, fontWeight: 800, color: c, marginBottom: 14, lineHeight: 1.05}}>{s.title}</div>
        {s.points.map((pt, i) => {
          const d = beat(1 + (si ? left.points.length : 0) + i);
          const t = interpolate(f - d, [0, 8], [0, 1], {...clamp, easing: Easing.out(Easing.cubic)});
          return <div key={i} style={{display: 'flex', gap: 12, alignItems: 'baseline', fontSize: 38, fontWeight: 600, marginTop: 12, opacity: t, transform: `translateY(${(1 - t) * 14}px)`}}><span style={{color: c, fontWeight: 800}}>✓</span><span>{pt}</span></div>;
        })}
      </div>
    );
  };
  return (
    <Stage tag={tag}>
      <div style={{display: 'flex', gap: 22, alignItems: 'stretch', position: 'relative'}}>
        {side(left, 0)}{side(right, 1)}
        <div style={{position: 'absolute', left: '50%', top: '50%', width: 92, height: 92, borderRadius: 46, background: theme.text, color: theme.bg, display: 'grid', placeItems: 'center', fontSize: 34, fontWeight: 900, transform: `translate(-50%, -50%) scale(${vs})`}}>VS</div>
      </div>
    </Stage>
  );
};

// ───────── real tool / GitHub visuals (data fetched by the pipeline, passed in as inputProps.assets) ─────────
type RepoAsset = {repo: string; owner: string; name: string; description: string; stars: number; forks: number; language: string; license: string; archived: boolean; avatar: string | null};
type SiteAsset = {url: string; domain: string; name: string; title: string; description: string; screenshot: string; icon: string | null};
const getAssets = () => ((getInputProps() as {assets?: {repos?: Record<string, RepoAsset>; sites?: Record<string, SiteAsset>}}).assets ?? {});
const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`);
const clampLines = (n: number): React.CSSProperties => ({display: '-webkit-box', WebkitLineClamp: n, WebkitBoxOrient: 'vertical', overflow: 'hidden'});

const Star: React.FC<{size?: number}> = ({size = 64}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={theme.warm}><path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.3 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z" /></svg>
);
const Fork: React.FC<{size?: number}> = ({size = 52}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={theme.mute} strokeWidth={2} strokeLinecap="round"><circle cx="6" cy="5" r="2.5" /><circle cx="18" cy="5" r="2.5" /><circle cx="12" cy="19" r="2.5" /><path d="M6 7.5v1.5a3 3 0 003 3h6a3 3 0 003-3V7.5M12 12v4.5" /></svg>
);

/** A real GitHub repository: avatar, description, ★ count-up, forks, language, license. Data is fetched live and verified. */
export const Repo: React.FC<{repo: string; tag?: string}> = ({repo, tag = 'GITHUB'}) => {
  const f = useCurrentFrame();
  const d = getAssets().repos?.[repo];
  const [owner, name] = repo.split('/');
  const stars = d ? interpolate(f, [10, 45], [0, d.stars], {...clamp, easing: Easing.out(Easing.cubic)}) : 0;
  const panel = usePanel();
  const showStats = !!d && d.stars >= 50; // "★ 0" weakens the proof — show language/licence chips instead
  const pulse = d ? 1 + 0.18 * Math.max(0, Math.sin(Math.min(1, Math.max(0, (f - 45) / 14)) * Math.PI)) : 1;
  return (
    <Stage tag={tag}>
      <div style={{background: theme.card, border: `3px solid ${theme.accent}`, borderRadius: 34, padding: '44px 44px 40px', boxShadow: SHADOW, ...pop(useSpring(0))}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 30}}>
          {d?.avatar ? <Img src={d.avatar} style={{width: 124, height: 124, borderRadius: 62, border: `3px solid ${theme.line}`}} /> : <div style={{width: 124, height: 124, borderRadius: 62, background: theme.cardHi, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 60, fontWeight: 800, color: theme.accent}}>{owner[0]?.toUpperCase()}</div>}
          <div style={{minWidth: 0}}>
            <div style={{fontSize: 40, color: theme.dim, fontWeight: 500}}>{d?.owner ?? owner} /</div>
            <div style={{fontSize: 74, fontWeight: 800, lineHeight: 1.05, wordBreak: 'break-word'}}>{d?.name ?? name}</div>
          </div>
        </div>
        {d?.description ? <div style={{fontSize: panel ? 46 : 42, color: "#dfe5ff", lineHeight: 1.25, marginTop: 30, ...clampLines(panel ? 3 : 3), ...pop(useSpring(8), 20)}}>{d.description}</div> : null}
        <div style={{height: 3, background: theme.line, margin: panel ? '28px 0' : '36px 0'}} />
        <div style={{display: showStats ? 'flex' : 'none', alignItems: 'center', gap: 56, flexWrap: 'wrap'}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 16}}>
            <div style={{transform: `scale(${pulse})`}}><Star /></div>
            <div style={{fontSize: 84, fontWeight: 800, color: theme.accent, letterSpacing: -2}}>{d ? compact(stars) : '—'}</div>
          </div>
          {d ? <div style={{display: 'flex', alignItems: 'center', gap: 12, fontSize: 46, fontWeight: 700, ...pop(useSpring(16), 16)}}><Fork />{compact(d.forks)}</div> : null}
        </div>
        {d && (d.language || d.license) ? (
          <div style={{display: 'flex', gap: 22, marginTop: showStats ? 30 : 0, fontSize: showStats ? 36 : 42, color: theme.dim, flexWrap: 'wrap', alignItems: 'center', ...pop(useSpring(22), 14)}}>
            {!showStats ? <span style={{color: theme.accent, fontWeight: 800}}>Open source on GitHub</span> : null}
            {d.language ? <span style={{display: 'flex', alignItems: 'center', gap: 12}}><span style={{width: 20, height: 20, borderRadius: 10, background: theme.accent}} />{d.language}</span> : null}
            {d.license ? <span style={{border: `2px solid ${theme.line}`, borderRadius: 16, padding: '2px 18px'}}>{d.license}</span> : null}
            {d.archived ? <span style={{color: theme.warm}}>archived</span> : null}
          </div>
        ) : null}
      </div>
    </Stage>
  );
};

/** A real tool/site: browser frame with a live screenshot that slowly pans in, plus its icon, name and description. */
export const Site: React.FC<{url: string; name?: string; tag?: string}> = ({url, name, tag = 'TOOL'}) => {
  const f = useCurrentFrame();
  const durationInFrames = useCardDur();
  const key = (() => { try { return new URL(url).href; } catch { return url; } })(); // assets are keyed by the canonical href
  const d = getAssets().sites?.[key];
  const panel = usePanel();
  // in the split panel a whole page is unreadable on a phone: start pushed in on the top-left (repo name / hero) and keep going
  const zoom = interpolate(f, [0, durationInFrames], panel ? [1.35, 1.6] : [1, 1.1], clamp);
  const panY = interpolate(f, [0, durationInFrames], [0, -24], clamp);
  const host = d?.domain ?? (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } })();
  const label = name ?? d?.name ?? host;
  return (
    <Stage tag={tag} typeZoom={false}>
      <div style={{border: `3px solid ${theme.line}`, borderRadius: 28, overflow: 'hidden', background: theme.card, boxShadow: SHADOW_BIG, ...pop(useSpring(0))}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 14, padding: '18px 24px', background: theme.cardHi}}>
          {['#ff5f57', '#febc2e', '#28c840'].map((c) => <div key={c} style={{width: 18, height: 18, borderRadius: 9, background: c}} />)}
          <div style={{flex: 1, marginLeft: 12, background: theme.bg, borderRadius: 20, padding: '8px 22px', fontSize: 30, color: theme.dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>🔒 {host}</div>
        </div>
        <div style={{position: 'relative', width: '100%', aspectRatio: panel ? '2 / 1' : '1280 / 800', overflow: 'hidden', background: theme.bg}}>
          {d?.screenshot ? <Img src={d.screenshot} style={{width: '100%', display: 'block', transform: `scale(${zoom}) translateY(${panY}px)`, transformOrigin: panel ? '4% 16%' : '50% 0%'}} /> : <div style={{height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 64, fontWeight: 800, color: theme.dim}}>{host}</div>}
          {d?.screenshot ? <Cursor x={0.2} y={0.42} delay={12} /> : null}
        </div>
      </div>
      <div style={{display: 'flex', alignItems: 'center', gap: 26, marginTop: 38, ...pop(useSpring(10), 20)}}>
        {d?.icon ? <Img src={d.icon} style={{width: 84, height: 84, borderRadius: 18, background: '#fff', padding: 6, objectFit: 'contain'}} /> : <div style={{width: 84, height: 84, borderRadius: 18, background: theme.cardHi, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 46, fontWeight: 800, color: theme.accent}}>{label[0]?.toUpperCase()}</div>}
        <div style={{minWidth: 0}}>
          <div style={{fontSize: 62, fontWeight: 800, lineHeight: 1.05}}>{label}</div>
          {d?.description ? <div style={{fontSize: 34, color: theme.dim, marginTop: 8, lineHeight: 1.25, ...clampLines(2)}}>{d.description}</div> : null}
        </div>
      </div>
    </Stage>
  );
};

/** A REAL screenshot of the Edits app (captured + token-redacted by the pipeline) in a window frame, slowly pushing in on `focus`. */
export const Screen: React.FC<{shot: string; title?: string; caption?: string; tag?: string; focus?: {x: number; y: number}}> = ({shot, title, caption, tag = 'LIVE', focus}) => {
  const f = useCurrentFrame();
  const durationInFrames = useCardDur();
  const screens = (getInputProps() as {screens?: Record<string, {file: string; w: number; h: number; focus?: {x: number; y: number}}>}).screens ?? {};
  const s = screens[shot];
  const fx = focus ?? s?.focus ?? {x: 0.5, y: 0.4};
  const k = interpolate(f, [0, durationInFrames], [1.18, 1.5], {...clamp, easing: Easing.inOut(Easing.cubic)}); // UI text must be readable on a phone
  const full = (React.useContext(PanelContext)?.height ?? 0) >= 1200;
  // split panel: a wide view around `focus`; FULL screen: a tall crop so the real screen fills the frame and stays readable
  const ratio = full ? 1.2 : Math.max(1.55, s ? s.w / s.h : 1.6); // 952 wide × ~790 tall fills the full-screen content area
  return (
    <Stage tag={tag} typeZoom={false}>
      {title ? <div style={{fontSize: 60, fontWeight: 800, lineHeight: 1.06, marginBottom: 24, ...pop(useSpring(0))}}>{title}</div> : null}
      <div style={{position: 'relative', borderRadius: 26, overflow: 'hidden', border: `3px solid ${theme.line}`, boxShadow: SHADOW_BIG, ...pop(useSpring(4))}}>
        <div style={{width: '100%', aspectRatio: `${ratio}`, overflow: 'hidden', background: '#1c1d20'}}>
          {s ? <Img src={staticFile(s.file)} style={{width: '100%', height: '100%', objectFit: 'cover', objectPosition: `${fx.x * 100}% ${fx.y * 100}%`, transform: `scale(${k})`, transformOrigin: `${fx.x * 100}% ${fx.y * 100}%`}} /> : null}
        </div>
        {s ? <Cursor x={fx.x} y={fx.y} delay={10} /> : null}
      </div>
      {caption ? <div style={{fontSize: 44, color: theme.dim, marginTop: 24, lineHeight: 1.25, ...pop(useSpring(12), 18)}}>{caption}</div> : null}
    </Stage>
  );
};
