import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildArgs, MODELS } from '../server/claude.mjs';

const has = (a, flag, val) => { const i = a.indexOf(flag); assert.ok(i >= 0, `${flag} missing`); if (val !== undefined) assert.equal(a[i + 1], val); };

test('models are the Claude 5.5 family', () => {
  assert.deepEqual(MODELS, { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5' }); // Haiku is gone: no model drives the editor any more
});

test('every call is minimal: no skills, no session, strict MCP, budget cap, explicit tools', () => {
  const a = buildArgs({ model: MODELS.opus });
  has(a, '-p'); has(a, '--model', MODELS.opus); has(a, '--disable-slash-commands'); has(a, '--no-session-persistence');
  has(a, '--strict-mcp-config'); has(a, '--tools', ''); has(a, '--max-budget-usd', '1'); has(a, '--mcp-config', '{"mcpServers":{}}');
  has(a, '--output-format', 'stream-json');
});

test('optional flags appear only when requested', () => {
  const none = buildArgs({ model: 'm' });
  for (const f of ['--allowedTools', '--append-system-prompt', '--json-schema', '--effort']) assert.ok(!none.includes(f), f);
  const all = buildArgs({ model: 'm', allowed: 'mcp__x', system: 'sys', schema: { a: 1 }, effort: 'low', budget: 2.5, tools: 'Read', mcpConfig: '{"x":1}' });
  has(all, '--allowedTools', 'mcp__x'); has(all, '--append-system-prompt', 'sys'); has(all, '--json-schema', '{"a":1}');
  has(all, '--effort', 'low'); has(all, '--max-budget-usd', '2.5'); has(all, '--tools', 'Read'); has(all, '--mcp-config', '{"x":1}');
});
