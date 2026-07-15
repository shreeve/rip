// tools.rip — the eleven MCP tool handlers, driven directly with a real
// store and the provider double. Model ids resolve against the double's
// catalogs (openai:gpt-6 / anthropic:claude-opus-4-8-20260301); every
// pinned value was observed from v3 on the same fixtures.
import { expect, test, describe, beforeAll } from 'bun:test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  HOME, tools, providers, state, store, ctx, caught,
  LATEST_OPENAI, LATEST_ANTHROPIC,
} from './helpers.js';

const fixturesDir = join(HOME, 'tool-fixtures');
mkdirSync(fixturesDir, { recursive: true });

beforeAll(async () => {
  // Deterministic model resolution for every test below.
  await providers.ensureLatest('openai');
  await providers.ensureLatest('claude');
});

describe('status', () => {
  test('reports server info, credential availability, defaults, counts', () => {
    const res = tools.status(ctx);
    expect(res.server.name).toBe('rip-ai');
    expect(res.server.version).toBe('1.1.0');
    expect(res.server.db_path).toBe(store.dbPath);
    expect(res.credentials).toEqual({
      openai: { available: true, source: 'env' },
      anthropic: { available: true, source: 'env' },
    });
    expect(res.defaults).toEqual({ chat: 'gpt', discuss: 'claude', synthesis: 'gpt', fresh_review: 'gpt' });
    expect(typeof res.conversations.conversations).toBe('number');
  });
});

describe('list_models', () => {
  test('provider filter and is_latest flag', async () => {
    const res = await tools.list_models(ctx, { provider: 'openai', refresh: true });
    expect(new Set(res.models.map((m) => m.provider))).toEqual(new Set(['openai']));
    expect(res.models.filter((m) => m.is_latest).map((m) => m.id)).toEqual([LATEST_OPENAI]);
  });
});

describe('chat', () => {
  test('defaults to gpt, formats usage, no persistence', async () => {
    const before = store.counts().conversations;
    const res = await tools.chat(ctx, { prompt: 'What is 2+2?', system: 'be terse' });
    expect(res.model).toBe(LATEST_OPENAI);
    expect(res.text).toBe('openai-echo:12');
    expect(res.usage).toEqual({
      tokens_in: 1000, tokens_out: 200, reasoning_tokens: 50, cached_tokens: 10, cost_usd: 0.008,
      summary: '1,000 in · 200 out (50 reasoning + 150 answer) · 10 cached input · $0.0080',
    });
    expect(res.warnings).toEqual([]);
    expect(store.counts().conversations).toBe(before); // chat never persists
  });

  test('missing prompt raises; preflight cost cap refuses before dispatch', async () => {
    expect((await caught(() => tools.chat(ctx, {}))).message).toBe("missing 'prompt'");
    expect((await caught(() => tools.chat(ctx, { prompt: 'p'.repeat(4000), max_cost_usd: 0.000001 }))).message)
      .toBe('estimated input cost $0.0050 exceeds max_cost_usd $0.0000');
  });

  test('post-hoc cap overshoot succeeds with a warning', async () => {
    const res = await tools.chat(ctx, { prompt: 'small', max_cost_usd: 0.0041 });
    expect(res.warnings).toEqual(['actual cost $0.0080 exceeded cap $0.0041']);
  });
});

describe('discuss', () => {
  test('full lifecycle: create, persist, continue with history, detect changed attachments', async () => {
    const samplePath = join(fixturesDir, 'sample.md');
    writeFileSync(samplePath, '# sample\n\nversion one\n');

    // turn 1 — creates the conversation, defaults to claude, seeds the system prompt
    state.requests.length = 0;
    const d1 = await tools.discuss(ctx, { message: 'first turn', attachments: [{ type: 'file', path: samplePath }] });
    expect(d1.conversation_id).toMatch(/^c_[0-9a-f]{16}$/);
    expect(d1.model).toBe(LATEST_ANTHROPIC);
    expect(d1.text).toBe('anthropic-echo-2');
    expect(d1.changed_attachments).toEqual([]);
    expect(d1.usage.summary).toBe('800 in · 150 out · 5 cached input · $0.0232');
    expect(d1.conversation_usage.summary).toBe('800 in · 150 out · $0.0232');
    const turn1 = state.requests.at(-1);
    expect(turn1.body.system).toContain('You are a senior software engineer');
    expect(turn1.body.messages.at(-1).content[1].text).toContain('<attachment name="sample.md"');

    // turn 2 — file changed on disk: history replayed, peer told the hash change
    // (v3 crashed on this exact path — the declared divergence in this port)
    writeFileSync(samplePath, '# sample\n\nversion two\n');
    state.requests.length = 0;
    const d2 = await tools.discuss(ctx, { conversation_id: d1.conversation_id, message: 'second turn', attachments: [{ type: 'file', path: samplePath }] });
    expect(d2.conversation_id).toBe(d1.conversation_id);
    expect(d2.changed_attachments).toEqual([{
      name: 'sample.md', source: samplePath,
      prev_sha256: d1.attachments[0].sha256, sha256: d2.attachments[0].sha256,
    }]);
    expect(d2.attachments[0].changed_since_last_view).toBeTrue();
    expect(d2.conversation_usage.summary).toBe('1,600 in · 300 out · $0.0465');

    const turn2 = state.requests.at(-1);
    const roles = turn2.body.messages.map((m) => m.role);
    expect(roles).toEqual(['user', 'assistant', 'user']); // history replayed, system hoisted
    const lastBlocks = turn2.body.messages.at(-1).content;
    expect(lastBlocks[0].text).toBe('second turn');
    expect(lastBlocks[1].text).toContain('Attached files changed since your last view:');
    expect(lastBlocks[1].text).toContain(`- sample.md: ${d1.attachments[0].sha256.slice(0, 12)}… → ${d2.attachments[0].sha256.slice(0, 12)}…`);
    expect(lastBlocks[1].text).toContain('version two');

    // transcript: system + 2 user + 2 assistant, usage on assistant rows
    const msgs = store.listMessages(d1.conversation_id);
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user', 'assistant']);
    expect(msgs.at(-1).metadata.changed_attachments.length).toBe(1);

    store.deleteConversation(d1.conversation_id);
  });

  test('independence labels warn on matching attachments', async () => {
    const samplePath = join(fixturesDir, 'sample.md');
    const res = await tools.discuss(ctx, { message: 'indep', independent_of: ['sample'], attachments: [{ type: 'file', path: samplePath }] });
    expect(res.warnings).toEqual(["artifact 'sample.md' may break independence from 'sample'"]);
    store.deleteConversation(res.conversation_id);
  });

  test('missing message raises', async () => {
    expect((await caught(() => tools.discuss(ctx, {}))).message).toBe("missing 'message'");
  });
});

describe('panel', () => {
  test('one member failing does not fail the panel; failure appears in responses and warnings', async () => {
    state.openaiNext.push({ body: { error: { message: 'openai down' } } });
    const res = await tools.panel(ctx, { prompt: 'panel q', models: ['gpt', 'claude'], synthesize: true });
    expect(res.responses.map((r) => r.ok)).toEqual([false, true]);
    expect(res.responses[0].model).toBe('gpt'); // failed spec keeps the raw alias
    expect(res.responses[0].error).toBe('OpenAI: openai down');
    expect(res.responses[1].model).toBe(LATEST_ANTHROPIC);
    expect(res.synthesis).toBeNull(); // synthesis needs >1 successes
    expect(res.warnings).toEqual(['gpt: OpenAI: openai down']);
    expect(res.usage.summary).toBe('800 in · 150 out · 5 cached input · $0.0232');
  });

  test('all members failing raises', async () => {
    state.openaiNext.push({ body: { error: { message: 'openai down' } } });
    state.anthropicNext.push({ body: { error: { message: 'anthropic down' } } });
    expect((await caught(() => tools.panel(ctx, { prompt: 'panel q', models: ['gpt', 'claude'] }))).message).toBe('all panelists failed');
  });

  test('synthesis runs over successes and is included in the summed usage', async () => {
    const res = await tools.panel(ctx, { prompt: 'panel q', models: ['gpt', 'claude'], synthesize: true });
    expect(res.synthesis.model).toBe(LATEST_OPENAI);
    expect(res.usage).toEqual({
      tokens_in: 2800, tokens_out: 550, reasoning_tokens: 100, cached_tokens: 25, cost_usd: 0.03925,
      summary: '2,800 in · 550 out (100 reasoning + 450 answer) · 25 cached input · $0.0393',
    });
  });

  test('empty models raises', async () => {
    expect((await caught(() => tools.panel(ctx, { prompt: 'x', models: [] }))).message).toBe("panel requires 'models' (non-empty array)");
  });
});

describe('fresh_review', () => {
  test('explicitly requested model in exclude_models fails fast', async () => {
    const samplePath = join(fixturesDir, 'sample.md');
    expect((await caught(() => tools.fresh_review(ctx, { artifact: samplePath, model: 'gpt', exclude_models: ['gpt'] }))).message)
      .toBe(`requested model '${LATEST_OPENAI}' is in exclude_models`);
  });

  test('without a model, picks the first credentialed default not excluded', async () => {
    const samplePath = join(fixturesDir, 'sample.md');
    state.requests.length = 0;
    const res = await tools.fresh_review(ctx, { artifact: samplePath, exclude_models: ['gpt'] });
    expect(res.model).toBe(LATEST_ANTHROPIC);
    expect(res.excluded_models).toEqual([LATEST_OPENAI]);
    expect(res.warnings).toEqual([`excluded: ${LATEST_OPENAI}`]);
    expect(state.requests.at(-1).path).toBe('/anthropic/v1/messages');
  });

  test('everything excluded raises with the resolved exclusion list', async () => {
    const samplePath = join(fixturesDir, 'sample.md');
    expect((await caught(() => tools.fresh_review(ctx, { artifact: samplePath, exclude_models: ['gpt', 'claude'] }))).message)
      .toBe(`no available model after exclusions: ${LATEST_OPENAI}, ${LATEST_ANTHROPIC}`);
  });
});

describe('conversation management', () => {
  const seedConversation = async () => {
    const samplePath = join(fixturesDir, 'seed.md');
    writeFileSync(samplePath, 'seed body\n');
    const d = await tools.discuss(ctx, { message: 'seed turn', attachments: [{ type: 'file', path: samplePath }] });
    return d.conversation_id;
  };

  test('list / get shapes; attachments trimmed unless include_attachments', async () => {
    const id = await seedConversation();
    const listed = await tools.list_conversations(ctx, { limit: 100 });
    const row = listed.conversations.find((c) => c.id === id);
    expect(Object.keys(row).sort()).toEqual([
      'created_at', 'default_model', 'id', 'independent_of', 'redacted_at',
      'title', 'total_cost_usd', 'total_tokens_in', 'total_tokens_out', 'updated_at',
    ]);

    const got = await tools.get_conversation(ctx, { conversation_id: id });
    expect(got.conversation.id).toBe(id);
    const attRefs = got.messages.find((m) => m.role === 'user').attachments;
    expect(Object.keys(attRefs[0]).sort()).toEqual(['bytes', 'id', 'kind', 'name', 'sha256']);

    const full = await tools.get_conversation(ctx, { conversation_id: id, include_attachments: true });
    const fullRefs = full.messages.find((m) => m.role === 'user').attachments;
    expect(Object.keys(fullRefs[0]).sort()).toEqual(['binary', 'bytes', 'changed_since_last_view', 'id', 'kind', 'mime', 'name', 'sha256', 'source']);
    store.deleteConversation(id);
  });

  test('export json and markdown', async () => {
    const id = await seedConversation();
    const asJson = await tools.export_conversation(ctx, { conversation_id: id, format: 'json' });
    expect(asJson.format).toBe('json');
    const parsed = JSON.parse(asJson.content);
    expect(parsed.conversation.id).toBe(id);
    expect(parsed.messages.length).toBe(3);

    const asMd = await tools.export_conversation(ctx, { conversation_id: id, format: 'markdown' });
    expect(asMd.content).toContain(`# Conversation ${id}`);
    expect(asMd.content).toContain('## User — seq 2\nseed turn');
    expect(asMd.content).toContain(`## Assistant (${LATEST_ANTHROPIC}) — seq 3`);
    expect(asMd.content).toContain('_Attachments: seed.md_');

    expect((await caught(() => tools.export_conversation(ctx, { conversation_id: id, format: 'xml' }))).message)
      .toBe("format must be 'json' or 'markdown'");
    store.deleteConversation(id);
  });

  test('redact content then all; bad modes and missing ids raise', async () => {
    const id = await seedConversation();
    const red = await tools.redact(ctx, { conversation_id: id, mode: 'content' });
    expect(red).toEqual({ redacted: true, mode: 'content', conversation_id: id });
    expect(store.listMessages(id).every((m) => m.text === '[redacted]')).toBeTrue();
    await tools.redact(ctx, { conversation_id: id, mode: 'all' });
    expect(store.listMessages(id)).toEqual([]);
    expect((await caught(() => tools.redact(ctx, { conversation_id: id, mode: 'nuke' }))).message).toBe("mode must be 'content' or 'all'");

    const del = await tools.delete_conversation(ctx, { conversation_id: id });
    expect(del).toEqual({ deleted: true, conversation_id: id });
    expect((await caught(() => tools.delete_conversation(ctx, { conversation_id: id }))).message).toBe(`conversation not found: ${id}`);
    expect((await caught(() => tools.get_conversation(ctx, { conversation_id: id }))).message).toBe(`conversation not found: ${id}`);
  });
});
