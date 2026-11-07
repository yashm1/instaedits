# Scene library (import from './lib' inside src/Scenes.tsx)
1080x1920, 30fps, dark theme. Props are plain JSON. Safe zones are built in (top 350px incl. label, bottom 620px reserved for IG UI + captions at ~68% height) — never add content there.
Icons (use in `icon`): client, server, db, queue, cache, lb, cloud, lock, ai, user, api
- `Hook {text, hot?:string[], sub?, tag?}` — big kinetic statement in the upper third; `hot` words glow (1-2 words). Hook / payoff / mid-video micro-hook (≤8 words; opening hook ≤4 words)
- `Flow {title?, nodes:[{label, note?, icon?}], highlight? (node index or its label), tag?}` — vertical architecture flow with moving data packets (max 4 nodes)
- `Fanout {title?, from:{label,icon?}, to:[{label,icon?}], tag?}` — 1→N (load balancer → servers, topic → consumers), 2-4 targets
- `Steps {title?, steps:[{label, note?}], tag?}` — numbered lifecycle, max 4
- `Chart {title?, bars:[{label, value, unit?}], tag?}` — animated bars for comparisons (3-4 bars)
- `Code {code, title?, highlightLines?:number[], tag?}` — syntax-highlighted typed code, max 10 lines, ≤30 chars per line
- `Stat {value, label, sub?, tag?}` — count-up number, e.g. "99.99%", "1.2M"
- `Bullets {title?, items:[...], tag?}` — max 3 short items
- `Compare {left:{title,points[]}, right:{title,points[]}, tag?}` — max 3 points per side
- `Repo {repo:"owner/name", tag?}` — the REAL GitHub repo as a card (avatar, description, ★ count-up, forks, language, licence), fetched live. Use ONLY when the speaker names a specific open-source project and you are certain of the exact `owner/name`; it is verified against GitHub and silently dropped if wrong
- `Site {url:"https://…", name, tag?}` — a REAL screenshot of a tool's official site in a browser frame (icon, name, description). Official `https` URL only, only when certain; verified by opening it, dropped if it fails
(`Title` is an alias of `Hook`.)

# Output contract: src/Scenes.tsx must export
`export const scenes: {id: string; durationInFrames: number; Component: React.FC}[]`
- ids exactly match the scene list ("s1", "s2", ...)
- durationInFrames = round(dur * 30)
- Component = `() => <Flow ... />` etc. Use the given props verbatim. Do not restyle or invent new components.

`tag` is a progress cue (e.g. "STEP 2/4", "HLD", "RESULT") — use it on every card of a multi-step explanation.
