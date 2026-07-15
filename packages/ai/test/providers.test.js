// providers.rip — model parsing, latest-flagship autodetect, pricing,
// cost math, usage formatting, and the informational catalog. Every
// expectation here was observed from v3 running against the same
// Bun.serve double (see test/helpers.js).
import { expect, test, describe } from 'bun:test';
import { readFileSync, statSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  HOME, providers, caught, state,
  LATEST_OPENAI, LATEST_ANTHROPIC, LOADER, PKG_DIR,
} from './helpers.js';

describe('formatUsage', () => {
  test('the README example, verbatim', () => {
    expect(providers.formatUsage({ tokens_in: 12525, tokens_out: 7290, reasoning_tokens: 3200, cached_tokens: 0, cost_usd: 0.171975 })).toEqual({
      tokens_in: 12525, tokens_out: 7290, reasoning_tokens: 3200, cached_tokens: 0, cost_usd: 0.171975,
      summary: '12,525 in · 7,290 out (3,200 reasoning + 4,090 answer) · $0.1720',
    });
  });

  test('empty usage', () => {
    expect(providers.formatUsage({}).summary).toBe('0 in · 0 out · $0.0000');
  });

  test('cached segment appears only when cached > 0; costs >= $1 use 2 decimals', () => {
    expect(providers.formatUsage({ tokens_in: 10, tokens_out: 5, cached_tokens: 4, cost_usd: 1.5 }).summary)
      .toBe('10 in · 5 out · 4 cached input · $1.50');
  });

  test('pinned wart: reasoning greater than tokens_out clamps answer to 0', () => {
    expect(providers.formatUsage({ tokens_in: 1234567, tokens_out: 89, reasoning_tokens: 100, cost_usd: 0.00009 }).summary)
      .toBe('1,234,567 in · 89 out (100 reasoning + 0 answer) · $0.0001');
  });
});

describe('pricing', () => {
  test('flagship-family ids price at the provider rate', () => {
    expect(providers.priceFor('openai:gpt-5.5')).toEqual({ input_per_million: 5, output_per_million: 15 });
    expect(providers.priceFor('openai:gpt-6')).toEqual({ input_per_million: 5, output_per_million: 15 });
    expect(providers.priceFor('anthropic:claude-opus-4-8')).toEqual({ input_per_million: 15, output_per_million: 75 });
  });

  test('non-flagship pins have unknown rates (null), never flagship-priced', () => {
    expect(providers.priceFor('openai:gpt-6-mini')).toBeNull();
    expect(providers.priceFor('anthropic:claude-sonnet-5')).toBeNull();
    expect(providers.priceFor('nope')).toBeNull();
    expect(providers.priceFor(null)).toBeNull();
  });

  test('dated snapshots: excluded from the openai family, included in the anthropic family', () => {
    expect(providers.priceFor('openai:gpt-6-20240101')).toBeNull();
    expect(providers.priceFor('anthropic:claude-opus-4-8-20260301')).toEqual({ input_per_million: 15, output_per_million: 75 });
  });

  test('computeCost applies per-million rates; unpriced ids cost 0', () => {
    expect(providers.computeCost('openai:gpt-6', 1000, 200)).toBe(0.008);
    expect(providers.computeCost('anthropic:claude-opus-4-8', 1000000, 1000000)).toBe(90);
    expect(providers.computeCost('openai:gpt-6-mini', 1000, 200)).toBe(0);
  });

  test('estimateInputTokens is chars/4, ceil', () => {
    expect(providers.estimateInputTokens('abcd'.repeat(10))).toBe(10);
    expect(providers.estimateInputTokens('')).toBe(0);
    expect(providers.estimateInputTokens('abc')).toBe(1);
  });
});

describe('parseModel', () => {
  test('aliases are case-insensitive and provider-scoped', () => {
    expect(providers.parseModel('OPUS').provider).toBe('anthropic');
    expect(providers.parseModel('gpt').provider).toBe('openai');
  });

  test('concrete provider:model passes through', () => {
    expect(providers.parseModel('openai:gpt-4o')).toEqual({ provider: 'openai', model: 'gpt-4o', id: 'openai:gpt-4o' });
  });

  test('rejections, verbatim from v3', async () => {
    expect((await caught(() => providers.parseModel('grok'))).message).toBe('unknown model: grok');
    expect((await caught(() => providers.parseModel('meta:llama'))).message).toBe('unsupported provider: meta');
    expect((await caught(() => providers.parseModel(':x'))).message).toBe('unknown model: :x');
    expect((await caught(() => providers.parseModel(''))).message).toBe('model required');
    expect((await caught(() => providers.parseModel(null))).message).toBe('model required');
  });
});

describe('latest-flagship autodetect (against the /models double)', () => {
  test('cold path without credentials resolves the SEED, with zero network', () => {
    // Subprocess: fresh HOME, no keys. ensureLatest must not fetch
    // (there is no double reachable there — a fetch would fail loudly).
    const script = `
      const providers = await import(${JSON.stringify(join(PKG_DIR, 'lib/providers.rip'))});
      const pre = providers.parseModel('gpt');
      const ensured = await providers.ensureLatest('openai');
      console.log(JSON.stringify({ pre, ensured }));
    `;
    const env = { ...process.env, HOME: mkdtempSync(join(tmpdir(), 'rip-ai-cold-')) };
    delete env.OPENAI_API_KEY;
    delete env.ANTHROPIC_API_KEY;
    const res = spawnSync(process.execPath, ['--preload', LOADER, '-e', script], { env, timeout: 30000 });
    expect(res.status).toBe(0);
    const out = JSON.parse(res.stdout.toString());
    expect(out.pre).toEqual({ provider: 'openai', model: 'gpt-5.5', id: 'openai:gpt-5.5' });
    expect(out.ensured).toBe('openai:gpt-5.5');
  });

  test('openai pick: highest clean version — mini and dated ids excluded', async () => {
    expect(await providers.ensureLatest('openai')).toBe(LATEST_OPENAI);
  });

  test('anthropic pick, pinned wart: a dated snapshot of the same version wins the tie-break', async () => {
    // claude-opus-4-8 vs claude-opus-4-8-20260301 → same version [4,8],
    // newer snapshot date wins, so "latest" is the dated id (v3 parity).
    expect(await providers.ensureLatest('claude')).toBe(LATEST_ANTHROPIC);
  });

  test('latest.json is 0600 and carries both providers', () => {
    const path = join(HOME, '.config', 'rip-ai', 'latest.json');
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const disk = JSON.parse(readFileSync(path, 'utf8'));
    expect(disk.openai.id).toBe(LATEST_OPENAI);
    expect(disk.anthropic.id).toBe(LATEST_ANTHROPIC);
    expect(disk.openai.resolved_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('after the warm, sync parseModel resolves aliases to the live pick', () => {
    expect(providers.parseModel('gpt').id).toBe(LATEST_OPENAI);
    expect(providers.parseModel('claude').id).toBe(LATEST_ANTHROPIC);
  });

  test('resolveModel: spec wins over fallback; both optional (default gpt)', async () => {
    expect((await providers.resolveModel(null, 'claude')).id).toBe(LATEST_ANTHROPIC);
    expect((await providers.resolveModel('openai:gpt-4o', 'claude')).id).toBe('openai:gpt-4o');
    expect((await providers.resolveModel(null, null)).id).toBe(LATEST_OPENAI);
  });
});

describe('listAll catalog', () => {
  test('merges providers, flags is_latest, sorts latest first, prices flagships only', async () => {
    const res = await providers.listAll({ refresh: true });
    const byId = Object.fromEntries(res.models.map((m) => [m.id, m]));
    expect(res.models.length).toBe(9);
    expect(res.models.filter((m) => m.is_latest).map((m) => m.id).sort()).toEqual([LATEST_ANTHROPIC, LATEST_OPENAI].sort());
    // latest entries sort ahead of the rest
    expect(res.models.slice(0, 2).every((m) => m.is_latest)).toBeTrue();
    expect(byId['openai:gpt-6-mini'].pricing).toBeNull();
    expect(byId[LATEST_OPENAI].pricing).toEqual({ input_per_million: 5, output_per_million: 15 });
    expect(byId['anthropic:claude-opus-4-8'].display).toBe('Claude Opus 4.8');
    expect(byId[LATEST_OPENAI].source).toBe('live');
    expect(res.cache.hit).toBeFalse();
  });

  test('second call hits the memory cache; provider filter applies', async () => {
    const hit = await providers.listAll({});
    expect(hit.cache.hit).toBeTrue();
    const filtered = await providers.listAll({ provider: 'anthropic' });
    expect(new Set(filtered.models.map((m) => m.provider))).toEqual(new Set(['anthropic']));
  });

  test('models.json disk cache is written 0600', () => {
    const path = join(HOME, '.config', 'rip-ai', 'models.json');
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});

describe('credentials + defaults', () => {
  test('defaults: chat gpt, discuss claude, synthesis gpt, fresh_review gpt', () => {
    expect(providers.defaults()).toEqual({ chat: 'gpt', discuss: 'claude', synthesis: 'gpt', fresh_review: 'gpt' });
  });

  test('credentialStatus reports availability and source', () => {
    expect(providers.credentialStatus()).toEqual({
      openai: { available: true, source: 'env' },
      anthropic: { available: true, source: 'env' },
    });
  });
});

describe('cost caps through providers.chat', () => {
  test('preflight refusal names the estimate and the cap', async () => {
    const err = await caught(() => providers.chat({ model: 'gpt', messages: [{ role: 'user', text: 'p'.repeat(4000) }], max_cost_usd: 0.000001 }));
    expect(err.message).toBe('estimated input cost $0.0050 exceeds max_cost_usd $0.0000');
    // refused preflight — no request reached the double
    expect(state.requests.filter((r) => r.path === '/openai/v1/chat/completions' && r.body?.messages?.at(-1)?.content?.startsWith?.('pppp')).length).toBe(0);
  });

  test('post-hoc overshoot succeeds and warns', async () => {
    const res = await providers.chat({ model: 'gpt', messages: [{ role: 'user', text: 'small' }], max_cost_usd: 0.0041 });
    expect(res.cost_usd).toBe(0.008);
    expect(res.warnings).toEqual(['actual cost $0.0080 exceeded cap $0.0041']);
  });
});
