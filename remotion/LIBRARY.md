# Scene library (import from './lib' inside src/Scenes.tsx)
All 1080x1920, 30fps, dark theme. Props are plain JSON.
- `Title {text, sub?, tag?}` — hook / section title
- `Flow {title?, nodes:[{label, note?}], highlight?, tag?}` — vertical architecture diagram (HLD), max 5 nodes
- `Code {code, title?, tag?}` — typed code (LLD), max ~12 lines, ~34 chars wide
- `Stat {value, label, sub?, tag?}` — one big number
- `Bullets {title?, items:[...], tag?}` — max 4 short items
- `Compare {left:{title,points[]}, right:{title,points[]}, tag?}` — max 3 points per side

# Output contract: src/Scenes.tsx must export
`export const scenes: {id: string; durationInFrames: number; Component: React.FC}[]`
- ids exactly match storyboard ("s1", "s2", ...)
- durationInFrames = round(dur * 30)
- Component = `() => <Flow ... />` etc. You may write a small custom component in the same file if no library piece fits.
