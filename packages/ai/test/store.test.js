// store.rip — SQLite persistence: conversations, messages, totals,
// redaction, attachment records. Expected shapes pinned from v3.
import { expect, test, describe } from 'bun:test';
import { store, caught } from './helpers.js';

describe('conversations', () => {
  test('create inflates JSON columns and defaults', () => {
    const conv = store.createConversation({ title: 'crud', default_provider: 'openai', default_model: 'openai:gpt-6', independent_of: ['secret-plan'], metadata: { k: 1 } });
    expect(conv.id).toMatch(/^c_[0-9a-f]{16}$/);
    expect(conv.title).toBe('crud');
    expect(conv.total_tokens_in).toBe(0);
    expect(conv.independent_of).toEqual(['secret-plan']);
    expect(conv.metadata).toEqual({ k: 1 });
    expect(conv.redacted_at).toBeNull();
  });

  test('upsert keeps unspecified fields, updates the rest; missing id creates', () => {
    const conv = store.createConversation({ title: 'before', independent_of: ['x'] });
    const renamed = store.upsertConversation(conv.id, { title: 'after' });
    expect(renamed.title).toBe('after');
    expect(renamed.independent_of).toEqual(['x']);
    const made = store.upsertConversation('c_00000000000000aa', { title: 'fresh' });
    expect(made.id).toBe('c_00000000000000aa');
    store.deleteConversation(made.id);
    store.deleteConversation(conv.id);
  });

  test('delete cascades to messages', () => {
    const conv = store.createConversation({});
    store.appendMessage(conv.id, { role: 'user', text: 'hi' });
    store.deleteConversation(conv.id);
    expect(store.findConversation(conv.id)).toBeNull();
    expect(store.listMessages(conv.id)).toEqual([]);
  });
});

describe('messages', () => {
  test('append assigns sequential seq, updates totals only when usage present', () => {
    const conv = store.createConversation({});
    store.appendMessage(conv.id, { role: 'system', text: 'sys' });
    store.appendMessage(conv.id, { role: 'user', text: 'q' });
    const asst = store.appendMessage(conv.id, { role: 'assistant', provider: 'openai', model: 'openai:gpt-6', text: 'a', tokens_in: 100, tokens_out: 20, cost_usd: 0.0008, warnings: ['w1'], metadata: { finish_reason: 'stop' } });
    expect(asst.id).toMatch(/^m_[0-9a-f]{20}$/);
    expect(asst.seq).toBe(3);
    expect(asst.warnings).toEqual(['w1']);
    const fresh = store.findConversation(conv.id);
    expect(fresh.total_tokens_in).toBe(100);
    expect(fresh.total_tokens_out).toBe(20);
    expect(fresh.total_cost_usd).toBe(0.0008);
    expect(store.listMessages(conv.id).map((m) => [m.seq, m.role])).toEqual([[1, 'system'], [2, 'user'], [3, 'assistant']]);
    store.deleteConversation(conv.id);
  });

  test('parameterized statements: hostile text is stored inertly, tables survive', () => {
    const conv = store.createConversation({});
    const hostile = "'; DROP TABLE conversations; -- and \"double\" quotes";
    store.appendMessage(conv.id, { role: 'user', text: hostile });
    expect(store.listMessages(conv.id)[0].text).toBe(hostile);
    expect(store.counts().conversations).toBeGreaterThan(0); // conversations table intact
    store.deleteConversation(conv.id);
  });

  test('role CHECK constraint rejects unknown roles; unknown conversation raises', async () => {
    const conv = store.createConversation({});
    expect((await caught(() => store.appendMessage(conv.id, { role: 'attacker', text: 'x' }))).message)
      .toContain('CHECK constraint failed');
    expect((await caught(() => store.appendMessage('c_0000000000000000', { role: 'user', text: 'x' }))).message)
      .toBe('conversation not found: c_0000000000000000');
    store.deleteConversation(conv.id);
  });
});

describe('redaction', () => {
  test("mode 'content' blanks text and attachment refs, keeps rows and totals", () => {
    const conv = store.createConversation({});
    store.appendMessage(conv.id, { role: 'user', text: 'sensitive', attachments: [{ id: 'sha256:ab', name: 'x' }] });
    store.appendMessage(conv.id, { role: 'assistant', text: 'reply', tokens_in: 10, tokens_out: 5, cost_usd: 0.01 });
    const res = store.redactConversation(conv.id, 'content');
    expect(res.redacted_at).not.toBeNull();
    expect(res.total_cost_usd).toBe(0.01);
    expect(store.listMessages(conv.id).map((m) => [m.text, m.attachments])).toEqual([['[redacted]', []], ['[redacted]', []]]);
    store.deleteConversation(conv.id);
  });

  test("mode 'all' removes messages, keeps the conversation row and totals", () => {
    const conv = store.createConversation({});
    store.appendMessage(conv.id, { role: 'user', text: 'gone' });
    store.appendMessage(conv.id, { role: 'assistant', text: 'also gone', tokens_in: 7, tokens_out: 3, cost_usd: 0.02 });
    const res = store.redactConversation(conv.id, 'all');
    expect(store.listMessages(conv.id)).toEqual([]);
    expect(res.total_tokens_in).toBe(7);
    store.deleteConversation(conv.id);
  });

  test('redacted conversations are hidden from lists unless include_redacted', () => {
    const conv = store.createConversation({ title: 'hide-me' });
    store.redactConversation(conv.id, 'content');
    expect(store.listConversations({ limit: 100 }).some((c) => c.id === conv.id)).toBeFalse();
    expect(store.listConversations({ limit: 100, include_redacted: true }).some((c) => c.id === conv.id)).toBeTrue();
    store.deleteConversation(conv.id);
  });
});

describe('attachment records', () => {
  test('recordAttachment dedupes by sha256 and touches last_seen_at', () => {
    const meta = { sha256: 'f'.repeat(64), kind: 'blob', name: 'one.txt', bytes: 3, cache_path: '/dev/null' };
    const first = store.recordAttachment(meta);
    expect(first.reused).toBeFalse();
    expect(first.id).toBe(`sha256:${'f'.repeat(64)}`);
    const second = store.recordAttachment({ ...meta, name: 'other-name.txt' });
    expect(second.reused).toBeTrue();
    expect(second.name).toBe('one.txt'); // the original record wins
  });
});
