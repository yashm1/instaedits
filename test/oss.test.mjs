import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const read = (f) => fs.readFileSync(f, 'utf8');
const tracked = () => execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean).filter((f) => fs.existsSync(f));
const pkg = JSON.parse(read('package.json'));

test('MIT license present, matches package.json, and points to third-party terms', () => {
  assert.match(read('LICENSE'), /^MIT License/);
  assert.equal(pkg.license, 'MIT');
  assert.match(read('LICENSE'), /THIRD_PARTY\.md/);
});

test('THIRD_PARTY.md discloses Remotion\'s own license and the unofficial Edits integration', () => {
  const t = read('THIRD_PARTY.md');
  assert.match(t, /Remotion/); assert.match(t, /Company License/); assert.match(t, /3 employees/); assert.match(t, /unofficial/i);
  assert.match(read('README.md'), /Remotion[^\n]*own license/i, 'README must warn about Remotion licensing');
});

test('package.json has discoverability metadata', () => {
  assert.ok(pkg.description.length > 60 && /Reels/i.test(pkg.description));
  assert.ok(pkg.keywords.length >= 8);
  for (const k of ['remotion', 'instagram-reels', 'claude', 'mcp']) assert.ok(pkg.keywords.includes(k), k);
  assert.match(pkg.repository.url, /github\.com\/yashm1\/instaedits/);
  assert.ok(pkg.bugs.url && pkg.homepage);
  assert.equal(pkg.private, true, 'keep private:true so it is never accidentally published to npm');
});

test('community & policy files exist', () => {
  for (const f of ['CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md', '.github/PULL_REQUEST_TEMPLATE.md', '.github/ISSUE_TEMPLATE/bug_report.md', '.github/ISSUE_TEMPLATE/feature_request.md', '.github/workflows/test.yml', '.env.example', 'docs/architecture.md', 'docs/research.md', 'docs/assets/social-preview.png', 'docs/assets/cards.png'])
    assert.ok(fs.existsSync(f), f);
});

test('every relative link/image in the README resolves to a real file', () => {
  const md = read('README.md');
  const links = [...md.matchAll(/(?:\]\(|src=")(?!https?:|#|mailto:)([^)"#\s]+)/g)].map((m) => m[1]);
  assert.ok(links.length >= 8);
  for (const l of links) assert.ok(fs.existsSync(l), `README links to missing file: ${l}`);
});

test('README has the sections a newcomer needs, and is honest about status', () => {
  const md = read('README.md');
  for (const h of ['## Prerequisites', '## Quick start', '## Configuration', '## Status & limitations', '## Security', '## FAQ', '## Third-party licences', '## License'])
    assert.ok(md.includes(h), h);
  assert.match(md, /status: beta/); assert.match(md, /Edits app only, macOS only/);
});

test('no secrets, tokens or personal absolute paths in tracked files', () => {
  const bad = [/gh[pousr]_[A-Za-z0-9]{20,}/, /sk-[A-Za-z0-9]{20,}/, /\/Users\/(?!you\b)[a-z]/i, /METAPILOT_TOKEN=\S{8,}/, /[\w.+-]+@gmail\.com/];
  for (const f of tracked().filter((x) => !/\.(png|lock)$|package-lock/.test(x) && !x.startsWith('test/oss.test'))) {
    const t = read(f);
    for (const re of bad) assert.doesNotMatch(t, re, `${f} matches ${re}`);
  }
});

test('local-only and generated files are never tracked', () => {
  const files = tracked();
  for (const f of files) {
    assert.ok(!/(^|\/)\.env\.local$/.test(f), f);
    assert.ok(!f.startsWith('jobs/') && !f.includes('node_modules/') && f !== 'remotion/src/Scenes.tsx', f);
  }
  const ig = read('.gitignore');
  for (const p of ['.env.local', 'jobs/', 'node_modules/', 'remotion/src/Scenes.tsx']) assert.ok(ig.includes(p), p);
});

test('images are small enough for a repo (<1 MB each)', () => {
  for (const f of fs.readdirSync('docs/assets')) assert.ok(fs.statSync(path.join('docs/assets', f)).size < 1_000_000, f);
});
