// Single place for every environment-dependent value. Change defaults here (or via env / .env.local) — nowhere else.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// .env.local (gitignored): METAPILOT_TOKEN=<Edits → Settings → Automation → Access token>
const envFile = path.join(ROOT, '.env.local');
if (fs.existsSync(envFile)) {
  for (const l of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
const env = process.env;

export const config = {
  // Models by ROLE. Override per role: INSTAEDITS_MODEL_DIRECTOR, _TRANSLATOR, _CAPTIONS, _REVIEWER
  // Only creative/language judgement uses a model; rendering and the Edits edit itself are plain code.
  models: {
    director: env.INSTAEDITS_MODEL_DIRECTOR || 'claude-opus-5-5', // understands the video, plans every visual
    translator: env.INSTAEDITS_MODEL_TRANSLATOR || 'claude-sonnet-5-5', // non-English audio → English script
    captions: env.INSTAEDITS_MODEL_CAPTIONS || 'claude-sonnet-5-5', // Hindi captions → Latin-script Hinglish
    reviewer: env.INSTAEDITS_MODEL_REVIEWER || 'claude-sonnet-5-5', // watches the export's contact sheet before "done"
  },
  // Hard USD caps per LLM step (passed to `claude --max-budget-usd`).
  budgets: { direction: 1, translate: 0.3, captions: 0.3, review: 0.4 },
  budgetCeiling: 10, // no request may raise a per-step cap above this (USD)
  claudeBin: env.CLAUDE_BIN || 'claude',
  editsUrl: env.METAPILOT_URL || 'http://127.0.0.1:19501/mcp',
  editsServer: 'metapilot-native', // MCP server key; tool names are mcp__<key>__<tool>
  editsToken: () => env.METAPILOT_TOKEN, // read lazily so tests/.env changes apply
  server: { host: '127.0.0.1', port: Number(env.PORT) || 4399 },
  // The Edits app is sandboxed: it can only read/write folders it has access to. ~/Movies works (verified).
  stagingDir: env.INSTAEDITS_STAGING_DIR || path.join(os.homedir(), 'Movies', 'Instaedits'),
  // Real Edits screenshots (editor + Automation settings), token-redacted. Gitignored; refreshed when older than 7 days.
  screensDir: env.INSTAEDITS_SCREENS_DIR || path.join(ROOT, 'screens'),
  jobsDir: env.INSTAEDITS_JOBS_DIR || path.join(ROOT, 'jobs'),
  remotionDir: path.join(ROOT, 'remotion'),
  canvas: { width: 1080, height: 1920, fps: 30 },
  // Reference visuals (real tool/repo cards). GITHUB_TOKEN is optional: raises the API limit from 60 to 5000 requests/hour.
  githubApi: env.INSTAEDITS_GITHUB_API || 'https://api.github.com',
  githubToken: () => env.GITHUB_TOKEN,
  maxReferenceCards: 3,
  // Names the creator says that speech recognition tends to mishear (e.g. "Remotion" → "emotion"). Per job: the Terms field.
  defaultTerms: (env.INSTAEDITS_TERMS || 'Remotion, Claude Code, Claude, Codex, Gemini, Edits, Instagram, GitHub, MCP').split(',').map((t) => t.trim()).filter(Boolean),
  referenceTimeoutMs: 20000,
  videoExtensions: ['.mp4', '.mov', '.m4v', '.webm', '.mkv'],
};
