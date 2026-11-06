// The dashboard drives paid LLM calls and your editor, so it must not be drivable by a random web page.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.mjs';

export const isSafeId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);

const hostsFor = (port) => new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

/**
 * Defences for a localhost server:
 *  - Host header allow-list (blocks DNS rebinding)
 *  - Origin allow-list on state-changing requests (blocks cross-site POST / CSRF)
 *  - JSON content-type on POST (forces a CORS preflight for cross-site callers)
 * Returns { ok: true } or { ok: false, status, reason }.
 */
export function checkRequest(req, port = config.server.port) {
  const allowed = hostsFor(port);
  if (!allowed.has(String(req.headers.host ?? '').toLowerCase())) return { ok: false, status: 403, reason: 'bad host' };
  if (req.method === 'GET' || req.method === 'HEAD') return { ok: true };
  const origin = req.headers.origin;
  if (origin !== undefined && ![...allowed].some((h) => origin === `http://${h}`)) return { ok: false, status: 403, reason: 'bad origin' };
  if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) return { ok: false, status: 415, reason: 'content-type must be application/json' };
  return { ok: true };
}

/** Absolute path to an existing regular video file with a known extension. Returns the cleaned path or throws. */
export function validateVideoPath(p) {
  const clean = String(p ?? '').trim().replace(/^['"]|['"]$/g, '');
  if (!path.isAbsolute(clean)) throw new Error('video must be an absolute path');
  if (!config.videoExtensions.includes(path.extname(clean).toLowerCase())) throw new Error(`video must be one of ${config.videoExtensions.join(', ')}`);
  if (!fs.existsSync(clean)) throw new Error(`video not found: ${clean}`);
  if (!fs.statSync(clean).isFile()) throw new Error('video must be a file');
  return clean;
}

/** Read a request body with a hard size cap. */
export function readJson(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let b = '', n = 0;
    req.on('data', (d) => { n += d.length; if (n > limit) { reject(new Error('body too large')); req.destroy(); } else b += d; });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { reject(new Error('invalid JSON')); } });
    req.on('error', reject);
  });
}
