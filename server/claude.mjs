import { spawn } from 'node:child_process';
import fs from 'node:fs';

export const MODELS = {
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-5-5',
};

const NO_MCP = '{"mcpServers":{}}';

/**
 * Run `claude -p` headlessly with a minimal footprint (no skills, no user settings, only the tools/MCP we pass).
 * Returns { text, structured, cost, tokens }.
 */
export function runClaude({ model, prompt, system, tools = '', allowed, mcpConfig, cwd, budget = 1, schema, effort, onEvent, signal }) {
  const args = [
    '-p', '--model', model,
    '--output-format', 'stream-json', '--verbose',
    '--no-session-persistence', '--disable-slash-commands',
    '--setting-sources', 'local',
    '--strict-mcp-config', '--mcp-config', mcpConfig || NO_MCP,
    '--tools', tools,
    '--max-budget-usd', String(budget),
    '--permission-mode', 'acceptEdits',
  ];
  if (allowed) args.push('--allowedTools', allowed);
  if (system) args.push('--append-system-prompt', system);
  if (schema) args.push('--json-schema', JSON.stringify(schema));
  if (effort) args.push('--effort', effort);

  return new Promise((resolve, reject) => {
    const p = spawn('claude', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], signal });
    let buf = '', err = '', final = null;
    p.stdin.end(prompt);
    p.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === 'assistant') {
          for (const b of ev.message?.content ?? []) {
            if (b.type === 'tool_use') onEvent?.(`🔧 ${b.name.replace('mcp__metapilot-native__', '')} ${JSON.stringify(b.input).slice(0, 90)}`);
            else if (b.type === 'text' && b.text.trim()) onEvent?.(`💬 ${b.text.trim().slice(0, 140)}`);
          }
        } else if (ev.type === 'result') final = ev;
      }
    });
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => {
      if (!final) return reject(new Error(`claude exited ${code}: ${err.slice(-400)}`));
      if (final.is_error) return reject(new Error(`claude error: ${String(final.result).slice(0, 400)}`));
      const u = final.usage || {};
      resolve({
        text: final.result ?? '',
        structured: final.structured_output,
        cost: final.total_cost_usd ?? 0,
        tokens: { in: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0), out: u.output_tokens || 0 },
      });
    });
  });
}

export const writeJson = (f, o) => fs.writeFileSync(f, JSON.stringify(o, null, 2));
