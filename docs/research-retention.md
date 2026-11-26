# Retention & motion-quality research (Nov 2026)

What the editing rules in `server/prompts.mjs`, `server/guardrails.mjs`, `server/media.mjs` (pacing) and the Remotion
library are based on. **Honesty note:** platforms publish metrics, not editing rules. Measured findings are marked
**[measured]**; practitioner consensus is marked **[heuristic]** — treat those as defaults to test, not laws.

## The first 3 seconds
- Instagram's "Skip Rate" (Aug 2025) = share of viewers who scroll away within the first 3 s; a per-Reel retention
  chart shows dips. The 3-second window is the scored zone. — [socialmediatoday](https://www.socialmediatoday.com/news/instagram-adds-retention-insights-reels/758464/)
- **[measured]** Mobile-feed content is recalled after 0.25 s of exposure (Fors Marsh for Facebook IQ, 2016) → frame 0
  must carry the message: no fade-in, no logo, no black frame. — [marketingdive](https://www.marketingdive.com/news/facebook-why-mobile-video-ads-must-work-fast/446217/)
- **[measured, ads]** Up to 47% of campaign value in the first 3 s, 74% in the first 10 s (Facebook/Nielsen). — [marketingdive](https://www.marketingdive.com/news/brand-lift-happens-in-less-than-1-second-of-video-study-finds/377333)
- **[heuristic]** Layered hook: frame 1 = face close-up + bold high-contrast text of the spoken hook; 0–1 s a specific
  (numbered/contrarian/result) claim + an audio accent; 1–3 s the promise visibly starts paying off. A hook/body
  mismatch causes exactly the 3–5 s drop. — [OpusClip](https://www.opus.pro/blog/instagram-reels-hook-formulas)

## Pacing
- **[heuristic]** A visual change every 1.5–3 s; >4 s static is the danger zone; re-hook every 3–5 s. — [OpusClip](https://www.opus.pro/blog/ideal-instagram-reels-length)
- **[heuristic]** Punch-ins 10–20 % (scale 1.10–1.20), hold ≥3–4 s, never in-and-straight-out, alternate wide/tight,
  on emphasis words, punch OUT at topic changes, one speed style per video. — [AutoClip](https://autoclip.dev/blog/how-to-use-punch-in-zoom-effect)
- No peer-reviewed study ties cut rate to short-video retention.

## Structure
- **[heuristic]** Hook (open a loop) → minimum context → beats → payoff with no dead air → loop back to the opening;
  nothing spoken after the payoff. — [CapCut](https://www.capcut.com/create/looping-narrative-hooks-watch-time)

## Captions
- **[survey]** 69 % watch with sound off in public; 80 % more likely to finish with captions (Verizon/Publicis 2019). — [3Play](https://www.3playmedia.com/blog/verizon-media-and-publicis-media-find-viewers-want-captions/)
- Broadcast limits: ≤42 chars/line, ≤2 lines, ≤20 chars/s. — [Netflix](https://partnerhelp.netflixstudios.com/hc/en-us/articles/217350977-English-Timed-Text-Style-Guide)
- **[heuristic]** Captions appear 0.1–0.3 s before the audio; highlight ~1 keyword per phrase. — [OpusClip](https://www.opus.pro/blog/youtube-shorts-caption-subtitle-best-practices)

## Motion & infographic quality
- Durations 100–500 ms; ease-out to enter, ease-in to exit, entrances slightly longer than exits, never linear. — [NN/g](https://www.nngroup.com/articles/animation-duration/)
- Expressive curves: entrance `cubic-bezier(0,0,0.3,1)`, exit `cubic-bezier(0.4,0.14,1,1)`. — [IBM Carbon](https://carbondesignsystem.com/elements/motion/overview/)
- **[heuristic]** One idea per screen; one visual system; animate only what carries meaning; text held ≥1 s per 2–3
  words. — [designer-daily](https://www.designer-daily.com/motion-graphics-that-actually-communicate-lessons-from-explainer-videos-213110), [SSW](https://www.ssw.com.au/rules/post-production-do-you-give-enough-time-to-read-texts-in-your-videos)
- Remotion: animate only from `useCurrentFrame()`; render with `scale`, PNG frames, bt709, explicit CRF. — [Remotion quality](https://www.remotion.dev/docs/quality), [flickering](https://www.remotion.dev/docs/flickering)

## In-house rules (not sourced)
"No idle wobble — staged reveals / camera with intent instead", the leftward card "current", and the 0.6×duration
reveal spread come from the local motion doctrine, not from the sources above.
