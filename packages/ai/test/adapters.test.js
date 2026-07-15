// openai.rip / anthropic.rip — HTTP shape and response normalization,
// exercised end-to-end against the Bun.serve double. Request bodies and
// error strings are pinned verbatim from v3 on the same fixtures.
import { expect, test, describe } from 'bun:test';
import { openai, anthropic, state, caught, OPENAI_KEY, ANTHROPIC_KEY } from './helpers.js';

describe('openai adapter', () => {
  test('request shape: bearer auth, system message, role/text mapping, max_completion_tokens', async () => {
    state.requests.length = 0;
    const res = await openai.chat({
      model: 'gpt-6',
      system: 'be terse',
      messages: [{ role: 'user', text: 'hello' }, { role: 'assistant', text: 'hi' }, { role: 'user', text: 'again' }],
      attachments: [],
      max_tokens: 111,
    });
    const req = state.requests.at(-1);
    expect(req.path).toBe('/openai/v1/chat/completions');
    expect(req.headers.authorization).toBe(`Bearer ${OPENAI_KEY}`);
    expect(req.headers['content-type']).toBe('application/json');
    expect(req.body).toEqual({
      model: 'gpt-6',
      messages: [
        { role: 'system', content: 'be terse' },
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
        { role: 'user', content: 'again' },
      ],
      max_completion_tokens: 111,
    });
    expect(res.text).toBe('openai-echo:5');
    expect(res.tokens_in).toBe(1000);
    expect(res.tokens_out).toBe(200);
    expect(res.reasoning_tokens).toBe(50);
    expect(res.cached_tokens).toBe(10);
    expect(res.finish_reason).toBe('stop');
  });

  test('empty-output guard: reasoning eating the whole budget raises an actionable error', async () => {
    state.openaiNext.push({ body: { choices: [{ message: { content: '' }, finish_reason: 'length' }], usage: { prompt_tokens: 10, completion_tokens: 500, completion_tokens_details: { reasoning_tokens: 500 } } } });
    const err = await caught(() => openai.chat({ model: 'gpt-6', messages: [{ role: 'user', text: 'x' }] }));
    expect(err.message).toBe('OpenAI returned no visible output: hit the token limit — 500 reasoning tokens consumed the entire budget. Reasoning models count hidden reasoning against max_tokens — raise it substantially or omit it to use the model default.');
  });

  test('error body and HTTP error surface as provider-tagged messages', async () => {
    state.openaiNext.push({ body: { error: { message: 'boom nothing-secret' } } });
    expect((await caught(() => openai.chat({ model: 'gpt-6', messages: [{ role: 'user', text: 'x' }] }))).message).toBe('OpenAI: boom nothing-secret');
    state.openaiNext.push({ status: 500, body: {} });
    expect((await caught(() => openai.chat({ model: 'gpt-6', messages: [{ role: 'user', text: 'x' }] }))).message).toBe('OpenAI returned HTTP 500');
  });

  test('listModels normalizes ids and created timestamps', async () => {
    const rows = await openai.listModels();
    expect(rows.map((r) => r.id)).toEqual(['openai:gpt-4o', 'openai:gpt-5.5', 'openai:gpt-6', 'openai:gpt-6-mini', 'openai:gpt-6-20240101']);
    expect(rows[0].provider_model).toBe('gpt-4o');
    expect(rows[0].created_at).toBe(new Date(1700000000 * 1000).toISOString());
  });
});

describe('anthropic adapter', () => {
  test('request shape: x-api-key + anthropic-version, system hoisted top-level, non-assistant roles become user, max_tokens defaults to 4096', async () => {
    state.requests.length = 0;
    const res = await anthropic.chat({
      model: 'claude-opus-4-8',
      system: 'top-level system',
      messages: [{ role: 'system', text: 'inline system' }, { role: 'user', text: 'hello' }, { role: 'review', text: 'weird role' }],
      attachments: [],
    });
    const req = state.requests.at(-1);
    expect(req.path).toBe('/anthropic/v1/messages');
    expect(req.headers['x-api-key']).toBe(ANTHROPIC_KEY);
    expect(req.headers.authorization).toBeNull();
    expect(req.headers['anthropic-version']).toBe('2023-06-01');
    expect(req.body).toEqual({
      model: 'claude-opus-4-8',
      max_tokens: 4096,
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        { role: 'user', content: [{ type: 'text', text: 'weird role' }] },
      ],
      system: 'top-level system\n\ninline system',
    });
    // text blocks concatenate; anthropic folds thinking into output tokens
    expect(res.text).toBe('anthropic-echo-2');
    expect(res.tokens_in).toBe(800);
    expect(res.tokens_out).toBe(150);
    expect(res.reasoning_tokens).toBe(0);
    expect(res.cached_tokens).toBe(5);
    expect(res.finish_reason).toBe('end_turn');
  });

  test('error body and HTTP error surface as provider-tagged messages', async () => {
    state.anthropicNext.push({ body: { error: { message: 'anthropic boom' } } });
    expect((await caught(() => anthropic.chat({ model: 'claude-opus-4-8', messages: [{ role: 'user', text: 'x' }] }))).message).toBe('Anthropic: anthropic boom');
    state.anthropicNext.push({ status: 529, body: {} });
    expect((await caught(() => anthropic.chat({ model: 'claude-opus-4-8', messages: [{ role: 'user', text: 'x' }] }))).message).toBe('Anthropic returned HTTP 529');
  });

  test('listModels normalizes ids and display names', async () => {
    const rows = await anthropic.listModels();
    expect(rows.map((r) => r.id)).toEqual([
      'anthropic:claude-opus-4-20250514',
      'anthropic:claude-opus-4-8',
      'anthropic:claude-sonnet-5',
      'anthropic:claude-opus-4-8-20260301',
    ]);
    expect(rows[1].raw.display_name).toBe('Claude Opus 4.8');
  });
});
