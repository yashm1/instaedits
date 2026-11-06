# Security policy

## Reporting a vulnerability
Please **don't open a public issue**. Use GitHub's private reporting: *Security → Report a vulnerability* on this repository. Expect an acknowledgement within a few days.

## Threat model (what this tool defends against)
Instaedits is a **local, single-user** tool. It binds to `127.0.0.1`, drives paid LLM calls and your video editor, and holds one secret (the Edits access token).
- A web page you visit must not be able to start jobs → Host allow-list, Origin allow-list on POST, JSON-only POST, field whitelist.
- Secrets must not leak → the token lives in `.env.local` (gitignored) and reaches `claude` through a 0600 temp file, never on the command line or in logs.
- Requests must not escape `jobs/` → job ids are validated, video paths must be absolute files with a known extension, budgets are capped.

## Out of scope
A hostile process already running as your user (it can read `.env.local`), exposing the server beyond localhost, or running multiple instances.

## Operational advice
Never commit `.env.local`; rotate the Edits token (Settings → Automation) if it ever leaks; keep per-step budgets low while testing.
