// Real screenshots of the Edits app (editor workspace + the Automation/MCP server settings) for "show, don't tell" cards.
// Captured locally with macOS `screencapture`; any access token is found with Apple Vision OCR and painted over, then the
// result is OCR'd AGAIN and discarded if anything token-like is still readable (fail closed). Images never go to an LLM.
// Needs: macOS, Screen Recording permission for the terminal running instaedits.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from './config.mjs';
import { tool as editsTool } from './edits-mcp.mjs';

const pexec = promisify(execFile);
const NATIVE = path.join(path.dirname(new URL(import.meta.url).pathname), 'native');

/** What the director may show. Keys are stable: they are the `shot` prop of the Screen card. */
export const SCREENS = {
  'edits-editor': { title: 'Edits desktop app', about: 'the Edits desktop editor workspace with this video on its timeline (media, captions, effects panels)', focus: { x: 0.42, y: 0.32 } },
  'edits-automation': { title: 'Edits → Settings → Automation', about: 'the Automation (MCP) server settings in Edits: Enable Automation Server toggle, port 19501, endpoint, connect Claude Code / Codex (token redacted)', focus: { x: 0.62, y: 0.3 } },
};

// ───────── secret detection (pure; unit-tested) ─────────
const TOKENISH = /[A-Za-z0-9_\-–—]{20,}/g;
/** True if an OCR'd string looks like (or contains part of) a secret token. */
export function looksSecret(text, token = '') {
  const s = String(text ?? '').replace(/\s+/g, '');
  if (!s) return false;
  if (token && token.length >= 16) {
    const t = token.replace(/\s+/g, '');
    if (s.includes(t) || s.includes(t.slice(0, 8)) || s.includes(t.slice(-8))) return true;
  }
  for (const m of s.match(TOKENISH) ?? []) if (/\d/.test(m) && /[a-z]/.test(m) && /[A-Z]/.test(m)) return true; // mixed-case + digits = key-like
  return false;
}

/**
 * Boxes to paint over: every observation that looks secret, plus whatever sits directly under an "Access token" /
 * "API key" / "Secret" label (layout rule, in case OCR garbles the token itself). Boxes are padded.
 */
export function secretBoxes(obs, token = '', pad = 10) {
  const out = [];
  const labels = obs.filter((o) => /^\s*(access\s*token|api\s*key|secret(\s*key)?|password|token)\s*:?\s*$/i.test(o.text)); // a heading, not prose that mentions one
  for (const o of obs) {
    const underLabel = labels.some((l) => l !== o && o.y > l.y && o.y - (l.y + l.h) < l.h * 2.5 && Math.abs(o.x - l.x) < l.h * 3);
    if (looksSecret(o.text, token) || (underLabel && !/^(copy|regenerate|сору)$/i.test(o.text.trim()))) {
      out.push({ x: Math.max(0, Math.floor(o.x - pad)), y: Math.max(0, Math.floor(o.y - pad)), w: Math.ceil(o.w + 2 * pad), h: Math.ceil(o.h + 2 * pad) });
    }
  }
  return out;
}

// ───────── native helpers ─────────
const jsonLines = (s) => s.split('\n').filter((l) => l.trim().startsWith('{')).map((l) => JSON.parse(l));
export async function ocr(file) {
  const { stdout } = await pexec('swift', [path.join(NATIVE, 'ocr.swift'), file], { timeout: 120_000, maxBuffer: 8 << 20 });
  return jsonLines(stdout);
}
async function windows(owner = 'Edits') {
  const { stdout } = await pexec('swift', [path.join(NATIVE, 'windows.swift'), owner], { timeout: 120_000 });
  return jsonLines(stdout);
}
async function captureWindow(id, file) {
  fs.rmSync(file, { force: true });
  try { await pexec('screencapture', ['-x', '-o', '-l', String(id), file], { timeout: 20_000 }); } catch { /* reported below */ }
  if (!fs.existsSync(file) || fs.statSync(file).size < 5000) throw new Error('screen capture failed — grant Screen Recording permission to your terminal (System Settings → Privacy & Security)');
}
async function paint(file, boxes) {
  if (!boxes.length) return;
  const vf = boxes.map((b) => `drawbox=x=${b.x}:y=${b.y}:w=${b.w}:h=${b.h}:color=0x2a2b2e:t=fill`).join(',');
  const tmp = file.replace(/\.png$/, '.tmp.png');
  await pexec('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-vf', vf, tmp]);
  fs.renameSync(tmp, file);
}

/** Is this OCR of the EDITOR (not the projects grid)? The editor has Export + its tool panels; the grid has "Projects"/"New project". */
export const isEditorScreen = (obs) => {
  const t = obs.map((o) => o.text.trim().toLowerCase());
  // the editor's own title bar shows "New project 13", so only the grid's "Projects" heading is a reject signal
  return t.includes('export') && t.some((x) => /^(media|captions|sound fx|transitions|effects)$/.test(x)) && !t.includes('projects');
};

/** OCR → redact → OCR again. Throws (and deletes the file) if a secret survives. Returns the number of boxes painted. */
export async function redactFile(file, token, deps = {}) {
  const read = deps.ocr ?? ocr;
  const boxes = secretBoxes(await read(file), token);
  await (deps.paint ?? paint)(file, boxes);
  const left = (await read(file)).filter((o) => looksSecret(o.text, token));
  if (left.length) { fs.rmSync(file, { force: true }); throw new Error('a token was still readable after redaction — screenshot discarded'); }
  return boxes.length;
}

const fresh = (f, days = 7) => fs.existsSync(f) && Date.now() - fs.statSync(f).mtimeMs < days * 864e5;
const userMarker = (key) => path.join(config.screensDir, `${key}.user`);

/**
 * Use YOUR screenshot for a shot (e.g. `npm run screens -- edits-automation ~/Desktop/automation.png`). It is redacted
 * exactly like a capture (fail closed) and marked as user-provided, so auto-capture never overwrites it.
 */
export async function importScreen(key, src, { token = config.editsToken(), deps = {} } = {}) {
  if (!SCREENS[key]) throw new Error(`unknown screenshot "${key}" — one of: ${Object.keys(SCREENS).join(', ')}`);
  if (!/\.png$/i.test(src) || !fs.existsSync(src)) throw new Error('give a .png file that exists');
  fs.mkdirSync(config.screensDir, { recursive: true });
  const file = path.join(config.screensDir, `${key}.png`);
  fs.copyFileSync(src, file);
  const n = await redactFile(file, token, deps); // throws (and deletes the copy) if a secret survives
  fs.writeFileSync(userMarker(key), path.basename(src));
  return { file, redacted: n };
}

/**
 * Capture (or reuse, ≤7 days old) the Edits screenshots into config.screensDir. Best effort: returns what is available,
 * logs why anything is missing, never throws. `{ [key]: absolutePath }`.
 */
export async function captureScreens({ log = () => {}, token = config.editsToken(), force = false } = {}) { // force: re-capture even recent screenshots
  const dir = config.screensDir; fs.mkdirSync(dir, { recursive: true });
  const have = {};
  const shoot = async (key, grab, check) => {
    const file = path.join(dir, `${key}.png`);
    if (fs.existsSync(userMarker(key)) && fs.existsSync(file)) { have[key] = file; return; } // the creator's own screenshot wins
    if (!force && fresh(file)) { have[key] = file; return; }
    try {
      await grab(file);
      const obs = await ocr(file);
      if (check && !check(obs)) { fs.rmSync(file, { force: true }); throw new Error('the window is not showing the expected screen'); }
      const n = await redactFile(file, token);
      have[key] = file; log(`📸 ${key}${n ? ` (${n} secret region${n > 1 ? 's' : ''} redacted)` : ''}`);
    } catch (e) {
      if (fs.existsSync(file)) { have[key] = file; log(`⚠️ ${key}: ${e.message} — reusing the older screenshot`); }
      else log(`⚠️ ${key} skipped: ${e.message}`);
    }
  };
  // Editor: the transcribe step leaves the source open in the editor. Its window only captures while Edits is frontmost
  // (it lives on its own Space), and switching Spaces takes a moment — so activate, wait, and retry.
  try {
    if ((await editsTool('appState'))?.screen === 'editor') {
      await shoot('edits-editor', async (file) => {
        let lastErr = new Error('window not found');
        for (let i = 1; i <= 3; i++) {
          await pexec('open', ['-a', 'Edits']); await new Promise((r) => setTimeout(r, 1500 * i));
          const cands = (await windows()).filter((w) => !w.name && w.w >= 1000 && w.h >= 600).sort((a, b) => (b.onscreen - a.onscreen) || (b.w * b.h - a.w * a.h));
          for (const w of cands) {
            try {
              await captureWindow(w.id, file);
              if (isEditorScreen(await ocr(file))) return; // never ship the projects grid as "the editor"
              lastErr = new Error('Edits showed its projects grid, not the editor'); fs.rmSync(file, { force: true });
            } catch (e) { lastErr = e; }
          }
        }
        throw lastErr;
      });
    } else log('⚠️ edits-editor skipped: Edits is not showing the editor');
  } catch (e) { log(`⚠️ edits-editor skipped: ${e.message}`); }
  await shoot('edits-automation', async (file) => {
    const w = (await windows()).find((x) => x.name === 'Settings');
    if (!w) throw new Error('the Edits Settings window is not open');
    await captureWindow(w.id, file);
  }, (obs) => obs.some((o) => /automation server/i.test(o.text)));
  if (!have['edits-automation']) log('   tip: open Edits → Settings → Automation once (leave the window open) to include it');
  return have;
}
