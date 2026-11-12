# Third-party software & services

This repository is MIT-licensed. It **does not bundle or redistribute** any of the following; you install or run them yourself and accept their terms.

| Component | Used for | Terms |
|---|---|---|
| [Remotion](https://www.remotion.dev) (`remotion`, `@remotion/*`) | rendering infographics | **Custom license** (see `remotion/node_modules/remotion/LICENSE.md` after install). At the time of writing: free for individuals, non-profits, and for-profit organisations with up to 3 employees; larger for-profit organisations need a [Company License](https://www.remotion.pro/license). Remotion has announced license changes for v5. **You are responsible for checking that your use is covered.** |
| React / React DOM | scene components | MIT |
| TypeScript | typechecking | Apache-2.0 |
| Inter, JetBrains Mono (via `@remotion/google-fonts`) | card typography | SIL Open Font License 1.1; fetched from Google Fonts at render time |
| FFmpeg / ffprobe | cutting dead air, probing | LGPL/GPL depending on your build; invoked as an external program |
| Claude Code CLI + Claude models | creative direction, code generation, driving the editor | Anthropic's terms; usage is billed to your own account/plan |
| Edits desktop app (+ its music/SFX libraries) | transcription, assembly, export | Proprietary third-party app, **unofficial integration**; its media libraries are used inside the app and never copied into this repo |

"Claude", "Remotion", "Edits" and "Instagram" are trademarks of their respective owners. This project is not affiliated with or endorsed by them.

## claude-video-effects (optional)
Face-tracked effects on the speaker's footage, by Vibha Ramprakash — https://github.com/Vibha-Ramprakash/claude-video-effects
(MIT). Not bundled: `npm run effects:install` clones it at a reviewed commit into `vendor/` (gitignored). Its models keep
their licences (OpenCV YuNet — MIT; MediaPipe Selfie Segmenter — Apache-2.0) and its fonts theirs (SIL OFL / Apache-2.0).
Instaedits uses its renderer (`scripts/fx.py`) only; its Whisper-based `words.py` is not used (word timing comes from the
Edits transcript).
