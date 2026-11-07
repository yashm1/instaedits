// "Go there": when the speaker names a tool or a GitHub repo, show the real thing. GitHub repos come from the public
// REST API; tools/sites are opened in headless Chrome and screenshotted. Everything fetched is data (text + images)
// for Remotion — it is NEVER sent to an LLM (no prompt-injection path), and every URL passes the SSRF guard.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from './config.mjs';
import { assertPublicHttpUrl } from './netguard.mjs';

export const REF_KINDS = ['Repo', 'Site'];
export const isRefKind = (k) => REF_KINDS.includes(k);

/** 'owner/name' (also accepts a github.com URL) → normalised string, or null. Strict: no query strings, dots-only names, extra segments. */
export function parseRepo(ref) {
  let s = String(ref ?? '').trim();
  const m = s.match(/^https:\/\/github\.com\/([^/?#]+)\/([^/?#]+?)(?:\.git)?\/?$/i);
  if (m) s = `${m[1]}/${m[2]}`;
  const ok = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}$/.test(s) && !/^\.{1,2}$/.test(s.split('/')[1]);
  return ok ? s : null;
}

const dataUri = (type, buf) => `data:${type};base64,${Buffer.from(buf).toString('base64')}`;

/** GET with timeout and a hard byte cap (streams; aborts when the cap is exceeded). */
export async function fetchBytes(url, { fetchFn = fetch, max = 400_000, timeoutMs = 10_000, headers = {} } = {}) {
  const res = await fetchFn(url, { headers, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > max) throw new Error('response too large');
  const chunks = []; let n = 0;
  for await (const c of res.body) { n += c.length; if (n > max) throw new Error('response too large'); chunks.push(c); }
  return { buf: Buffer.concat(chunks), type: (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() };
}

async function fetchImage(url, deps, { guard = true } = {}) {
  try {
    if (guard) await (deps.assertUrl ?? assertPublicHttpUrl)(url);
    const { buf, type } = await fetchBytes(url, { fetchFn: deps.fetchFn, max: 400_000 });
    if (!/^image\/(png|jpe?g|gif|webp|svg\+xml|x-icon|vnd\.microsoft\.icon)$/.test(type)) return null;
    return dataUri(type, buf);
  } catch { return null; }
}

/** Real GitHub data for a repo card. Throws a short, human-readable reason on failure. */
export async function fetchRepo(repo, deps = {}) {
  const parsed = parseRepo(repo);
  if (!parsed) throw new Error('not a valid owner/name');
  const tokenSrc = deps.token ?? config.githubToken;
  const token = typeof tokenSrc === 'function' ? tokenSrc() : tokenSrc;
  let res;
  try {
    res = await (deps.fetchFn ?? fetch)(`${deps.apiBase ?? config.githubApi}/repos/${parsed}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'instaedits', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      redirect: 'error', signal: AbortSignal.timeout(10_000),
    });
  } catch { throw new Error('could not reach GitHub (or the repo was renamed)'); }
  if (res.status === 404) throw new Error('repo not found on GitHub');
  if (res.status === 403 || res.status === 429) throw new Error('GitHub rate limit reached — set GITHUB_TOKEN in .env.local');
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const d = await res.json();
  let avatar = null;
  try {
    const host = new URL(d.owner?.avatar_url).hostname;
    if (d.owner?.avatar_url?.startsWith('https://') && /(^|\.)githubusercontent\.com$/.test(host)) avatar = await fetchImage(d.owner.avatar_url, { ...deps, assertUrl: async () => {} }, { guard: false });
  } catch { /* avatar is optional */ }
  return {
    repo: d.full_name, owner: d.owner?.login ?? parsed.split('/')[0], name: d.name,
    description: String(d.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 180),
    stars: d.stargazers_count ?? 0, forks: d.forks_count ?? 0, language: d.language ?? '',
    license: d.license?.spdx_id && d.license.spdx_id !== 'NOASSERTION' ? d.license.spdx_id : '', archived: !!d.archived, avatar,
  };
}

/** Run capture.mjs (Remotion's headless Chrome) for a list of {key,url}; returns Map key → result. */
export function runCapture(targets, outDir, { timeoutMs = config.referenceTimeoutMs * targets.length + 30_000 } = {}) {
  return new Promise((resolve) => {
    const file = path.join(outDir, 'targets.json');
    fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(targets));
    const out = new Map(); let buf = '';
    const p = spawn(process.execPath, ['capture.mjs', file, outDir], { cwd: config.remotionDir });
    const kill = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { try { const r = JSON.parse(buf.slice(0, i)); out.set(r.key, r); } catch {} buf = buf.slice(i + 1); } });
    p.on('close', () => { clearTimeout(kill); resolve(out); });
    p.on('error', () => { clearTimeout(kill); resolve(out); });
  });
}

/**
 * Fetch visuals for every Repo / Site scene. Returns { assets, status }:
 *  - assets: { repos, sites } → written to assets.json and handed to Remotion as inputProps
 *  - status: { [sceneId]: { ok, kind, ref, reason? } } → the resolver drops scenes that are not ok
 * Never throws for a single bad reference: one failure must not sink the video. Capped at config.maxReferenceCards.
 */
export async function gatherAssets({ scenes, jobDir, log = () => {}, deps = {} }) {
  const assets = { repos: {}, sites: {} }, status = {};
  const capture = deps.capture ?? runCapture;
  const refs = scenes.filter((s) => isRefKind(s.kind));
  const sitesToShoot = [];
  const max = deps.max ?? config.maxReferenceCards;
  let accepted = 0; // only VALID references use up the cap, so an invalid one can't mask the real reason for the next
  for (const s of refs) {
    let ref = '', problem = null, url = null;
    if (s.kind === 'Repo') { ref = parseRepo(s.props?.repo) ?? ''; if (!ref) { ref = String(s.props?.repo ?? ''); problem = 'not a valid owner/name'; } }
    else {
      ref = String(s.props?.url ?? '');
      try { url = await (deps.assertUrl ?? assertPublicHttpUrl)(s.props?.url); ref = url.href; } catch (e) { problem = e.message; }
    }
    if (!problem && accepted >= max) problem = `over the ${max}-reference limit`;
    if (problem) { status[s.id] = { ok: false, kind: s.kind, ref, reason: problem }; log(`⚠️ ${ref || s.kind}: ${problem}`); continue; }
    accepted++;
    if (s.kind === 'Repo') {
      try {
        assets.repos[ref] ??= await fetchRepo(ref, deps);
        status[s.id] = { ok: true, kind: 'Repo', ref, detail: `${assets.repos[ref].stars}★` };
        log(`✅ ${ref} · ${assets.repos[ref].stars}★`);
      } catch (e) { status[s.id] = { ok: false, kind: 'Repo', ref, reason: e.message }; log(`⚠️ ${ref}: ${e.message}`); }
    } else { status[s.id] = { ok: null, kind: 'Site', ref }; sitesToShoot.push({ key: s.id, url: ref, name: s.props?.name }); }
  }
  if (sitesToShoot.length) {
    log(`opening ${sitesToShoot.length} site(s) in headless Chrome…`);
    const shots = await capture(sitesToShoot.map(({ key, url }) => ({ key, url })), path.join(jobDir, 'captures'));
    for (const t of sitesToShoot) {
      const r = shots.get(t.key);
      if (!r?.ok) { status[t.key] = { ...status[t.key], ok: false, reason: r?.error ?? 'capture failed' }; log(`⚠️ ${t.url}: ${status[t.key].reason}`); continue; }
      const icon = r.icon ? await fetchImage(r.icon, deps) : null;
      const host = new URL(t.url).hostname.replace(/^www\./, '');
      assets.sites[t.url] = {
        url: t.url, domain: host, name: String(t.name ?? '').slice(0, 40) || host,
        title: String(r.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 120), description: String(r.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
        screenshot: dataUri('image/jpeg', fs.readFileSync(r.file)), icon,
      };
      status[t.key] = { ...status[t.key], ok: true, detail: host };
      log(`✅ ${host}${icon ? '' : ' (no icon)'}`);
    }
  }
  return { assets, status };
}
