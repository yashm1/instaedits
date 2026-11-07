# Card library (rendered by remotion/src/Reel.tsx from the EDL — no code generation)
Cards render in the TOP HALF of a split screen (1080x960; the speaker stays visible below). Content auto-fits the panel. Props are plain JSON.
Icons (use in `icon`): client, server, db, queue, cache, lb, cloud, lock, ai, user, api
- `Hook {text, hot?:string[], sub?, tag?, shot?}` — big kinetic statement; `hot` words glow (1-2 words). Hook / payoff / mid-video micro-hook (≤8 words; opening hook ≤4 words). The OPENING hook is the first frame and the thumbnail: hot words sit on a solid accent block, and `shot` (a REAL SCREENSHOTS key) puts that real screen behind it as proof
- `Flow {title?, nodes:[{label, note?, icon?}], highlight? (node index or its label), tag?}` — architecture flow, left→right in the panel, with moving data packets (max 4 nodes)
- `Fanout {title?, from:{label,icon?}, to:[{label,icon?}], tag?}` — 1→N (load balancer → servers, topic → consumers), 2-4 targets
- `Steps {title?, steps:[{label, note?}], tag?}` — numbered lifecycle, max 4
- `Chart {title?, bars:[{label, value, unit?}], tag?}` — animated bars for comparisons (3-4 bars)
- `Code {code, title?, highlightLines?:number[], tag?}` — syntax-highlighted typed code, max 10 lines, ≤30 chars per line
- `Stat {value, label, sub?, tag?}` — count-up number, e.g. "99.99%", "1.2M"
- `Bullets {title?, items:[...], tag?}` — max 3 short items
- `Compare {left:{title,points[]}, right:{title,points[]}, tag?}` — max 3 points per side
- `Repo {repo:"owner/name", tag?}` — the REAL GitHub repo as a card (avatar, description, ★ count-up, forks, language, licence), fetched live. Use ONLY when the speaker names a specific open-source project and you are certain of the exact `owner/name`; it is verified against GitHub and silently dropped if wrong
- `Site {url:"https://…", name, tag?}` — a REAL screenshot of a tool's official site in a browser frame (icon, name, description). Official `https` URL only, only when certain; verified by opening it, dropped if it fails
- `Screen {shot, title?, caption?, tag?}` — a REAL screenshot (captured from the app, secrets redacted) in a window frame that slowly pushes in. `shot` must be one of the REAL SCREENSHOTS listed in the brief
(`Title` is an alias of `Hook`.)

`tag` is a progress cue (e.g. "STEP 2/4", "HLD", "RESULT") — use it on every card of a multi-step explanation.
