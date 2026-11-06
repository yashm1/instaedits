import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig, Easing} from 'remotion';
import {loadFont} from '@remotion/google-fonts/Inter';
import {loadFont as loadMono} from '@remotion/google-fonts/JetBrainsMono';

const {fontFamily} = loadFont('normal', {weights: ['500', '800'], subsets: ['latin']});
const mono = loadMono('normal', {weights: ['500'], subsets: ['latin']}).fontFamily;

export const theme = {
  bg: '#0b1020', card: '#151c33', line: '#2a3558', text: '#f4f6ff', dim: '#9aa6cf',
  accent: '#4de3c1', accent2: '#7c8cff', warn: '#ffb454',
};

// ---------- primitives ----------
const useIn = (delay = 0, stiffness = 140) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  return spring({frame: f - delay, fps, config: {damping: 16, stiffness}});
};

const Stage: React.FC<{children: React.ReactNode; tag?: string}> = ({children, tag}) => {
  const f = useCurrentFrame();
  const drift = interpolate(f, [0, 300], [0, -60], {extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{background: theme.bg, fontFamily, color: theme.text}}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(900px 900px at 80% ${20 + drift / 10}%, ${theme.accent2}33, transparent 60%), radial-gradient(800px 800px at 10% 90%, ${theme.accent}22, transparent 60%)`,
        }}
      />
      {tag ? (
        <div style={{position: 'absolute', top: 120, left: 80, fontSize: 34, letterSpacing: 6, color: theme.accent, textTransform: 'uppercase', fontWeight: 800}}>{tag}</div>
      ) : null}
      <AbsoluteFill style={{padding: '220px 80px 380px', justifyContent: 'center'}}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
};

const pop = (p: number) => ({opacity: p, transform: `translateY(${(1 - p) * 40}px) scale(${0.94 + 0.06 * p})`});

// ---------- scene components (props are plain JSON) ----------
/** Big hook / section title. */
export const Title: React.FC<{text: string; sub?: string; tag?: string}> = ({text, sub, tag}) => {
  const a = useIn(0), b = useIn(8);
  return (
    <Stage tag={tag}>
      <div style={{fontSize: 118, fontWeight: 800, lineHeight: 1.05, ...pop(a)}}>{text}</div>
      {sub ? <div style={{fontSize: 52, color: theme.dim, marginTop: 36, ...pop(b)}}>{sub}</div> : null}
    </Stage>
  );
};

/** Architecture diagram: nodes laid out vertically with animated arrows. Great for HLD. */
export const Flow: React.FC<{title?: string; nodes: {label: string; note?: string}[]; tag?: string; highlight?: number}> = ({title, nodes, tag, highlight}) => {
  const f = useCurrentFrame();
  return (
    <Stage tag={tag}>
      {title ? <div style={{fontSize: 64, fontWeight: 800, marginBottom: 50, ...pop(useIn(0))}}>{title}</div> : null}
      {nodes.map((n, i) => {
        const p = useIn(6 + i * 10);
        const hot = highlight === i;
        const line = interpolate(f - (10 + i * 10), [0, 10], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.quad)});
        return (
          <React.Fragment key={i}>
            <div style={{background: theme.card, border: `3px solid ${hot ? theme.accent : theme.line}`, borderRadius: 28, padding: '28px 36px', ...pop(p)}}>
              <div style={{fontSize: 54, fontWeight: 800}}>{n.label}</div>
              {n.note ? <div style={{fontSize: 36, color: theme.dim, marginTop: 8}}>{n.note}</div> : null}
            </div>
            {i < nodes.length - 1 ? (
              <div style={{height: 56, width: 6, margin: '0 auto', background: `linear-gradient(${theme.accent}, ${theme.accent2})`, transform: `scaleY(${line})`, transformOrigin: 'top', borderRadius: 3}} />
            ) : null}
          </React.Fragment>
        );
      })}
    </Stage>
  );
};

/** Code snippet that types in. Great for LLD (classes/interfaces). */
export const Code: React.FC<{code: string; title?: string; tag?: string}> = ({code, title, tag}) => {
  const f = useCurrentFrame();
  const shown = Math.min(code.length, Math.floor(f * 2.2));
  return (
    <Stage tag={tag}>
      {title ? <div style={{fontSize: 60, fontWeight: 800, marginBottom: 36}}>{title}</div> : null}
      <div style={{background: '#0a0f1f', border: `3px solid ${theme.line}`, borderRadius: 28, padding: 40, fontFamily: mono, fontSize: 38, lineHeight: 1.45, whiteSpace: 'pre-wrap', color: '#d6e0ff', ...pop(useIn(0))}}>
        {code.slice(0, shown)}
        <span style={{opacity: f % 16 < 8 ? 1 : 0, color: theme.accent}}>▌</span>
      </div>
    </Stage>
  );
};

/** One huge number / stat with a label. */
export const Stat: React.FC<{value: string; label: string; sub?: string; tag?: string}> = ({value, label, sub, tag}) => {
  const a = useIn(0), b = useIn(10);
  return (
    <Stage tag={tag}>
      <div style={{fontSize: 210, fontWeight: 800, color: theme.accent, lineHeight: 1, ...pop(a)}}>{value}</div>
      <div style={{fontSize: 70, fontWeight: 800, marginTop: 24, ...pop(b)}}>{label}</div>
      {sub ? <div style={{fontSize: 44, color: theme.dim, marginTop: 20, ...pop(useIn(18))}}>{sub}</div> : null}
    </Stage>
  );
};

/** Bullet list that reveals one by one. */
export const Bullets: React.FC<{title?: string; items: string[]; tag?: string}> = ({title, items, tag}) => (
  <Stage tag={tag}>
    {title ? <div style={{fontSize: 70, fontWeight: 800, marginBottom: 50, ...pop(useIn(0))}}>{title}</div> : null}
    {items.map((it, i) => (
      <div key={i} style={{display: 'flex', gap: 28, alignItems: 'flex-start', fontSize: 52, marginBottom: 36, ...pop(useIn(8 + i * 12))}}>
        <div style={{width: 20, height: 20, borderRadius: 10, background: theme.accent, marginTop: 24, flexShrink: 0}} />
        <div>{it}</div>
      </div>
    ))}
  </Stage>
);

/** Two-column compare (SQL vs NoSQL, monolith vs microservices ...). */
export const Compare: React.FC<{left: {title: string; points: string[]}; right: {title: string; points: string[]}; tag?: string}> = ({left, right, tag}) => (
  <Stage tag={tag}>
    {[left, right].map((side, si) => (
      <div key={si} style={{background: theme.card, border: `3px solid ${si ? theme.accent2 : theme.accent}`, borderRadius: 28, padding: 36, marginBottom: 36, ...pop(useIn(si * 14))}}>
        <div style={{fontSize: 62, fontWeight: 800, color: si ? theme.accent2 : theme.accent, marginBottom: 16}}>{side.title}</div>
        {side.points.map((p, i) => (
          <div key={i} style={{fontSize: 42, color: theme.text, marginTop: 10, ...pop(useIn(10 + si * 14 + i * 8))}}>• {p}</div>
        ))}
      </div>
    ))}
  </Stage>
);
