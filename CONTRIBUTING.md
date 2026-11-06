# Contributing

Thanks for helping! A few ground rules keep this project reliable.

1. **Nothing goes to `main` directly.** Branch (`feat/…`, `fix/…`) → pull request → self-review comment (what you checked, what's still imperfect).
2. **Every change ships with tests.** `npm test` must pass (Node ≥ 22.18). Prefer tests that fail when the behaviour breaks — try a quick mutation (break the code, see the suite go red).
3. **Keep it simple.** Prefer deterministic local code over LLM calls; every extra LLM call costs the user money. Creative rules belong in `server/prompts.mjs`, numeric limits in `server/guardrails.mjs` (enforced + tested), environment values in `server/config.mjs`.
4. **Scope.** The supported editor is the Edits desktop app (macOS) only. New editor backends are out of scope for now; open an issue first.

## Setup
```
npm run setup && cp .env.example .env.local   # paste your Edits token
npm test
npm start
```

## Adding a card type
Add the component in `remotion/src/lib/index.tsx`, document it in `remotion/LIBRARY.md`, add its name to `SCENE_KINDS` in `server/catalog.mjs`. `test/pipeline.test.mjs` fails if any of the three drift.

## Commit/PR style
Imperative subject, a short "why" in the body. PR description: what, why, tests, not verified.
