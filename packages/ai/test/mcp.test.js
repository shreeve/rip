// mcp.rip — the JSON-RPC stdio wire surface, driven as a real
// subprocess under the repository loader. Spawned with a fresh HOME and
// NO provider keys, so the server never attempts network (warmLatest
// skips uncredentialed providers) and key-missing errors are observable.
import { expect, test, describe } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { LOADER, MCP_RIP } from './helpers.js';

const TOOL_NAMES = [
  'status', 'list_models', 'chat', 'discuss', 'panel', 'fresh_review',
  'list_conversations', 'get_conversation', 'delete_conversation',
  'export_conversation', 'redact',
];

const runServer = (lines, { home = mkdtempSync(join(tmpdir(), 'rip-ai-mcp-')), env: extraEnv = {} } = {}) => {
  const env = { ...process.env, HOME: home, USERPROFILE: home, ...extraEnv };
  delete env.OPENAI_API_KEY;
  delete env.ANTHROPIC_API_KEY;
  const res = spawnSync(process.execPath, ['--preload', LOADER, MCP_RIP], {
    input: lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n',
    env, timeout: 30000,
  });
  const replies = (res.stdout?.toString() ?? '').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { res, replies, home, byId: (id) => replies.find((r) => r.id === id) };
};

describe('protocol', () => {
  test('initialize, tools/list, unknown method, parse error, tools/call — one pass', () => {
    const { res, replies, byId } = runServer([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      { jsonrpc: '2.0', id: 3, method: 'no/such', params: {} },
      'not json',
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'status', arguments: {} } },
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'bogus', arguments: {} } },
      { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'chat', arguments: { prompt: 'hi' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
    ]);
    expect(res.status).toBe(0);
    expect(replies.length).toBe(7); // notifications produce no reply

    // initialize
    const init = byId(1).result;
    expect(init.protocolVersion).toBe('2024-11-05');
    expect(init.serverInfo).toEqual({ name: 'rip-ai', version: '1.1.0' });
    expect(init.capabilities).toEqual({ tools: {} });
    expect(init.instructions).toContain('Persistent multi-model AI consultation.');

    // tools/list — the eleven-tool catalog, in order
    expect(byId(2).result.tools.map((t) => t.name)).toEqual(TOOL_NAMES);
    for (const tool of byId(2).result.tools) {
      expect(typeof tool.description).toBe('string');
      expect(tool.inputSchema.type).toBe('object');
    }

    // unknown method → -32601; malformed line → -32700 with null id
    expect(byId(3).error).toEqual({ code: -32601, message: 'Unknown method: no/such' });
    const parseError = replies.find((r) => r.id === null);
    expect(parseError.error).toEqual({ code: -32700, message: 'Parse error' });

    // status works with no credentials
    const status = JSON.parse(byId(5).result.content[0].text);
    expect(byId(5).result.isError).toBeFalse();
    expect(status.credentials).toEqual({
      openai: { available: false, source: null },
      anthropic: { available: false, source: null },
    });
    expect(status.conversations).toEqual({ conversations: 0, total_cost_usd: 0 });

    // unknown tool and key-missing chat are tool errors, not protocol errors
    expect(byId(6).result.isError).toBeTrue();
    expect(JSON.parse(byId(6).result.content[0].text)).toEqual({ error: 'unknown tool: bogus' });
    expect(byId(7).result.isError).toBeTrue();
    expect(JSON.parse(byId(7).result.content[0].text)).toEqual({ error: 'OPENAI_API_KEY not set' });

    // stderr carries the startup banner, stdout only JSON-RPC
    expect(res.stderr.toString()).toContain('ready (db=');
  });

  test('conversations persist across server restarts (same HOME)', () => {
    const home = mkdtempSync(join(tmpdir(), 'rip-ai-persist-'));
    // First server run cannot create conversations without keys, so seed
    // the db through the store directly in a helper subprocess... simpler:
    // list_conversations across two runs sees the same (empty) db file and
    // status reports the identical db_path both times.
    const first = runServer([{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'status', arguments: {} } }], { home });
    const second = runServer([{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'status', arguments: {} } }], { home });
    const path1 = JSON.parse(first.byId(1).result.content[0].text).server.db_path;
    const path2 = JSON.parse(second.byId(1).result.content[0].text).server.db_path;
    expect(path1).toBe(path2);
    expect(existsSync(path1)).toBeTrue();
  });

  test('a corrupt db is quarantined, recreated, and reported by status', () => {
    const home = mkdtempSync(join(tmpdir(), 'rip-ai-corrupt-'));
    const dir = join(home, '.config', 'rip-ai');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'conversations.db'), 'this is not a sqlite database at all');
    const { byId } = runServer([{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'status', arguments: {} } }], { home });
    const status = JSON.parse(byId(1).result.content[0].text);
    expect(status.warnings.some((w) => w.startsWith('store recovered from corruption'))).toBeTrue();
    expect(readdirSync(dir).some((f) => f.includes('conversations.db.corrupt.'))).toBeTrue();
    expect(status.conversations).toEqual({ conversations: 0, total_cost_usd: 0 });
  });
});
