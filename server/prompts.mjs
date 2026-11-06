// All prompts live here so token usage is easy to audit. Keep them short.

export const PLAN_SYSTEM = `You are a short-form video director for a tech creator who explains HLD, LLD and AI in Instagram Reels (9:16).
Goal: maximise watch-time retention. Rules: a visual change every 2-4s, the hook visual appears in the first 1.5s, one idea per scene, minimal on-screen text (<=12 words), end with a payoff scene.
The creator's own talking-head video stays as the base layer; you plan overlay cards that cut over it.
Return ONLY JSON matching the schema. Be terse.`;

export const PLAN_SCHEMA = {
  type: 'object',
  required: ['scenes', 'remotion_brief'],
  properties: {
    remotion_brief: { type: 'string', description: 'Max 120 words: visual style + motion notes for the Remotion developer' },
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'anchor', 'start', 'dur', 'kind', 'props'],
        properties: {
          id: { type: 'string', description: 's1, s2, ...' },
          anchor: { type: 'string', description: 'Exact 3-6 word phrase from the script where this card appears' },
          start: { type: 'number', description: 'Estimated start second in the video' },
          dur: { type: 'number', description: 'Seconds, 1.5-5' },
          kind: { enum: ['Title', 'Flow', 'Code', 'Stat', 'Bullets', 'Compare'] },
          props: { type: 'object' },
        },
      },
    },
  },
};

export const planPrompt = ({ script, duration, library }) => `Video duration: ${duration.toFixed(1)}s.
Available scene kinds (props in parentheses):
${library}

SCRIPT:
${script}

Plan 6-14 overlay scenes covering the video, non-overlapping, sorted by start. Total card time should be ~50-65% of the video; leave talking-head gaps between cards.`;

export const codegenPrompt = ({ jobId }) => `Read ./LIBRARY.md and ../jobs/${jobId}/storyboard.json, then write ./src/Scenes.tsx following the output contract exactly.
Use the library components with the storyboard props. Honour remotion_brief for any custom touches but prefer library components (cheaper, safer).
Do not read other files, do not run commands. Reply with just "done".`;

export const repairPrompt = (err) => `Rendering/typecheck failed:\n${err.slice(0, 1500)}\nFix ./src/Scenes.tsx with the smallest possible edit. Reply "done".`;

export const editPrompt = ({ video, clipsDir, storyboard, out, quality }) => `You are driving the "Edits" desktop video editor through the metapilot-native tools. Be efficient: do not call tools to re-inspect state unless a step fails.

INPUT
- Source video: ${video}
- Overlay clips (1080x1920 mp4, one per scene): ${clipsDir}/<id>.mp4
- Storyboard (id, anchor phrase, estimated start, dur): ${JSON.stringify(storyboard.map(({ id, anchor, start, dur }) => ({ id, anchor, start, dur })))}
- Export to: ${out}

STEPS
1. New project, 9:16 canvas, import the source video onto the main timeline.
2. Transcribe the clip (transcribeClip) so you can align each scene's anchor phrase to a real timestamp; fall back to the estimated start.
3. Remove long pauses / dead air (findPauses, then cut) — tighten but keep natural rhythm. Recompute overlay timestamps after cuts.
4. Import each overlay mp4 and place it as an overlay layer above the video at its aligned start with its dur. Keep the talking-head AUDIO continuous; mute the overlay clips' audio. Add a short quick transition (fade/zoom) between card and talking head.
5. Generate captions with the app's DEFAULT caption style (do not restyle).
6. Add one subtle background music track at low volume (ducked under voice) and light whoosh SFX at a few card entries (max 4).
7. ${quality === 'high' ? 'Quality pass: preview a few frames (previewVideoFrames) and fix any overlap between captions and cards, clipped text or audio clipping.' : 'Skip the quality pass.'}
8. Export to the path above and wait until exportStatus is finished.
Reply with one line: the exported file path (or the exact error).`;
