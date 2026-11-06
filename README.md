# Instaedits

Script + video in → edited Reel out. Local dashboard that runs the whole workflow and shows every step.

```
npm run setup      # installs Remotion deps (once)
npm start          # http://127.0.0.1:4399
```
Requires: `claude` CLI (logged in), `ffmpeg`/`ffprobe`, Node 20+, the **Edits** app open with the `metapilot-native` MCP server running (default `http://127.0.0.1:19501/mcp`, override with `METAPILOT_URL`).

## Pipeline
| # | Step | Model | Notes |
|---|------|-------|-------|
| 1 | Probe video | local | ffprobe |
| 2 | Storyboard + Remotion brief | Opus 5.5 | no tools, low effort, structured JSON out |
| 3 | Write `Scenes.tsx` | Sonnet 5.5 | uses the prebuilt component library (`remotion/LIBRARY.md`) so it only writes props, not animation code |
| 4 | Render scenes | local | bundle once, render each scene to `jobs/<id>/clips/sN.mp4`; one cheap Sonnet repair on failure |
| 5 | Edit in Edits app | Sonnet 5.5 (High) / Haiku 5.5 (Fast) | cut pauses, overlay clips, **default captions**, music + SFX, export |
| 6 | Verify export | local | ffprobe |

## Token discipline
- Every `claude -p` call is minimal: no skills, no user settings, only the tools / MCP it needs (`--strict-mcp-config`, `--tools`).
- Hard USD cap per LLM step (`--max-budget-usd`, editable for the Edit step in the UI).
- Component library means Sonnet doesn't author animations from scratch.
- Artifacts are cached per job (`storyboard.json`, `Scenes.tsx`, rendered clips): "Re-run from here" never re-pays for earlier steps.
- Dry-run mode stops before the Edits app (typical plan+codegen ≈ $0.09).
- Per-step tokens and cost are shown live in the dashboard.

## Layout
`server/` pipeline + SSE API · `public/index.html` dashboard · `remotion/` component library + renderer · `jobs/` per-run artifacts (gitignored)
