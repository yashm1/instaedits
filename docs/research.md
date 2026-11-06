# Retention research (articles only, no video-by-video analysis)

**Evidence quality: low-to-medium.** Almost everything online is practitioner opinion; specific percentages (e.g. "71% retention at 4-5s cuts", "68% of views muted") are unsourced and are NOT used here. We only adopt rules that several independent guides agree on, and we encode the numeric ones as guardrails (`server/guardrails.mjs`) with tests.

| Rule adopted | Where | Sources |
|---|---|---|
| Novel information beats cut speed; change the visual when the idea changes; transitions only at topic changes | director doctrine | [Vidpros – Mario Joos](https://vidpros.com/retention-editing-what-you-can-learn-from-mario-joos/), [Async](https://async.com/blog/how-to-edit-instagram-reels/) |
| Hook passes the silent test: short text on first frame (≤4 words, upper third), sharp audio cue, open a loop | doctrine, guardrail (hook ≤4 words), resolver (hook starts at 0.1s) | [Hook Engineering](https://dev.to/bulkdl/hook-engineering-the-science-of-the-first-3-seconds-in-short-form-video-2026-2jp9), [Async](https://async.com/blog/how-to-edit-instagram-reels/) |
| Cut pauses >0.4s, cut on phrase boundaries; shots ~1.5–6s | `planCuts` maxGap 0.4, card duration clamp | [Async](https://async.com/blog/how-to-edit-instagram-reels/) |
| Captions: 2–3 words/line, large, ~middle-lower, ≤1 highlighted word per line, ≤10% of words highlighted | edit prompt, guardrail (keyword cap) | [Async](https://async.com/blog/how-to-edit-instagram-reels/) |
| Safe zones: keep top 14% / bottom 20% clear (IG UI) | `remotion/src/lib/theme.ts` `safe` | [Async](https://async.com/blog/how-to-edit-instagram-reels/) |
| Sparse sound (~3–5 SFX per 30s), music far under voice, duck it; test at half volume on a phone speaker | guardrails (SFX cap, music ≤0.16) | [Hook Engineering](https://dev.to/bulkdl/hook-engineering-the-science-of-the-first-3-seconds-in-short-form-video-2026-2jp9), [Async](https://async.com/blog/how-to-edit-instagram-reels/) |
| Progress cues + mid-video re-hook | `tag` on cards, micro-hook rule | [Vidpros](https://vidpros.com/retention-editing-what-you-can-learn-from-mario-joos/) |
| Colour: luminance contrast + saturation attract attention first; dark ground + ONE hero accent, 2–3 colours total | `theme.ts` (+ WCAG contrast tests) | search-result summaries of attention/colour studies and thumbnail-design guides (primary papers NOT individually verified); the "dark backgrounds are better" claim is contested, so contrast — not darkness — is the rule |

**Not found:** specific, verifiable breakdowns of Varun Mayya's editing (only a job post calling it "fast-paced, audio-reactive"). We did not copy his style; the MrBeast material is secondhand and its "cut every N seconds" figures conflict, so cut cadence is driven by information, not a timer.
