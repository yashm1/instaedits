import React from 'react';
import {AbsoluteFill, Easing, getInputProps, Img, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {loadFont} from '@remotion/google-fonts/Inter';
import {loadFont as loadMono} from '@remotion/google-fonts/JetBrainsMono';
import {theme, safe} from './theme';

const {fontFamily} = loadFont('normal', {weights: ['500', '700', '800'], subsets: ['latin']});
const mono = loadMono('normal', {weights: ['500'], subsets: ['latin']}).fontFamily;

export {theme, safe};

// ───────── motion helpers ─────────
const useSpring = (delay = 0, stiffness = 150, damping = 17) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  return spring({frame: f - delay, fps, config: {damping, stiffness, mass: 0.8}});
};
const pop = (p: number, rise = 36) => ({opacity: Math.min(1, p * 1.4), transform: `translateY(${(1 - p) * rise}px) scale(${0.95 + 0.05 * p})`});
const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

// ───────── stage: background, safe zones (IG UI top, captions bottom) ─────────
const Stage: React.FC<{children: React.ReactNode; tag?: string; align?: 'center' | 'start'}> = ({children, tag, align = 'center'}) => {
  const f = useCurrentFrame();
  const t = f / 30;
  return (
    <AbsoluteFill style={{background: theme.bg, fontFamily, color: theme.text}}>
      <AbsoluteFill style={{background: `radial-gradient(1100px 1100px at ${70 + Math.sin(t * 0.6) * 8}% ${18 + Math.cos(t * 0.5) * 4}%, ${theme.glow}88, transparent 62%), radial-gradient(900px 900px at ${15 + Math.cos(t * 0.5) * 6}% 92%, ${theme.accent}26, transparent 60%)`}} />
      <AbsoluteFill style={{backgroundImage: `linear-gradient(${theme.line}33 1px, transparent 1px), linear-gradient(90deg, ${theme.line}33 1px, transparent 1px)`, backgroundSize: '90px 90px', opacity: 0.35, maskImage: 'radial-gradient(circle at 50% 45%, black 20%, transparent 75%)'}} />
      {tag ? (
        <div style={{position: 'absolute', top: safe.tagTop, left: 80, display: 'flex', alignItems: 'center', gap: 16, ...pop(useSpring(0))}}>
          <div style={{width: 14, height: 14, borderRadius: 7, background: theme.accent}} />
          <div style={{fontSize: 32, letterSpacing: 7, color: theme.accent, textTransform: 'uppercase', fontWeight: 800}}>{tag}</div>
        </div>
      ) : null}
      <AbsoluteFill style={{padding: `${safe.contentTop}px 76px ${safe.bottom}px`, justifyContent: align === 'center' ? 'center' : 'flex-start'}}>{children}</AbsoluteFill>
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

const Heading: React.FC<{text?: string}> = ({text}) =>
  text ? <div style={{fontSize: 68, fontWeight: 800, lineHeight: 1.08, marginBottom: 54, ...pop(useSpring(0))}}>{text}</div> : null;

// ───────── scenes ─────────
/** Hook / statement. `hot` words get the accent colour. */
export const Hook: React.FC<{text: string; hot?: string[]; sub?: string; tag?: string}> = ({text, hot = [], sub, tag}) => {
  const f = useCurrentFrame();
  const words = text.split(' ');
  return (
    <Stage tag={tag} align="start">
      <div style={{fontSize: 124, fontWeight: 800, lineHeight: 1.04, letterSpacing: -2}}>
        {words.map((w, i) => {
          const p = spring({frame: f - i * 4, fps: 30, config: {damping: 14, stiffness: 190}});
          const isHot = hot.some((h) => w.toLowerCase().replace(/[^a-z0-9]/g, '') === h.toLowerCase().replace(/[^a-z0-9]/g, ''));
          return <span key={i} style={{display: 'inline-block', marginRight: 26, color: isHot ? theme.accent : theme.text, ...pop(p, 50)}}>{w}</span>;
        })}
      </div>
      {sub ? <div style={{fontSize: 50, color: theme.dim, marginTop: 40, ...pop(useSpring(words.length * 4 + 4))}}>{sub}</div> : null}
    </Stage>
  );
};
export const Title: React.FC<{text: string; sub?: string; tag?: string}> = ({text, sub, tag}) => <Hook text={text} sub={sub} tag={tag} />;

/** Vertical architecture flow with animated data packets. */
export const Flow: React.FC<{title?: string; nodes: {label: string; note?: string; icon?: IconName}[]; highlight?: number | string; tag?: string}> = ({title, nodes, highlight, tag}) => {
  const f = useCurrentFrame();
  // accept a node index OR its label (directors naturally write the label)
  const hi = typeof highlight === 'string' ? nodes.findIndex((n) => n.label.toLowerCase() === highlight.toLowerCase()) : highlight;
  return (
    <Stage tag={tag}>
      <Heading text={title} />
      {nodes.map((n, i) => {
        const p = useSpring(8 + i * 11);
        const hot = hi === i;
        const grow = interpolate(f - (14 + i * 11), [0, 10], [0, 1], {...clamp, easing: Easing.out(Easing.quad)});
        const packet = ((f - 24 - i * 11) % 36) / 36;
        return (
          <React.Fragment key={i}>
            <div style={{display: 'flex', alignItems: 'center', gap: 28, background: hot ? theme.cardHi : theme.card, border: `3px solid ${hot ? theme.accent : theme.line}`, borderRadius: 30, padding: '26px 34px', boxShadow: hot ? `0 0 60px ${theme.accent}33` : 'none', ...pop(p)}}>
              <Icon name={n.icon} size={78} color={hot ? theme.accent : theme.mute} />
              <div><div style={{fontSize: 54, fontWeight: 800}}>{n.label}</div>{n.note ? <div style={{fontSize: 34, color: theme.dim, marginTop: 4}}>{n.note}</div> : null}</div>
            </div>
            {i < nodes.length - 1 ? (
              <div style={{position: 'relative', height: 64, width: 6, margin: '0 auto'}}>
                <div style={{position: 'absolute', inset: 0, background: theme.mute, transform: `scaleY(${grow})`, transformOrigin: 'top', borderRadius: 3}} />
                {grow >= 1 && packet >= 0 ? <div style={{position: 'absolute', left: -7, top: packet * 56, width: 20, height: 20, borderRadius: 10, background: '#fff', boxShadow: `0 0 20px ${theme.accent}`}} /> : null}
              </div>
            ) : null}
          </React.Fragment>
        );
      })}
    </Stage>
  );
};

/** One source fanning out to up to 4 targets (load balancer → servers, topic → consumers). */
export const Fanout: React.FC<{title?: string; from: {label: string; icon?: IconName}; to: {label: string; icon?: IconName}[]; tag?: string}> = ({title, from, to, tag}) => {
  const f = useCurrentFrame();
  const n = to.length;
  const W = 928, colW = W / n;
  return (
    <Stage tag={tag}>
      <Heading text={title} />
      <div style={{display: 'flex', justifyContent: 'center', ...pop(useSpring(0))}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 24, background: theme.cardHi, border: `3px solid ${theme.accent}`, borderRadius: 30, padding: '24px 40px', boxShadow: `0 0 60px ${theme.accent}33`}}>
          <Icon name={from.icon} size={80} /><div style={{fontSize: 56, fontWeight: 800}}>{from.label}</div>
        </div>
      </div>
      <svg width={W} height={190} style={{display: 'block', margin: '0 auto'}}>
        {to.map((_, i) => {
          const x2 = colW * i + colW / 2;
          const d = interpolate(f - (10 + i * 5), [0, 14], [0, 1], {...clamp, easing: Easing.out(Easing.cubic)});
          const path = `M ${W / 2} 0 C ${W / 2} 100, ${x2} 80, ${x2} 190`;
          const dot = ((f - 24 - i * 4) % 30) / 30;
          return (
            <g key={i}>
              <path d={path} stroke={theme.mute} strokeWidth={5} fill="none" strokeDasharray={400} strokeDashoffset={400 * (1 - d)} strokeLinecap="round" />
              {d >= 1 && dot >= 0 ? <circle r={9} fill="#fff" style={{filter: `drop-shadow(0 0 8px ${theme.accent})`}} cx={(1 - dot) * (1 - dot) * (1 - dot) * (W / 2) + 3 * (1 - dot) * (1 - dot) * dot * (W / 2) + 3 * (1 - dot) * dot * dot * x2 + dot * dot * dot * x2} cy={3 * (1 - dot) * (1 - dot) * dot * 100 + 3 * (1 - dot) * dot * dot * 80 + dot * dot * dot * 190} /> : null}
            </g>
          );
        })}
      </svg>
      <div style={{display: 'flex'}}>
        {to.map((t, i) => (
          <div key={i} style={{width: colW, padding: '0 8px', ...pop(useSpring(18 + i * 5))}}>
            <div style={{background: theme.card, border: `3px solid ${theme.line}`, borderRadius: 24, padding: '22px 6px', textAlign: 'center'}}>
              <div style={{display: 'flex', justifyContent: 'center'}}><Icon name={t.icon} size={64} color={theme.mute} /></div>
              <div style={{fontSize: n > 3 ? 28 : 34, fontWeight: 700, marginTop: 10}}>{t.label}</div>
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
  const prog = interpolate(f, [8, 8 + steps.length * 12], [0, 1], {...clamp, easing: Easing.inOut(Easing.quad)});
  return (
    <Stage tag={tag} align="start">
      <Heading text={title} />
      <div style={{position: 'relative'}}>
        <div style={{position: 'absolute', left: 39, top: 40, bottom: 40, width: 5, background: theme.line, borderRadius: 3}} />
        <div style={{position: 'absolute', left: 39, top: 40, height: `calc((100% - 80px) * ${prog})`, width: 5, background: theme.accent, borderRadius: 3}} />
        {steps.map((s, i) => (
          <div key={i} style={{display: 'flex', gap: 34, alignItems: 'center', marginBottom: 40, ...pop(useSpring(8 + i * 12))}}>
            <div style={{width: 84, height: 84, borderRadius: 42, background: theme.accent, color: '#04201a', fontSize: 46, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: `0 0 40px ${theme.accent}55`}}>{i + 1}</div>
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
  return (
    <Stage tag={tag}>
      <Heading text={title} />
      {bars.map((b, i) => {
        const w = interpolate(spring({frame: f - (8 + i * 8), fps: 30, config: {damping: 18, stiffness: 90}}), [0, 1], [0, b.value / max]);
        return (
          <div key={i} style={{marginBottom: 38, ...pop(useSpring(6 + i * 8))}}>
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
const colorOf = (t: string) => (/^(\/\/|#)/.test(t) ? '#6b7aa8' : /^["']/.test(t) ? '#ffcf70' : /^\d/.test(t) ? '#ff9e7a' : '#7c8cff');
/** Syntax-highlighted code that types in; `lines` (1-based) get an accent bar. */
export const Code: React.FC<{code: string; title?: string; highlightLines?: number[]; tag?: string}> = ({code, title, highlightLines = [], tag}) => {
  const f = useCurrentFrame();
  let budget = Math.floor(Math.max(0, f - 6) * 2.6);
  const lines = code.split('\n');
  return (
    <Stage tag={tag}>
      <Heading text={title} />
      <div style={{background: '#070b18', border: `3px solid ${theme.line}`, borderRadius: 30, overflow: 'hidden', ...pop(useSpring(0))}}>
        <div style={{display: 'flex', gap: 12, padding: '20px 28px', background: theme.card}}>{['#ff5f57', '#febc2e', '#28c840'].map((c) => <div key={c} style={{width: 18, height: 18, borderRadius: 9, background: c}} />)}</div>
        <div style={{padding: '28px 0', fontFamily: mono, fontSize: 36, lineHeight: 1.5}}>
          {lines.map((ln, li) => {
            const shown = ln.slice(0, Math.max(0, budget)); budget -= ln.length + 1;
            const parts = shown.split(TOKEN).filter(Boolean);
            const hi = highlightLines.includes(li + 1) && budget > 0;
            return (
              <div key={li} style={{padding: '0 36px', background: hi ? `${theme.accent}18` : 'transparent', borderLeft: `6px solid ${hi ? theme.accent : 'transparent'}`, whiteSpace: 'pre', minHeight: 54}}>
                {parts.map((p, pi) => <span key={pi} style={{color: TOKEN.test(p) || /^(\/\/|#|"|')/.test(p) ? colorOf(p) : '#d6e0ff'}}>{p}</span>)}
              </div>
            );
          })}
        </div>
      </div>
    </Stage>
  );
};

/** One huge number; count-up when `value` is numeric (prefix/suffix kept). */
export const Stat: React.FC<{value: string; label: string; sub?: string; tag?: string}> = ({value, label, sub, tag}) => {
  const f = useCurrentFrame();
  const m = value.match(/^([^\d-]*)(-?[\d,.]+)(.*)$/);
  let shown = value;
  if (m) {
    const target = parseFloat(m[2].replace(/,/g, ''));
    const dec = (m[2].split('.')[1] || '').length;
    const k = interpolate(f, [4, 34], [0, 1], {...clamp, easing: Easing.out(Easing.cubic)});
    const v = target * k;
    shown = m[1] + (m[2].includes(',') ? Math.round(v).toLocaleString('en-US') : v.toFixed(dec)) + m[3];
  }
  return (
    <Stage tag={tag}>
      <div style={{fontSize: shown.length > 7 ? 150 : 210, fontWeight: 800, lineHeight: 1, letterSpacing: -4, color: theme.accent, ...pop(useSpring(0))}}>{shown}</div>
      <div style={{fontSize: 70, fontWeight: 800, marginTop: 28, lineHeight: 1.1, ...pop(useSpring(10))}}>{label}</div>
      {sub ? <div style={{fontSize: 44, color: theme.dim, marginTop: 22, ...pop(useSpring(18))}}>{sub}</div> : null}
    </Stage>
  );
};

export const Bullets: React.FC<{title?: string; items: string[]; tag?: string}> = ({title, items, tag}) => (
  <Stage tag={tag}>
    <Heading text={title} />
    {items.map((it, i) => (
      <div key={i} style={{display: 'flex', gap: 28, alignItems: 'flex-start', fontSize: 54, fontWeight: 700, lineHeight: 1.15, marginBottom: 38, ...pop(useSpring(8 + i * 12))}}>
        <div style={{width: 22, height: 22, borderRadius: 7, background: theme.accent, marginTop: 20, flexShrink: 0, transform: 'rotate(45deg)'}} />
        <div>{it}</div>
      </div>
    ))}
  </Stage>
);

export const Compare: React.FC<{left: {title: string; points: string[]}; right: {title: string; points: string[]}; tag?: string}> = ({left, right, tag}) => (
  <Stage tag={tag}>
    {[left, right].map((side, si) => {
      const c = si ? theme.warm : theme.accent;
      return (
        <div key={si} style={{background: theme.card, border: `3px solid ${c}`, borderRadius: 30, padding: '30px 36px', marginBottom: 34, boxShadow: `0 0 50px ${c}22`, ...pop(useSpring(si * 14))}}>
          <div style={{fontSize: 62, fontWeight: 800, color: c, marginBottom: 14}}>{side.title}</div>
          {side.points.map((p, i) => <div key={i} style={{fontSize: 42, fontWeight: 500, marginTop: 10, ...pop(useSpring(10 + si * 14 + i * 8), 20)}}>→ {p}</div>)}
        </div>
      );
    })}
  </Stage>
);

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
  const pulse = d ? 1 + 0.18 * Math.max(0, Math.sin(Math.min(1, Math.max(0, (f - 45) / 14)) * Math.PI)) : 1;
  return (
    <Stage tag={tag}>
      <div style={{background: theme.card, border: `3px solid ${theme.accent}`, borderRadius: 34, padding: '44px 44px 40px', boxShadow: `0 0 70px ${theme.accent}22`, ...pop(useSpring(0))}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 30}}>
          {d?.avatar ? <Img src={d.avatar} style={{width: 124, height: 124, borderRadius: 62, border: `3px solid ${theme.line}`}} /> : <div style={{width: 124, height: 124, borderRadius: 62, background: theme.cardHi, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 60, fontWeight: 800, color: theme.accent}}>{owner[0]?.toUpperCase()}</div>}
          <div style={{minWidth: 0}}>
            <div style={{fontSize: 40, color: theme.dim, fontWeight: 500}}>{d?.owner ?? owner} /</div>
            <div style={{fontSize: 74, fontWeight: 800, lineHeight: 1.05, wordBreak: 'break-word'}}>{d?.name ?? name}</div>
          </div>
        </div>
        {d?.description ? <div style={{fontSize: 42, color: theme.dim, lineHeight: 1.3, marginTop: 34, ...clampLines(3), ...pop(useSpring(8), 20)}}>{d.description}</div> : null}
        <div style={{height: 3, background: theme.line, margin: '36px 0'}} />
        <div style={{display: 'flex', alignItems: 'center', gap: 56, flexWrap: 'wrap'}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 16}}>
            <div style={{transform: `scale(${pulse})`}}><Star /></div>
            <div style={{fontSize: 84, fontWeight: 800, color: theme.accent, letterSpacing: -2}}>{d ? compact(stars) : '—'}</div>
          </div>
          {d ? <div style={{display: 'flex', alignItems: 'center', gap: 12, fontSize: 46, fontWeight: 700, ...pop(useSpring(16), 16)}}><Fork />{compact(d.forks)}</div> : null}
        </div>
        {d && (d.language || d.license) ? (
          <div style={{display: 'flex', gap: 22, marginTop: 30, fontSize: 36, color: theme.dim, flexWrap: 'wrap', ...pop(useSpring(22), 14)}}>
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
  const {durationInFrames} = useVideoConfig();
  const key = (() => { try { return new URL(url).href; } catch { return url; } })(); // assets are keyed by the canonical href
  const d = getAssets().sites?.[key];
  const zoom = interpolate(f, [0, durationInFrames], [1, 1.1], clamp);
  const panY = interpolate(f, [0, durationInFrames], [0, -24], clamp);
  const host = d?.domain ?? (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } })();
  const label = name ?? d?.name ?? host;
  return (
    <Stage tag={tag}>
      <div style={{border: `3px solid ${theme.line}`, borderRadius: 28, overflow: 'hidden', background: theme.card, boxShadow: `0 0 70px ${theme.glow}88`, ...pop(useSpring(0))}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 14, padding: '18px 24px', background: theme.cardHi}}>
          {['#ff5f57', '#febc2e', '#28c840'].map((c) => <div key={c} style={{width: 18, height: 18, borderRadius: 9, background: c}} />)}
          <div style={{flex: 1, marginLeft: 12, background: theme.bg, borderRadius: 20, padding: '8px 22px', fontSize: 30, color: theme.dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>🔒 {host}</div>
        </div>
        <div style={{width: '100%', aspectRatio: '1280 / 800', overflow: 'hidden', background: theme.bg}}>
          {d?.screenshot ? <Img src={d.screenshot} style={{width: '100%', display: 'block', transform: `scale(${zoom}) translateY(${panY}px)`, transformOrigin: '50% 0%'}} /> : <div style={{height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 64, fontWeight: 800, color: theme.dim}}>{host}</div>}
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
