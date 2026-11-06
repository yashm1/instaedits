// Minimal MCP (streamable-HTTP) client for the local Edits app. Zero LLM tokens: deterministic calls from Node.
import { config } from './config.mjs';

export const EDITS_URL = config.editsUrl;
export const editsAuthHeaders = () => (config.editsToken() ? { Authorization: `Bearer ${config.editsToken()}` } : {});
const URL_ = EDITS_URL;
let sid = null, rid = 1;

async function rpc(method, params, notify = false) {
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...editsAuthHeaders(), ...(sid ? { 'mcp-session-id': sid } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', ...(notify ? {} : { id: rid++ }), method, params }),
  });
  if (res.status === 403 || res.status === 401) throw new Error('Edits rejected the request: set METAPILOT_TOKEN in .env.local (Edits → Settings → Automation → Access token)');
  sid = res.headers.get('mcp-session-id') || sid;
  if (notify) return null;
  const text = await res.text();
  const line = res.headers.get('content-type')?.includes('event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).pop()?.slice(5) : text;
  const msg = JSON.parse(line);
  if (msg.error) throw new Error(`${method}: ${msg.error.message}`);
  return msg.result;
}

export async function connect() {
  if (sid) return;
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'instaedits', version: '0.1' } });
  await rpc('notifications/initialized', {}, true);
}

/** Call an Edits tool; returns parsed JSON when the tool returns JSON text. */
export async function tool(name, args = {}) {
  await connect();
  const r = await rpc('tools/call', { name, arguments: args });
  const text = r.content?.map((c) => c.text).join('') ?? '';
  if (r.isError) throw new Error(`${name}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { return text; }
}
