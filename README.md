# Instaedits

Script + video in → edited Reel out. Local dashboard that runs the whole workflow and shows every step.

```
npm run setup      # installs Remotion deps (once)
npm start          # http://127.0.0.1:4399
```
Requires: `claude` CLI (logged in), `ffmpeg`/`ffprobe`, Node 20+, the **Edits** app open with the `metapilot-native` MCP server running (default `http://127.0.0.1:19501/mcp`, override with `METAPILOT_URL`).

## One-time setup: Edits access token
Edits → Settings → Automation → copy the **Access token**, then:
```
echo 'METAPILOT_TOKEN=<paste>' > .env.local   # gitignored
```

## Pipeline (Opus decides everything creative; everyone else executes)
| # | Step | Who | Notes |
|---|------|-----|-------|
| 1 | Probe | ffprobe | |
| 2 | Word-level transcript | Edits app captions model, called directly from Node | 0 LLM tokens |
| 3 | Cut dead air | ffmpeg | gaps >0.5s removed → `tight.mp4` (so the Edits agent never has to cut) |
| 4 | **Creative direction** | **Opus 5.5** | cards + anchors, punch-ins, caption style/colour/keywords, music query + levels + ducking, SFX cues, grade. Constrained to options verified in the Edits app |
| 5 | Resolve → EDL | local | anchors → exact timestamps on the tight timeline; zooms snapped to card-free gaps; SFX spaced |
| 6 | Write `Scenes.tsx` | Sonnet 5.5 | verbatim props → library components |
| 7 | Render infographics | Remotion | Hook, Flow (data packets), Fanout, Steps, Chart, Code (syntax-highlighted), Stat (count-up), Bullets, Compare |
| 8 | **Execute the EDL** in Edits | Sonnet 5.5 (High) / Haiku 5.5 (Fast) | import, overlay cards + transitions, punch-ins, captions (style + keyword highlights), music + ducking, SFX, grade, export. High adds a frame-QA pass |
| 9 | Verify | ffprobe | |

## Token discipline
- Every `claude -p` call is minimal: no skills, no user settings, only the tools / MCP it needs (`--strict-mcp-config`, `--tools`).
- Hard USD cap per LLM step (`--max-budget-usd`, editable for the Edit step in the UI).
- Component library means Sonnet doesn't author animations from scratch.
- Artifacts are cached per job (`storyboard.json`, `Scenes.tsx`, rendered clips): "Re-run from here" never re-pays for earlier steps.
- Dry-run mode stops before the Edits app (typical plan+codegen ≈ $0.09).
- Per-step tokens and cost are shown live in the dashboard.

## Layout
`server/` pipeline + SSE API · `public/index.html` dashboard · `remotion/` component library + renderer · `jobs/` per-run artifacts (gitignored)
