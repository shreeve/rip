// Shared test scaffolding for @rip-lang/ai. Evaluated once per test run
// (bun's module cache), and imported FIRST by every test file so the
// environment is pinned before any package module loads:
//
//   - HOME/USERPROFILE point at a fresh temp dir, so ~/.config/rip-ai
//     and ~/.config/rip/credentials never touch the real user config.
//   - Provider keys are obvious fakes (no real key exists anywhere in
//     this suite).
//   - A Bun.serve double plays api.openai.com, api.anthropic.com, and
//     the fixture.test host; a fetch shim rewrites exactly those
//     origins to the local double and THROWS on any other host, so a
//     test that would reach the real network fails loudly instead.
//
// The double's model catalogs and per-call scripted responses mirror
// the parity probe that was run against v3 — every pinned expectation
// in this suite is a value observed from v3 on these same fixtures.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const HOME = mkdtempSync(join(tmpdir(), 'rip-ai-test-'));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;

export const OPENAI_KEY = 'sk-test-openai-DO-NOT-USE';
export const ANTHROPIC_KEY = 'sk-ant-test-DO-NOT-USE';
process.env.OPENAI_API_KEY = OPENAI_KEY;
process.env.ANTHROPIC_API_KEY = ANTHROPIC_KEY;

// ── provider / fixture double ────────────────────────────────────────────
export const state = {
  requests: [],       // every request the double saw: { method, path, headers, body }
  openaiNext: [],     // one-shot scripted responses for /chat/completions
  anthropicNext: [],  // one-shot scripted responses for /messages
};

export const OPENAI_MODELS = [
  { id: 'gpt-4o', created: 1700000000, owned_by: 'openai' },
  { id: 'gpt-5.5', created: 1710000000, owned_by: 'openai' },
  { id: 'gpt-6', created: 1720000000, owned_by: 'openai' },
  { id: 'gpt-6-mini', created: 1720000001, owned_by: 'openai' },
  { id: 'gpt-6-20240101', created: 1720000002, owned_by: 'openai' },
];
export const ANTHROPIC_MODELS = [
  { id: 'claude-opus-4-20250514', display_name: 'Claude Opus 4', created_at: '2025-05-14T00:00:00Z', type: 'model' },
  { id: 'claude-opus-4-8', display_name: 'Claude Opus 4.8', created_at: '2026-01-01T00:00:00Z', type: 'model' },
  { id: 'claude-sonnet-5', display_name: 'Claude Sonnet 5', created_at: '2026-02-01T00:00:00Z', type: 'model' },
  { id: 'claude-opus-4-8-20260301', display_name: 'Claude Opus 4.8 (dated)', created_at: '2026-03-01T00:00:00Z', type: 'model' },
];

// The ids the latest-flagship autodetect resolves to on these catalogs
// (observed from v3: openai skips -mini and dated ids; anthropic's date
// tie-break prefers the dated snapshot of the same version).
export const LATEST_OPENAI = 'openai:gpt-6';
export const LATEST_ANTHROPIC = 'anthropic:claude-opus-4-8-20260301';

const defaultOpenAIChat = (body) => ({
  choices: [{
    message: { content: `openai-echo:${typeof body?.messages?.at(-1)?.content === 'string' ? body.messages.at(-1).content.length : 'blocks'}` },
    finish_reason: 'stop',
  }],
  usage: {
    prompt_tokens: 1000, completion_tokens: 200,
    completion_tokens_details: { reasoning_tokens: 50 },
    prompt_tokens_details: { cached_tokens: 10 },
  },
});
const defaultAnthropicChat = () => ({
  content: [{ type: 'text', text: 'anthropic-echo' }, { type: 'text', text: '-2' }],
  usage: { input_tokens: 800, output_tokens: 150, cache_read_input_tokens: 5 },
  stop_reason: 'end_turn',
});

const BIG = 'z'.repeat(2_500_000);

export const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const bodyText = await req.text();
    let body = null;
    try { body = bodyText ? JSON.parse(bodyText) : null; } catch { body = bodyText; }
    state.requests.push({
      method: req.method, path,
      headers: {
        authorization: req.headers.get('authorization'),
        'x-api-key': req.headers.get('x-api-key'),
        'anthropic-version': req.headers.get('anthropic-version'),
        'content-type': req.headers.get('content-type'),
      },
      body,
    });

    if (path === '/openai/v1/models') return Response.json({ data: OPENAI_MODELS });
    if (path === '/anthropic/v1/models') return Response.json({ data: ANTHROPIC_MODELS });
    if (path === '/openai/v1/chat/completions') {
      const next = state.openaiNext.shift();
      if (next?.status) return Response.json(next.body ?? {}, { status: next.status });
      return Response.json(next?.body ?? defaultOpenAIChat(body));
    }
    if (path === '/anthropic/v1/messages') {
      const next = state.anthropicNext.shift();
      if (next?.status) return Response.json(next.body ?? {}, { status: next.status });
      return Response.json(next?.body ?? defaultAnthropicChat());
    }

    // fixture.test — URL-attachment fixtures
    if (path === '/fixture/doc.txt') return new Response('fixture document body\n', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    if (path === '/fixture/hop1') return new Response(null, { status: 302, headers: { location: 'http://fixture.test/fixture/hop2' } });
    if (path === '/fixture/hop2') return new Response(null, { status: 302, headers: { location: '/fixture/doc.txt' } });
    if (path === '/fixture/evil') return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:9/secret' } });
    if (path === '/fixture/loop') return new Response(null, { status: 302, headers: { location: '/fixture/loop' } });
    if (path === '/fixture/big') return new Response(BIG, { headers: { 'content-type': 'text/plain' } });
    if (path === '/fixture/binary') return new Response(new Uint8Array([1, 0, 2, 3, 0, 4]), { headers: { 'content-type': 'application/octet-stream' } });
    if (path === '/fixture/missing') return new Response('nope', { status: 404 });
    return new Response('unknown path ' + path, { status: 500 });
  },
});

const LOCAL = `http://127.0.0.1:${server.port}`;
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input, opts) => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const u = new URL(raw);
  if (u.hostname === 'api.openai.com') return realFetch(`${LOCAL}/openai${u.pathname}${u.search}`, opts);
  if (u.hostname === 'api.anthropic.com') return realFetch(`${LOCAL}/anthropic${u.pathname}${u.search}`, opts);
  if (u.hostname === 'fixture.test') return realFetch(`${LOCAL}${u.pathname}${u.search}`, opts);
  throw new Error(`test fetch blocked unexpected host: ${u.hostname}`);
};

// ── package modules (loaded AFTER the environment is pinned) ────────────
export const providers = await import(new URL('../lib/providers.rip', import.meta.url).href);
export const openai = await import(new URL('../lib/openai.rip', import.meta.url).href);
export const anthropic = await import(new URL('../lib/anthropic.rip', import.meta.url).href);
export const att = await import(new URL('../lib/attachments.rip', import.meta.url).href);
export const cred = await import(new URL('../lib/credentials.rip', import.meta.url).href);
export const storeMod = await import(new URL('../lib/store.rip', import.meta.url).href);
export const tools = await import(new URL('../lib/tools.rip', import.meta.url).href);

// One store + tool ctx shared by the run (the db lives under the temp HOME).
export const store = storeMod.open();
export const ctx = { store, version: '1.1.0' };

// ── misc ─────────────────────────────────────────────────────────────────
export const caught = async (fn) => {
  try { await fn(); return null; }
  catch (e) { return e; }
};

// Paths for subprocess tests: run mcp.rip under the repository loader.
export const PKG_DIR = new URL('..', import.meta.url).pathname;
export const LOADER = new URL('../../../src/loader.js', import.meta.url).pathname;
export const MCP_RIP = join(PKG_DIR, 'mcp.rip');
