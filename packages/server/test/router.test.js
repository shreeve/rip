// The pure request matcher: methods, patterns, precedence, duplicate
// rejection, params/query representation, loud malformed-route
// rejection. No I/O — every behavior here is a function of
// (registrations, method, pathname).
import { describe, expect, test } from 'bun:test';
import { createMatcher, parseQuery } from '@rip-lang/server';

const handler = name => () => name;

const matcher = (...routes) => {
  const m = createMatcher();
  for (const [method, pattern, name] of routes) m.add(method, pattern, handler(name ?? pattern));
  return m;
};

describe('methods', () => {
  test('a route matches only its method, and ALL matches every method', () => {
    const m = matcher(['GET', '/x', 'get-x'], ['POST', '/x', 'post-x'], ['ALL', '/y', 'all-y']);
    expect(m.match('GET', '/x').handler()).toBe('get-x');
    expect(m.match('POST', '/x').handler()).toBe('post-x');
    expect(m.match('DELETE', '/x')).toBeNull();
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
      expect(m.match(method, '/y').handler()).toBe('all-y');
    }
  });

  test('methods normalize to uppercase at registration and match', () => {
    const m = matcher(['get', '/x']);
    expect(m.match('GET', '/x')).not.toBeNull();
    expect(m.match('get', '/x')).not.toBeNull();
    expect(m.routes()[0].method).toBe('GET');
  });
});

describe('patterns', () => {
  test('static routes match exactly, tolerating one trailing slash', () => {
    const m = matcher(['GET', '/users/all']);
    expect(m.match('GET', '/users/all')).not.toBeNull();
    expect(m.match('GET', '/users/all/')).not.toBeNull();
    expect(m.match('GET', '/users')).toBeNull();
    expect(m.match('GET', '/users/all/x')).toBeNull();
    expect(m.match('GET', '/USERS/ALL')).toBeNull();
  });

  test('the root pattern matches the root path', () => {
    const m = matcher(['GET', '/']);
    expect(m.match('GET', '/')).not.toBeNull();
    expect(m.match('GET', '/x')).toBeNull();
  });

  test(':name params capture one decoded segment', () => {
    const m = matcher(['GET', '/users/:id/posts/:post']);
    const hit = m.match('GET', '/users/42/posts/hello%20world');
    expect(hit.params).toEqual({ id: '42', post: 'hello world' });
    expect(m.match('GET', '/users/42/posts')).toBeNull();
    expect(m.match('GET', '/users/42/posts/a/b')).toBeNull();
  });

  test(':name{pattern} constrains its segment', () => {
    const m = matcher(['GET', '/orders/:id{\\d+}']);
    expect(m.match('GET', '/orders/123').params).toEqual({ id: '123' });
    expect(m.match('GET', '/orders/abc')).toBeNull();
  });

  test('*name captures the rest of the path, decoded per segment', () => {
    const m = matcher(['GET', '/files/*path']);
    expect(m.match('GET', '/files/a/b/c.txt').params).toEqual({ path: 'a/b/c.txt' });
    expect(m.match('GET', '/files/one%20two/x').params).toEqual({ path: 'one two/x' });
    expect(m.match('GET', '/files')).toBeNull();
  });

  test('a bare * stores its capture under the star key', () => {
    const m = matcher(['GET', '/assets/*']);
    expect(m.match('GET', '/assets/img/logo.png').params).toEqual({ '*': 'img/logo.png' });
  });

  test('an empty segment never satisfies a param or a catch-all piece', () => {
    const m = matcher(['GET', '/a/:x'], ['GET', '/a/:y/b'], ['GET', '/files/*path']);
    expect(m.match('GET', '/a//')).toBeNull();
    expect(m.match('GET', '/a//b')).toBeNull();
    expect(m.match('GET', '/files//x')).toBeNull();
  });

  test('a constraint may spell a literal paren either way', () => {
    const m = matcher(['GET', '/a/:x{\\(}'], ['GET', '/b/:y{[(]}']);
    expect(m.match('GET', '/a/(').params).toEqual({ x: '(' });
    expect(m.match('GET', '/b/(').params).toEqual({ y: '(' });
  });

  test('a segment that fails to decode matches nothing', () => {
    const m = matcher(['GET', '/users/:id'], ['GET', '/files/*path']);
    expect(m.match('GET', '/users/%E0%A4%A')).toBeNull();
    expect(m.match('GET', '/files/ok/%E0%A4%A')).toBeNull();
  });

  test('static segments compare against the encoded path as written', () => {
    const m = matcher(['GET', '/a b/x']);
    expect(m.match('GET', '/a b/x')).not.toBeNull();
    expect(m.match('GET', '/a%20b/x')).toBeNull();
  });

  test('regex metacharacters in static patterns stay literal', () => {
    const m = matcher(['GET', '/v1.0/data']);
    expect(m.match('GET', '/v1.0/data')).not.toBeNull();
    expect(m.match('GET', '/v1x0/data')).toBeNull();
  });
});

describe('precedence', () => {
  test('registration order wins: first match, not best match', () => {
    const m = matcher(['GET', '/users/:id', 'param'], ['GET', '/users/all', 'static']);
    expect(m.match('GET', '/users/all').handler()).toBe('param');
    const reversed = matcher(['GET', '/users/all', 'static'], ['GET', '/users/:id', 'param']);
    expect(reversed.match('GET', '/users/all').handler()).toBe('static');
    expect(reversed.match('GET', '/users/42').handler()).toBe('param');
  });

  test('an ALL route registered first shadows a later specific method', () => {
    const m = matcher(['ALL', '/x', 'all'], ['GET', '/x', 'get']);
    expect(m.match('GET', '/x').handler()).toBe('all');
  });
});

describe('duplicate rejection', () => {
  test('an exact method+pattern duplicate rejects loudly', () => {
    const m = matcher(['GET', '/users/:id']);
    expect(() => m.add('GET', '/users/:id', handler('again')))
      .toThrow(/GET \/users\/:id.*already registered/);
  });

  test('different methods or different patterns are not duplicates', () => {
    const m = matcher(['GET', '/x']);
    expect(() => m.add('POST', '/x', handler('ok'))).not.toThrow();
    expect(() => m.add('GET', '/x/y', handler('ok'))).not.toThrow();
  });

  test('method case does not disguise a duplicate', () => {
    const m = matcher(['GET', '/x']);
    expect(() => m.add('get', '/x', handler('again'))).toThrow(/already registered/);
  });
});

describe('malformed routes reject loudly, naming the pattern', () => {
  const bad = (method, pattern, expected) => {
    const m = createMatcher();
    expect(() => m.add(method, pattern, handler('x'))).toThrow(expected);
  };

  test('a pattern must be a string starting with /', () => {
    bad('GET', 'users/list', /must start with '\/'/);
    bad('GET', '', /must start with '\/'/);
    bad('GET', null, /must start with '\/'/);
  });

  test('a method must be a known token', () => {
    bad('FETCH?', '/x', /method/i);
    bad('', '/x', /method/i);
  });

  test('a handler is required', () => {
    const m = createMatcher();
    expect(() => m.add('GET', '/x')).toThrow(/handler/);
  });

  test('an empty or malformed param rejects', () => {
    bad('GET', '/users/:', /param/);
    bad('GET', '/users/:{\\d+}', /param/);
  });

  test('an unbalanced, empty, or invalid constraint rejects', () => {
    bad('GET', '/orders/:id{\\d+', /unbalanced constraint/);
    bad('GET', '/orders/:id{}', /empty constraint/);
    bad('GET', '/orders/:id{[}', /invalid constraint/);
  });

  test('a trailing slash in a pattern rejects toward the canonical spelling', () => {
    bad('GET', '/x/', /already tolerates a trailing slash/);
  });

  test('a glob-spelled catch-all rejects', () => {
    bad('GET', '/files/**', /malformed catch-all/);
  });

  test('duplicate param names in one pattern reject', () => {
    bad('GET', '/a/:x/b/:x', /duplicate param 'x'/);
  });

  test('a catch-all anywhere but the final segment rejects', () => {
    bad('GET', '/files/*path/meta', /final segment/);
    bad('GET', '/files/*/meta', /final segment/);
  });

  test('a constraint may not capture, named groups included', () => {
    bad('GET', '/orders/:id{(\\d+)}', /capturing constraint/);
    bad('GET', '/orders/:id{(?<year>\\d{4})}', /capturing constraint/);
  });
});

describe('routes()', () => {
  test('reflects registrations in order with method, pattern, and handler', () => {
    const m = matcher(['get', '/a'], ['POST', '/b/:id']);
    const listed = m.routes();
    expect(listed.map(r => [r.method, r.pattern])).toEqual([['GET', '/a'], ['POST', '/b/:id']]);
    expect(typeof listed[0].handler).toBe('function');
  });

  test('the listing is a snapshot, not the live table', () => {
    const m = matcher(['GET', '/a']);
    const listed = m.routes();
    listed.pop();
    expect(m.routes().length).toBe(1);
  });
});

describe('parseQuery', () => {
  test('decodes keys and values; duplicate keys keep the last value', () => {
    expect(parseQuery('?a=1&b=two%20words&a=3')).toEqual({ a: '3', b: 'two words' });
  });

  test('a plus decodes to a space', () => {
    expect(parseQuery('?q=one+two')).toEqual({ q: 'one two' });
  });

  test('bare keys, empty values, and empty input', () => {
    expect(parseQuery('?flag&x=')).toEqual({ flag: '', x: '' });
    expect(parseQuery('')).toEqual({});
    expect(parseQuery('?')).toEqual({});
    expect(parseQuery(undefined)).toEqual({});
  });

  test('a malformed escape never throws and follows WHATWG decoding', () => {
    expect(parseQuery('?k=%E0%A4%A').k).toBe('�%A');
  });

  test('a __proto__ key becomes inert own data', () => {
    const query = parseQuery('?__proto__=polluted');
    expect(query.__proto__).toBe('polluted');
    expect({}.polluted).toBeUndefined();
  });
});
