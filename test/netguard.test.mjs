import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicHttpUrl, isPrivateIPv4, isPrivateIPv6, isPrivateIp } from '../server/netguard.mjs';

const pub = () => [{ address: '93.184.216.34', family: 4 }];
const ok = (u, opts = {}) => assertPublicHttpUrl(u, { lookup: pub, ...opts });
const bad = (u, re, opts = {}) => assert.rejects(() => ok(u, opts), re, u);

test('private/reserved IPv4 ranges are blocked, public ones pass', () => {
  for (const ip of ['127.0.0.1', '127.255.255.254', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '224.0.0.1', '255.255.255.255', '192.0.0.1', '198.18.0.1'])
    assert.equal(isPrivateIPv4(ip), true, ip);
  for (const ip of ['8.8.8.8', '93.184.216.34', '172.15.255.255', '172.32.0.1', '1.1.1.1', '100.63.255.255', '100.128.0.1']) assert.equal(isPrivateIPv4(ip), false, ip);
  for (const ip of ['1.2.3', '256.1.1.1', 'a.b.c.d', '']) assert.equal(isPrivateIPv4(ip), true, `malformed ${ip} must be blocked`);
});

test('IPv6: only global unicast passes; loopback, ULA, link-local and mapped-private are blocked', () => {
  for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe']) assert.equal(isPrivateIPv6(ip), true, ip);
  for (const ip of ['2001:4860:4860::8888', '2606:4700:4700::1111', '::ffff:8.8.8.8']) assert.equal(isPrivateIPv6(ip), false, ip);
  assert.equal(isPrivateIp('not-an-ip'), true);
});

test('only https URLs with a public hostname on the default port pass', async () => {
  const u = await ok('https://kafka.apache.org/documentation'); assert.equal(u.hostname, 'kafka.apache.org');
  await ok('https://example.com:443/x');
  await bad('http://example.com', /only https/);
  await bad('ftp://example.com', /only https/);
  await bad('file:///etc/passwd', /only https/);
  await bad('javascript:alert(1)', /only https/);
  await bad('not a url', /invalid URL/);
  await bad('https://user:pw@example.com', /credentials/);
  await bad('https://example.com:8443', /ports/);
  await bad('https://example.com:80', /ports/);
});

test('loopback, metadata, private literals and internal-looking names are rejected before any DNS lookup', async () => {
  let lookups = 0; const lookup = async () => { lookups++; return pub(); };
  for (const u of ['https://127.0.0.1', 'https://127.0.0.1:19501/mcp', 'https://localhost', 'https://169.254.169.254/latest/meta-data', 'https://10.0.0.5', 'https://192.168.0.1', 'https://[::1]', 'https://[fd00::1]', 'https://intranet', 'https://printer.local', 'https://db.internal', 'https://router.lan'])
    await assert.rejects(() => assertPublicHttpUrl(u, { lookup }), /private|public hostname|ports/, u);
  assert.equal(lookups, 0, 'rejected without resolving');
});

test('a public-looking name that RESOLVES to a private address is rejected (DNS rebinding / split-horizon)', async () => {
  await bad('https://evil.example.com', /resolves to a private/, { lookup: async () => [{ address: '127.0.0.1' }] });
  await bad('https://evil.example.com', /resolves to a private/, { lookup: async () => [{ address: '8.8.8.8' }, { address: '10.0.0.1' }] }); // ANY private address blocks
  await bad('https://evil.example.com', /resolves to a private/, { lookup: async () => [{ address: '::ffff:169.254.169.254' }] });
  await bad('https://nx.example.com', /does not resolve/, { lookup: async () => { throw new Error('ENOTFOUND'); } });
  await bad('https://empty.example.com', /does not resolve/, { lookup: async () => [] });
});

test('allowPrivate is an explicit test-only switch (default off)', async () => {
  await assert.rejects(() => assertPublicHttpUrl('https://127.0.0.1'), /private/);
  const u = await assertPublicHttpUrl('https://127.0.0.1', { allowPrivate: true, lookup: async () => [{ address: '127.0.0.1' }] });
  assert.equal(u.hostname, '127.0.0.1');
});
