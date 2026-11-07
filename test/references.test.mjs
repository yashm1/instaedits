import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseRepo, fetchBytes, fetchRepo, gatherAssets, isRefKind } from '../server/references.mjs';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const img = (buf = PNG, type = 'image/png') => new Response(buf, { status: 200, headers: { 'content-type': type } });
const ghBody = (over = {}) => ({ full_name: 'apache/kafka', name: 'kafka', description: '  Mirror of\n Apache Kafka  ', stargazers_count: 31000, forks_count: 14000, language: 'Java', license: { spdx_id: 'Apache-2.0' }, archived: false, owner: { login: 'apache', avatar_url: 'https://avatars.githubusercontent.com/u/47359?v=4' }, ...over });
const routed = (routes) => async (url, opts) => { const hit = Object.entries(routes).find(([k]) => String(url).includes(k)); if (!hit) throw new Error('unexpected fetch ' + url); return typeof hit[1] === 'function' ? hit[1](url, opts) : hit[1]; };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ie-ref-'));

test('parseRepo accepts owner/name and github.com URLs; rejects anything that could smuggle a path, query or host', () => {
  assert.equal(parseRepo('apache/kafka'), 'apache/kafka');
  assert.equal(parseRepo('  remotion-dev/remotion '), 'remotion-dev/remotion');
  assert.equal(parseRepo('https://github.com/apache/kafka'), 'apache/kafka');
  assert.equal(parseRepo('https://github.com/apache/kafka.git'), 'apache/kafka');
  assert.equal(parseRepo('https://github.com/apache/kafka/'), 'apache/kafka');
  assert.equal(parseRepo('facebook/react.js'), 'facebook/react.js');
  for (const bad of ['kafka', 'a/b/c', '../x', 'a/..', 'a/.', '/a/b', 'a b/c', 'a/b?x=1', 'a/b#h', 'a/b;rm', 'a\\b/c', 'http://github.com/a/b', 'https://evil.com/a/b', 'https://github.com/a', '', null, undefined, 5, '-a/b', 'a/' + 'x'.repeat(101), 'x'.repeat(40) + '/y'])
    assert.equal(parseRepo(bad), null, String(bad));
});

test('isRefKind', () => { assert.ok(isRefKind('Repo') && isRefKind('Site')); assert.ok(!isRefKind('Hook') && !isRefKind('repo')); });

test('fetchBytes: returns bytes + content type; enforces status, content-length and streamed size caps', async () => {
  const r = await fetchBytes('https://x/a.png', { fetchFn: async () => img() });
  assert.deepEqual(r.buf, PNG); assert.equal(r.type, 'image/png');
  await assert.rejects(() => fetchBytes('https://x', { fetchFn: async () => new Response('no', { status: 500 }) }), /HTTP 500/);
  await assert.rejects(() => fetchBytes('https://x', { max: 10, fetchFn: async () => new Response('x'.repeat(5), { headers: { 'content-length': '999999' } }) }), /too large/);
  await assert.rejects(() => fetchBytes('https://x', { max: 10, fetchFn: async () => new Response('x'.repeat(50)) }), /too large/, 'no content-length: the stream itself is capped');
});

test('fetchRepo: maps GitHub data, cleans text, embeds the avatar, sends UA + optional token', async () => {
  let seen;
  const fetchFn = routed({ '/repos/apache/kafka': (u, o) => { seen = { u, h: o.headers }; return json(ghBody()); }, avatars: () => img() });
  const d = await fetchRepo('apache/kafka', { fetchFn, apiBase: 'https://api.test', token: 'ghp_x' });
  assert.equal(seen.u, 'https://api.test/repos/apache/kafka');
  assert.equal(seen.h['User-Agent'], 'instaedits'); assert.equal(seen.h.Authorization, 'Bearer ghp_x');
  assert.deepEqual({ ...d, avatar: !!d.avatar }, { repo: 'apache/kafka', owner: 'apache', name: 'kafka', description: 'Mirror of Apache Kafka', stars: 31000, forks: 14000, language: 'Java', license: 'Apache-2.0', archived: false, avatar: true });
  assert.match(d.avatar, /^data:image\/png;base64,/);
  await fetchRepo('apache/kafka', { fetchFn: routed({ '/repos/': (u, o) => { assert.ok(!('Authorization' in o.headers), 'no token → no auth header'); return json(ghBody({ owner: { login: 'apache' } })); } }), apiBase: 'https://api.test', token: undefined });
});

test('fetchRepo: NOASSERTION licence is blank, long descriptions are trimmed, avatar failure is non-fatal', async () => {
  const d = await fetchRepo('a/b', { apiBase: 'https://api.test', fetchFn: routed({ '/repos/': json(ghBody({ license: { spdx_id: 'NOASSERTION' }, description: 'x'.repeat(500) })), avatars: new Response('nope', { status: 500 }) }) });
  assert.equal(d.license, ''); assert.equal(d.description.length, 180); assert.equal(d.avatar, null);
});

test('fetchRepo: the avatar is only fetched from *.githubusercontent.com over https', async () => {
  let avatarFetches = 0;
  const fetchFn = routed({ '/repos/': json(ghBody({ owner: { login: 'x', avatar_url: 'https://evil.example.com/a.png' } })), 'evil.example.com': () => { avatarFetches++; return img(); } });
  const d = await fetchRepo('a/b', { apiBase: 'https://api.test', fetchFn });
  assert.equal(d.avatar, null); assert.equal(avatarFetches, 0);
  const d2 = await fetchRepo('a/b', { apiBase: 'https://api.test', fetchFn: routed({ '/repos/': json(ghBody({ owner: { login: 'x', avatar_url: 'http://avatars.githubusercontent.com/a.png' } })) }) });
  assert.equal(d2.avatar, null, 'http is refused');
});

test('fetchRepo: clear reasons for 404, rate limit (with the fix), other errors, network failure and bad input', async () => {
  const f = (status) => ({ apiBase: 'https://api.test', fetchFn: async () => new Response('{}', { status }) });
  await assert.rejects(() => fetchRepo('a/b', f(404)), /repo not found on GitHub/);
  await assert.rejects(() => fetchRepo('a/b', f(403)), /rate limit.*GITHUB_TOKEN/);
  await assert.rejects(() => fetchRepo('a/b', f(429)), /rate limit/);
  await assert.rejects(() => fetchRepo('a/b', f(500)), /GitHub API 500/);
  await assert.rejects(() => fetchRepo('a/b', { apiBase: 'https://api.test', fetchFn: async () => { throw new TypeError('fetch failed'); } }), /could not reach GitHub/);
  await assert.rejects(() => fetchRepo('../x', { fetchFn: async () => { throw new Error('must not be called'); } }), /valid owner\/name/);
});

// ───────── gatherAssets ─────────
const scene = (id, kind, props) => ({ id, kind, props, anchor: 'x', dur: 3 });
const okCapture = (dir) => async (targets) => new Map(targets.map((t) => { const file = path.join(dir, `${t.key}.jpg`); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, 'JPEGDATA'); return [t.key, { key: t.key, ok: true, file, title: ' Apache Kafka ', description: 'A distributed\n event streaming platform', icon: 'https://kafka.apache.org/favicon.png' }]; }));
const publicOnly = async (u) => { const x = new URL(u); if (x.protocol !== 'https:' || /^(127\.|10\.|localhost)/.test(x.hostname)) throw new Error('private or reserved address'); return x; };

test('gatherAssets: repos and sites succeed together; assets carry data URIs, status carries ok + detail', async () => {
  const dir = tmp(); const logs = [];
  const { assets, status } = await gatherAssets({ jobDir: dir, log: (m) => logs.push(m), scenes: [scene('a1', 'Hook', {}), scene('a2', 'Repo', { repo: 'apache/kafka' }), scene('a3', 'Site', { url: 'https://kafka.apache.org', name: 'Kafka' })],
    deps: { apiBase: 'https://api.test', assertUrl: publicOnly, capture: okCapture(path.join(dir, 'captures')), fetchFn: routed({ '/repos/': json(ghBody()), avatars: img(), 'favicon.png': img() }) } });
  assert.equal(status.a2.ok, true); assert.equal(status.a2.detail, '31000★'); assert.equal(status.a3.ok, true); assert.equal(status.a3.detail, 'kafka.apache.org');
  assert.ok(!('a1' in status), 'non-reference scenes are ignored');
  assert.equal(assets.repos['apache/kafka'].stars, 31000);
  const site = assets.sites['https://kafka.apache.org/'];
  assert.equal(site.name, 'Kafka'); assert.equal(site.domain, 'kafka.apache.org'); assert.equal(site.title, 'Apache Kafka'); assert.equal(site.description, 'A distributed event streaming platform');
  assert.match(site.screenshot, /^data:image\/jpeg;base64,/); assert.match(site.icon, /^data:image\/png;base64,/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gatherAssets: one failing reference never sinks the others; reasons are recorded', async () => {
  const dir = tmp();
  const { assets, status } = await gatherAssets({ jobDir: dir, scenes: [scene('a1', 'Repo', { repo: 'ghost/nothing' }), scene('a2', 'Repo', { repo: 'apache/kafka' }), scene('a3', 'Site', { url: 'https://down.example.com' })],
    deps: { apiBase: 'https://api.test', assertUrl: publicOnly, capture: async (t) => new Map(t.map((x) => [x.key, { key: x.key, ok: false, error: 'navigation timed out' }])), fetchFn: routed({ '/repos/ghost/nothing': new Response('{}', { status: 404 }), '/repos/apache/kafka': json(ghBody()), avatars: img() }) } });
  assert.equal(status.a1.ok, false); assert.match(status.a1.reason, /not found/);
  assert.equal(status.a2.ok, true);
  assert.equal(status.a3.ok, false); assert.equal(status.a3.reason, 'navigation timed out');
  assert.deepEqual(Object.keys(assets.repos), ['apache/kafka']); assert.deepEqual(assets.sites, {});
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gatherAssets: private/loopback/non-https URLs never reach the browser, and the reason is the guard\'s', async () => {
  const dir = tmp(); let captured = 0;
  const { status } = await gatherAssets({ jobDir: dir, scenes: [scene('a1', 'Site', { url: 'https://127.0.0.1:19501/mcp' }), scene('a2', 'Site', { url: 'http://insecure.example.com' }), scene('a3', 'Site', { url: 'https://localhost' })],
    deps: { assertUrl: publicOnly, capture: async () => { captured++; return new Map(); } } });
  assert.equal(captured, 0, 'capture must not even be invoked');
  for (const id of ['a1', 'a2', 'a3']) { assert.equal(status[id].ok, false); assert.match(status[id].reason, /private|reserved|https/); }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gatherAssets: invalid repo strings are rejected without any network call', async () => {
  const dir = tmp();
  const { status } = await gatherAssets({ jobDir: dir, scenes: [scene('a1', 'Repo', { repo: 'a/b?x=1' }), scene('a2', 'Repo', {})], deps: { fetchFn: async () => { throw new Error('network must not be touched'); } } });
  assert.equal(status.a1.ok, false); assert.equal(status.a2.ok, false);
  assert.match(status.a1.reason, /valid owner\/name/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gatherAssets: duplicate repo is fetched once; references beyond the cap are refused up front', async () => {
  const dir = tmp(); let apiCalls = 0;
  const fetchFn = routed({ '/repos/': () => { apiCalls++; return json(ghBody()); }, avatars: img() });
  const { status } = await gatherAssets({ jobDir: dir, scenes: [scene('a1', 'Repo', { repo: 'apache/kafka' }), scene('a2', 'Repo', { repo: 'apache/kafka' }), scene('a3', 'Repo', { repo: 'o/three' }), scene('a4', 'Repo', { repo: 'o/four' })], deps: { apiBase: 'https://api.test', fetchFn, max: 3 } });
  assert.equal(apiCalls, 2, 'kafka once + o/three once');
  assert.equal(status.a1.ok && status.a2.ok && status.a3.ok, true);
  assert.equal(status.a4.ok, false); assert.match(status.a4.reason, /3-reference limit/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gatherAssets: an icon URL pointing at a private address is ignored (the card still works without an icon)', async () => {
  const dir = tmp(); let iconFetched = false;
  const capture = async (targets) => new Map(targets.map((t) => { const file = path.join(dir, `${t.key}.jpg`); fs.writeFileSync(file, 'J'); return [t.key, { key: t.key, ok: true, file, title: 't', description: '', icon: 'https://127.0.0.1/secret.png' }]; }));
  const { assets, status } = await gatherAssets({ jobDir: dir, scenes: [scene('a1', 'Site', { url: 'https://kafka.apache.org' })], deps: { assertUrl: publicOnly, capture, fetchFn: async () => { iconFetched = true; return img(); } } });
  assert.equal(status.a1.ok, true); assert.equal(assets.sites['https://kafka.apache.org/'].icon, null); assert.equal(iconFetched, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gatherAssets with no reference scenes returns empty assets and calls nothing', async () => {
  const r = await gatherAssets({ jobDir: tmp(), scenes: [scene('a1', 'Hook', {})], deps: { fetchFn: async () => { throw new Error('no'); }, capture: async () => { throw new Error('no'); } } });
  assert.deepEqual(r, { assets: { repos: {}, sites: {} }, status: {} });
});

test('gatherAssets: invalid references do not use up the cap, and keep their own reason (not "over the limit")', async () => {
  const dir = tmp();
  const { status } = await gatherAssets({ jobDir: dir, scenes: [scene('a1', 'Repo', { repo: 'bad repo' }), scene('a2', 'Site', { url: 'https://127.0.0.1/x' }), scene('a3', 'Repo', { repo: 'o/one' }), scene('a4', 'Repo', { repo: 'o/two' }), scene('a5', 'Repo', { repo: 'o/three' }), scene('a6', 'Repo', { repo: 'o/four' })],
    deps: { apiBase: 'https://api.test', assertUrl: publicOnly, max: 3, fetchFn: routed({ '/repos/': () => json(ghBody()), avatars: () => img() }) } });
  assert.match(status.a1.reason, /valid owner\/name/); assert.match(status.a2.reason, /private|reserved/);
  assert.deepEqual(['a3', 'a4', 'a5'].map((id) => status[id].ok), [true, true, true]);
  assert.match(status.a6.reason, /3-reference limit/);
  fs.rmSync(dir, { recursive: true, force: true });
});
