# Security policy

## Reporting a vulnerability
Please **don't open a public issue**. Use GitHub's private reporting: *Security → Report a vulnerability* on this repository. Expect an acknowledgement within a few days.

## Threat model (what this tool defends against)
Instaedits is a **local, single-user** tool. It binds to `127.0.0.1`, drives paid LLM calls and your video editor, and holds one secret (the Edits access token).
- A web page you visit must not be able to start jobs → Host allow-list, Origin allow-list on POST, JSON-only POST, field whitelist.
- Secrets must not leak → the token lives in `.env.local` (gitignored) and reaches `claude` through a 0600 temp file, never on the command line or in logs.
- A URL suggested by a model must not reach your machine or LAN → every Repo/Site URL passes an SSRF guard (https only, default port, public hostnames only, **all** DNS answers checked, redirects re-checked) before and after navigation; this protects the Edits MCP server on `127.0.0.1`, routers and cloud-metadata endpoints.
- A web page must not be able to instruct the pipeline → fetched text and images are passed only to Remotion as data and **never to an LLM**; image fetches are size-capped and type-checked.
- Requests must not escape `jobs/` → job ids are validated, video paths must be absolute files with a known extension, budgets are capped.

## Known residual risks
The SSRF guard resolves DNS before navigating, so a hostile DNS server could still answer differently at connection time (DNS rebinding); the final URL is re-checked, and the page content is only ever screenshotted. A visited page can still make blind GET requests from headless Chrome. Mitigation: only the official site of a tool the speaker names is ever opened, max 3 per video.

## Out of scope
A hostile process already running as your user (it can read `.env.local`), exposing the server beyond localhost, or running multiple instances.

## Operational advice
Never commit `.env.local`; rotate the Edits token (Settings → Automation) if it ever leaks; keep per-step budgets low while testing.
