// TLS material resolution and SNI matching. No certificate or key is
// committed to this repository, so the material is opaque PEM the test
// supplies as strings and the host adapters (file load, ACME, dev-CA
// generation) are injected. What is exercised here is the policy:
// precedence, the production-requires-material rule, and SNI wildcard
// matching that must never over-reach.
import { describe, expect, test } from 'bun:test';
import { certSpecificity, matchCert, orderCerts, resolveTls } from '@rip-lang/server';

const pem = (name) => ({ cert: `-----CERT ${name}-----`, key: `-----KEY ${name}-----` });

describe('certSpecificity', () => {
  test('exact names outrank wildcards outrank the default, deeper is more specific', () => {
    expect(certSpecificity('app.example.com')).toBeGreaterThan(certSpecificity('*.example.com'));
    expect(certSpecificity('*.example.com')).toBeGreaterThan(certSpecificity('*'));
    expect(certSpecificity('a.b.example.com')).toBeGreaterThan(certSpecificity('example.com'));
    expect(certSpecificity('*.a.example.com')).toBeGreaterThan(certSpecificity('*.example.com'));
    expect(certSpecificity(null)).toBe(0);
  });
});

describe('matchCert (SNI)', () => {
  const ordered = orderCerts({
    'example.com': pem('apex'),
    '*.example.com': pem('wild'),
    'api.example.com': pem('api'),
    '*': pem('default'),
  });

  test('an exact host beats the wildcard that also covers it', () => {
    expect(matchCert(ordered, 'api.example.com').cert).toBe('-----CERT api-----');
  });

  test('a wildcard covers exactly one deeper label, never the apex or two deep', () => {
    expect(matchCert(ordered, 'shop.example.com').cert).toBe('-----CERT wild-----');
    expect(matchCert(ordered, 'example.com').cert).toBe('-----CERT apex-----');
    // *.example.com must NOT match a two-level subdomain
    const noApiWild = orderCerts({ '*.example.com': pem('wild'), '*': pem('default') });
    expect(matchCert(noApiWild, 'a.b.example.com').cert).toBe('-----CERT default-----');
  });

  test('matching is case-insensitive per DNS', () => {
    expect(matchCert(ordered, 'API.Example.COM').cert).toBe('-----CERT api-----');
  });

  test('an unmatched host falls to the default, or null when there is none', () => {
    expect(matchCert(ordered, 'other.org').cert).toBe('-----CERT default-----');
    const noDefault = orderCerts({ 'example.com': pem('apex') });
    expect(matchCert(noDefault, 'other.org')).toBeNull();
  });

  test('an entry missing its cert or key is dropped, never a half-formed pair', () => {
    const dropped = orderCerts({ 'a.com': { cert: 'C' }, 'b.com': null, 'c.com': pem('good') });
    expect(dropped.map(e => e.serverName)).toEqual(['c.com']);
    expect(matchCert(dropped, 'a.com')).toBeNull();
  });

  test('a hostname with a port or trailing dot is normalized before matching', () => {
    expect(matchCert(ordered, 'api.example.com:8443').cert).toBe('-----CERT api-----');
    expect(matchCert(ordered, 'api.example.com.').cert).toBe('-----CERT api-----');
  });
});

describe('resolveTls precedence and policy', () => {
  const adapters = (overrides = {}) => ({
    load: path => ({ cert: `CERT@${path}`, key: `KEY@${path}` }),
    acme: domain => ({ cert: `ACME-CERT ${domain}`, key: `ACME-KEY ${domain}` }),
    devCert: host => ({ cert: `DEV-CERT ${host}`, key: `DEV-KEY ${host}` }),
    ...overrides,
  });

  test('an explicit cert and key win over everything', () => {
    const tls = resolveTls({ certPath: '/etc/cert.pem', keyPath: '/etc/key.pem', acme: { domain: 'x.com' } }, adapters());
    expect(tls.mode).toBe('explicit');
    expect(tls.material.cert).toBe('CERT@/etc/cert.pem');
    expect(tls.material.key).toBe('KEY@/etc/key.pem');
  });

  test('inline cert and key strings are used verbatim', () => {
    const tls = resolveTls({ cert: 'INLINE-CERT', key: 'INLINE-KEY' }, adapters());
    expect(tls.mode).toBe('explicit');
    expect(tls.material.cert).toBe('INLINE-CERT');
  });

  test('ACME is used when no explicit material is given', () => {
    const tls = resolveTls({ acme: { domain: 'app.example.com' } }, adapters());
    expect(tls.mode).toBe('acme');
    expect(tls.material.cert).toBe('ACME-CERT app.example.com');
  });

  test('the dev CA is the last resort, and only outside production', () => {
    const tls = resolveTls({ dev: true, host: 'localhost' }, adapters());
    expect(tls.mode).toBe('dev');
    expect(tls.material.cert).toBe('DEV-CERT localhost');
  });

  test('production without real material is a startup failure — never a dev cert, never plaintext', () => {
    expect(() => resolveTls({ production: true }, adapters())).toThrow(/production/i);
    expect(() => resolveTls({ production: true, dev: true }, adapters())).toThrow(/production/i);
    // ACME in production is fine
    expect(resolveTls({ production: true, acme: { domain: 'x.com' } }, adapters()).mode).toBe('acme');
  });

  test('an explicit path that fails to load rejects loudly, naming the path', () => {
    const failing = adapters({ load: () => { throw new Error('ENOENT'); } });
    expect(() => resolveTls({ certPath: '/missing.pem', keyPath: '/missing.key' }, failing))
      .toThrow(/\/missing\.pem/);
  });

  test('an SNI cert map resolves each host and orders by specificity', () => {
    const tls = resolveTls({
      cert: 'DEFAULT-CERT', key: 'DEFAULT-KEY',
      certs: { 'api.example.com': { certPath: '/a.pem', keyPath: '/a.key' } },
    }, adapters());
    expect(tls.serverNames).toContain('api.example.com');
    expect(matchCert(tls.sni, 'api.example.com').cert).toBe('CERT@/a.pem');
    expect(matchCert(tls.sni, 'anything.else').cert).toBe('DEFAULT-CERT');
  });

  test('no material and not production yields a plaintext verdict, not a throw', () => {
    const tls = resolveTls({}, adapters());
    expect(tls.mode).toBe('none');
    expect(tls.material).toBeNull();
    // A null opts is treated as empty, not a crash.
    expect(resolveTls(null, adapters()).mode).toBe('none');
  });

  test('SNI-only config is TLS, never a silent plaintext verdict', () => {
    const tls = resolveTls({ certs: { 'api.example.com': { cert: 'C', key: 'K' } } }, adapters());
    expect(tls.mode).toBe('explicit');
    expect(matchCert(tls.sni, 'api.example.com').cert).toBe('C');
    // ...and in production, an SNI-only server is accepted (real material terminates).
    expect(resolveTls({ production: true, certs: { 'api.example.com': { cert: 'C', key: 'K' } } }, adapters()).mode).toBe('explicit');
  });

  test('malformed config fails loudly instead of crashing or degrading', () => {
    expect(() => resolveTls({ certs: { 'a.com': null } }, adapters())).toThrow(/no usable certificate/);
    expect(() => resolveTls({ certs: 'nope' }, adapters())).toThrow(/certs must be an object/);
    expect(() => resolveTls({ acme: { domain: '' } }, adapters())).toThrow(/acme requires a domain/);
    expect(() => resolveTls({ acme: {} }, adapters())).toThrow(/acme requires a domain/);
  });

  test('a failing key path is named in the error, not the cert path', () => {
    const failing = adapters({ load: p => { if (p.endsWith('.key')) throw new Error('ENOENT'); return { cert: 'C' }; } });
    expect(() => resolveTls({ certPath: '/c.pem', keyPath: '/k.key' }, failing)).toThrow(/\/k\.key/);
  });
});
