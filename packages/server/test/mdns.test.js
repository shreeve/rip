// mDNS `.local` advertising and the rip.local dashboard: LAN-IP
// selection, the mDNS service descriptor, and the dashboard HTML
// renderer — all pure and host-free. The actual dns-sd advertisement
// is the serving layer's spawn; here we build the descriptor it
// publishes and the page it serves.
import { describe, expect, test } from 'bun:test';
import { lanIP, mdnsService, renderDashboard } from '@rip-lang/server';

describe('lanIP', () => {
  const ifaces = {
    lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
    en0: [
      { family: 'IPv6', address: 'fe80::1', internal: false },
      { family: 'IPv4', address: '192.168.1.42', internal: false },
    ],
  };

  test('picks the first routable IPv4, skipping loopback and IPv6', () => {
    expect(lanIP(ifaces)).toBe('192.168.1.42');
  });

  test('skips link-local 169.254 addresses', () => {
    const linkLocal = { en0: [{ family: 'IPv4', address: '169.254.9.9', internal: false }, { family: 'IPv4', address: '10.0.0.5', internal: false }] };
    expect(lanIP(linkLocal)).toBe('10.0.0.5');
  });

  test('returns null when there is no routable address', () => {
    expect(lanIP({ lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }] })).toBeNull();
    expect(lanIP({})).toBeNull();
    expect(lanIP(null)).toBeNull();
  });

  test('malformed entries are skipped, and only a string address is returned', () => {
    expect(lanIP({ en0: [null, { family: 'IPv4', internal: false }, { family: 'IPv4', address: '10.1.2.3', internal: false }] }))
      .toBe('10.1.2.3');
    // a non-string address never leaks out as the return
    expect(lanIP({ en0: [{ family: 'IPv4', address: 16909060, internal: false }] })).toBeNull();
  });
});

describe('mdnsService', () => {
  test('builds an http service descriptor from a .local host', () => {
    const svc = mdnsService('myapp.local', { port: 3000, ip: '192.168.1.42' });
    expect(svc).toEqual({
      serviceName: 'myapp',
      serviceType: '_http._tcp',
      domain: 'local',
      host: 'myapp.local',
      port: 3000,
      ip: '192.168.1.42',
    });
  });

  test('https flips the service type', () => {
    expect(mdnsService('secure.local', { port: 443, ip: '10.0.0.1', https: true }).serviceType).toBe('_https._tcp');
  });

  test('a host that is not .local is not advertised', () => {
    expect(mdnsService('example.com', { port: 80, ip: '1.2.3.4' })).toBeNull();
  });

  test('a malformed .local host rejects loudly', () => {
    expect(() => mdnsService('bad host.local', { port: 80, ip: '1.2.3.4' })).toThrow(/host/i);
    expect(() => mdnsService('.local', { port: 80, ip: '1.2.3.4' })).toThrow(/host/i);
  });

  test('a missing or out-of-range port rejects loudly', () => {
    expect(() => mdnsService('a.local', { ip: '1.2.3.4' })).toThrow(/port/i);
    expect(() => mdnsService('a.local', { port: 99999, ip: '1.2.3.4' })).toThrow(/port/i);
  });
});

describe('renderDashboard', () => {
  const model = {
    apps: [
      { name: 'Store', url: 'https://store.local', status: 'running' },
      { name: 'Blog', url: 'http://blog.local', status: 'stopped' },
    ],
  };

  test('renders a page listing each app with its url and status', () => {
    const html = renderDashboard(model);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('Store');
    expect(html).toContain('https://store.local');
    expect(html).toContain('running');
    expect(html).toContain('Blog');
    expect(html).toContain('stopped');
  });

  test('a hostile app name or url is escaped, never injected as markup', () => {
    const html = renderDashboard({ apps: [{ name: '<script>alert(1)</script>', url: 'javascript:alert(2)', status: 'running' }] });
    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('&lt;script&gt;');
    // a non-http url is not rendered as a live link
    expect(html).not.toContain('href="javascript:');
  });

  test('an empty roster renders a valid empty-state page', () => {
    const html = renderDashboard({ apps: [] });
    expect(html).toContain('<!doctype html>');
    expect(html).toMatch(/no applications|nothing/i);
  });

  test('the default title is rip.local; a custom title is escaped', () => {
    expect(renderDashboard({ apps: [] })).toContain('<title>rip.local</title>');
    expect(renderDashboard({ apps: [], title: 'My Fleet' })).toContain('<title>My Fleet</title>');
  });
});
