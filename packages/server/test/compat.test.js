// nginx and Caddy configuration generation: deterministic output from
// a normalized site config, and — the load-bearing property — no
// config value can inject a directive. A hostile host, proxy target,
// or static root is rejected rather than written into the file.
import { describe, expect, test } from 'bun:test';
import { generateCaddy, generateNginx } from '@rip-lang/server';

const site = (over = {}) => ({
  host: 'app.example.com',
  routes: [
    { path: '/api', proxy: 'http://127.0.0.1:3000' },
    { path: '/', static: '/var/www/app', spa: true },
  ],
  ...over,
});

describe('generateNginx', () => {
  test('emits a server block with proxy and static locations', () => {
    const conf = generateNginx({ sites: [site()] });
    expect(conf).toContain('server_name app.example.com;');
    expect(conf).toContain('location /api');
    expect(conf).toContain('proxy_pass http://127.0.0.1:3000;');
    expect(conf).toContain('root /var/www/app;');
    expect(conf).toContain('try_files $uri /index.html;'); // spa fallback
  });

  test('a TLS site listens on 443 with the cert paths and redirects HTTP', () => {
    const conf = generateNginx({ sites: [site({ tls: { certPath: '/ssl/app.crt', keyPath: '/ssl/app.key' } })] });
    expect(conf).toContain('listen 443 ssl;');
    expect(conf).toContain('ssl_certificate /ssl/app.crt;');
    expect(conf).toContain('ssl_certificate_key /ssl/app.key;');
    expect(conf).toContain('return 301 https://');
  });

  test('a plain site listens on 80 with no TLS directives', () => {
    const conf = generateNginx({ sites: [site()] });
    expect(conf).toContain('listen 80;');
    expect(conf).not.toContain('ssl_certificate');
  });
});

describe('generateCaddy', () => {
  test('emits a site block with path-scoped handle blocks', () => {
    const conf = generateCaddy({ sites: [site()] });
    expect(conf).toContain('app.example.com {');
    expect(conf).toContain('handle /api* {');
    expect(conf).toContain('reverse_proxy http://127.0.0.1:3000');
    expect(conf).toContain('root * /var/www/app');
    expect(conf).toContain('try_files {path} /index.html');
    expect(conf).toContain('file_server');
  });

  test('a sub-path static mount stays path-scoped, not a global root', () => {
    const conf = generateCaddy({ sites: [site({ routes: [{ path: '/assets', static: '/var/www/assets' }] })] });
    expect(conf).toContain('handle /assets* {');
    // the root directive lives inside the scoped handle, not directly under the site
    expect(conf).not.toMatch(/example\.com \{\n\s*root/);
  });

  test('explicit tls paths become a tls directive', () => {
    const conf = generateCaddy({ sites: [site({ tls: { certPath: '/ssl/app.crt', keyPath: '/ssl/app.key' } })] });
    expect(conf).toContain('tls /ssl/app.crt /ssl/app.key');
  });
});

describe('determinism', () => {
  test('the same config produces byte-identical output, regardless of route order', () => {
    const a = generateNginx({ sites: [site()] });
    const reordered = site({ routes: [
      { path: '/', static: '/var/www/app', spa: true },
      { path: '/api', proxy: 'http://127.0.0.1:3000' },
    ] });
    const b = generateNginx({ sites: [reordered] });
    expect(b).toBe(a);
    // multiple sites sort by host
    const two = generateCaddy({ sites: [site({ host: 'b.example.com' }), site({ host: 'a.example.com' })] });
    expect(two.indexOf('a.example.com')).toBeLessThan(two.indexOf('b.example.com'));
  });

  test('output is order-independent even for same-host and same-path duplicates', () => {
    const s1 = { host: 'x.example.com', routes: [{ path: '/', static: '/one' }] };
    const s2 = { host: 'x.example.com', routes: [{ path: '/', static: '/two' }] };
    expect(generateNginx({ sites: [s1, s2] })).toBe(generateNginx({ sites: [s2, s1] }));
    const r1 = { path: '/api', proxy: 'http://a.example.com' };
    const r2 = { path: '/api', proxy: 'http://b.example.com' };
    expect(generateCaddy({ sites: [site({ routes: [r1, r2] })] }))
      .toBe(generateCaddy({ sites: [site({ routes: [r2, r1] })] }));
  });
});

describe('injection safety', () => {
  test('a hostile host name is refused, not written into the config', () => {
    for (const host of [
      'app.example.com;\ninjected',
      'app.example.com { }',
      'app.example.com }\nlocation / { proxy_pass http://evil;',
      'app .example.com',
      '',
    ]) {
      expect(() => generateNginx({ sites: [site({ host })] })).toThrow(/host/i);
      expect(() => generateCaddy({ sites: [site({ host })] })).toThrow(/host/i);
    }
  });

  test('a wildcard host is allowed', () => {
    expect(() => generateNginx({ sites: [site({ host: '*.example.com' })] })).not.toThrow();
  });

  test('a hostile proxy target is refused', () => {
    for (const proxy of ['http://ok;\ninjected', 'not-a-url', 'http://ok }\n', 'javascript:alert(1)']) {
      expect(() => generateNginx({ sites: [site({ routes: [{ path: '/', proxy }] })] })).toThrow(/proxy|url/i);
    }
    expect(() => generateNginx({ sites: [site({ routes: [{ path: '/', proxy: 'https://up.example.com:8443' }] })] })).not.toThrow();
  });

  test('a hostile static root or route path is refused', () => {
    expect(() => generateNginx({ sites: [site({ routes: [{ path: '/', static: '/var/www;\nevil' }] })] })).toThrow(/root|path/i);
    expect(() => generateCaddy({ sites: [site({ routes: [{ path: '/x {\n', static: '/var/www' }] })] })).toThrow(/path/i);
  });

  test('an empty config is a valid empty document, not a crash', () => {
    expect(generateNginx({ sites: [] })).toBe('');
    expect(generateCaddy({})).toBe('');
  });
});
