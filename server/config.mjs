// Single place for every environment-dependent value. Change defaults here (or via env / .env.local) — nowhere else.
import fs from 'node:fs';
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
  // Models by ROLE. Override per role: INSTAEDITS_MODEL_DIRECTOR, _CODER, _EDITOR_HIGH, _EDITOR_FAST
  models: {
    director: env.INSTAEDITS_MODEL_DIRECTOR || 'claude-opus-5-5',
    coder: env.INSTAEDITS_MODEL_CODER || 'claude-sonnet-5-5',
    editorHigh: env.INSTAEDITS_MODEL_EDITOR_HIGH || 'claude-sonnet-5-5',
    editorFast: env.INSTAEDITS_MODEL_EDITOR_FAST || 'claude-haiku-5-5',
  },
  // Hard USD caps per LLM step (passed to `claude --max-budget-usd`).
  budgets: { direction: 1, codegen: 0.5, repair: 0.3, editHigh: 3, editFast: 1.5 },
  budgetCeiling: 10, // no request may raise a per-step cap above this (USD)
  claudeBin: env.CLAUDE_BIN || 'claude',
  editsUrl: env.METAPILOT_URL || 'http://127.0.0.1:19501/mcp',
  editsServer: 'metapilot-native', // MCP server key; tool names are mcp__<key>__<tool>
  editsToken: () => env.METAPILOT_TOKEN, // read lazily so tests/.env changes apply
  server: { host: '127.0.0.1', port: Number(env.PORT) || 4399 },
  jobsDir: env.INSTAEDITS_JOBS_DIR || path.join(ROOT, 'jobs'),
  remotionDir: path.join(ROOT, 'remotion'),
  canvas: { width: 1080, height: 1920, fps: 30 },
  videoExtensions: ['.mp4', '.mov', '.m4v', '.webm', '.mkv'],
};
