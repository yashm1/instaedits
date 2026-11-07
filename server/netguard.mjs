// SSRF guard. A model suggests URLs and we fetch/screenshot them from YOUR machine, where the Edits app's MCP server
// (127.0.0.1:19501), routers and cloud-metadata endpoints live. Only public, https, default-port hosts pass.
import dns from 'node:dns/promises';
import net from 'node:net';

/** IPv4 in a non-public range? (loopback, private, link-local/metadata, CGNAT, multicast, reserved, 0.0.0.0/8) */
export function isPrivateIPv4(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true; // malformed → block
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 0) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) ||
    a >= 224;
}

/** Only global-unicast IPv6 (2000::/3) passes; IPv4-mapped addresses are judged by their IPv4 part. */
export function isPrivateIPv6(ip) {
  const lower = ip.toLowerCase().split('%')[0];
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) { const n = (parseInt(mappedHex[1], 16) << 16) | parseInt(mappedHex[2], 16); return isPrivateIPv4([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')); }
  const first = parseInt(lower.split(':')[0] || '0', 16);
  return !(first >= 0x2000 && first <= 0x3fff);
}

export const isPrivateIp = (ip) => (net.isIPv4(ip) ? isPrivateIPv4(ip) : net.isIPv6(ip) ? isPrivateIPv6(ip) : true);

/**
 * Validate a URL: https, no credentials, default port, a real multi-label public hostname, and every address it resolves to is public.
 * Returns the parsed URL. `lookup` is injectable for tests; `allowPrivate` is for tests only and never set by the app.
 */
export async function assertPublicHttpUrl(input, { lookup = (h) => dns.lookup(h, { all: true }), allowPrivate = false } = {}) {
  let u;
  try { u = new URL(String(input)); } catch { throw new Error('invalid URL'); }
  if (u.protocol !== 'https:') throw new Error('only https URLs are allowed');
  if (u.username || u.password) throw new Error('URLs with credentials are not allowed');
  if (u.port && u.port !== '443') throw new Error('non-standard ports are not allowed');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!allowPrivate) {
    if (net.isIP(host)) { if (isPrivateIp(host)) throw new Error('private or reserved address'); return u; }
    if (!host.includes('.') || /\.(local|localhost|internal|lan|home|corp|intranet)$/.test(host) || host === 'localhost') throw new Error('not a public hostname');
  }
  let addrs;
  try { addrs = await lookup(host); } catch { throw new Error('hostname does not resolve'); }
  const list = (Array.isArray(addrs) ? addrs : [addrs]).map((a) => (typeof a === 'string' ? a : a.address));
  if (!list.length) throw new Error('hostname does not resolve');
  if (!allowPrivate && list.some(isPrivateIp)) throw new Error('hostname resolves to a private or reserved address');
  return u;
}
