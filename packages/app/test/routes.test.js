import { describe, expect, test } from 'bun:test';
import { buildRoutes, parseQuery } from '@rip-lang/app';

const manifest = files => buildRoutes(files.map(f => `_route/${f}`));
const patterns = m => m.routes.map(r => r.pattern);

describe('route patterns', () => {
  test('index.rip is the root route', () => {
    const m = manifest(['index.rip']);
    expect(patterns(m)).toEqual(['/']);
    expect(m.match('/').route.file).toBe('_route/index.rip');
  });

  test('static files map to their path', () => {
    const m = manifest(['about.rip', 'users/list.rip']);
    expect(m.match('/about').route.file).toBe('_route/about.rip');
    expect(m.match('/users/list').route.file).toBe('_route/users/list.rip');
    expect(m.match('/nope')).toBeNull();
  });

  test('a nested index names its directory', () => {
    const m = manifest(['users/index.rip']);
    expect(patterns(m)).toEqual(['/users']);
  });

  test('dots in filenames stay literal', () => {
    const m = manifest(['foo.bar.rip']);
    expect(m.match('/foo.bar')).not.toBeNull();
    expect(m.match('/fooxbar')).toBeNull();
  });

  test('literal parens inside a filename are preserved', () => {
    const m = manifest(['foo(bar).rip']);
    expect(m.match('/foo(bar)')).not.toBeNull();
  });

  test('a trailing slash is a different path', () => {
    const m = manifest(['about.rip', 'index.rip']);
    expect(m.match('/about/')).toBeNull();
    expect(m.match('/')).not.toBeNull();
  });
});

describe('dynamic segments', () => {
  test('[id] captures one segment', () => {
    const m = manifest(['users/[id].rip']);
    expect(m.match('/users/7').params).toEqual({ id: '7' });
    expect(m.match('/users/7/posts')).toBeNull();
    expect(m.match('/users')).toBeNull();
  });

  test('multiple params capture in path order', () => {
    const m = manifest(['users/[uid]/posts/[pid].rip']);
    expect(m.match('/users/3/posts/9').params).toEqual({ uid: '3', pid: '9' });
  });

  test('params are percent-decoded', () => {
    const m = manifest(['users/[id].rip']);
    expect(m.match('/users/a%20b').params.id).toBe('a b');
  });

  test('malformed percent-encoding fails the match', () => {
    const m = manifest(['users/[id].rip']);
    expect(m.match('/users/%zz')).toBeNull();
  });

  test('malformed encoding never falls through to a catch-all', () => {
    const m = manifest(['users/[id].rip', '[...rest].rip']);
    expect(m.match('/users/%zz')).toBeNull();
  });

  test('an encoded slash stays inside its param', () => {
    const m = manifest(['users/[id].rip']);
    expect(m.match('/users/a%2Fb').params.id).toBe('a/b');
    expect(m.match('/users/a/b')).toBeNull();
  });

  test('a param named __proto__ is a real own property', () => {
    const m = manifest(['users/[__proto__].rip']);
    const { params } = m.match('/users/evil');
    expect(Object.hasOwn(params, '__proto__')).toBeTrue();
    expect(Object.getPrototypeOf({})).not.toHaveProperty('polluted');
  });

  test('a route declaring one param name twice rejects', () => {
    expect(() => manifest(['[id]/[id].rip'])).toThrow(/duplicate parameter name 'id'/);
  });
});

describe('segment decoding', () => {
  test('static segments match their encoded spelling', () => {
    const m = manifest(['my docs.rip']);
    expect(m.match('/my%20docs')).not.toBeNull();
    expect(m.match('/my docs')).not.toBeNull();
  });

  test('unicode filenames match their encoded spelling', () => {
    const m = manifest(['café.rip']);
    expect(m.match('/caf%C3%A9')).not.toBeNull();
  });
});

describe('optional segments', () => {
  test('[[page]] matches with and without the segment', () => {
    const m = manifest(['docs/[[page]].rip']);
    expect(m.match('/docs/intro').params).toEqual({ page: 'intro' });
    expect(m.match('/docs').params).toEqual({});
    expect('page' in m.match('/docs').params).toBeFalse();
  });

  test('an optional segment works mid-path', () => {
    const m = manifest(['a/[[x]]/b.rip']);
    expect(m.match('/a/b').params).toEqual({});
    expect(m.match('/a/1/b').params).toEqual({ x: '1' });
  });

  test('an optional route rejects a sibling claiming its base URL', () => {
    expect(() => manifest(['docs/[[page]].rip', 'docs.rip'])).toThrow(/both resolve/);
    expect(() => manifest(['docs/[[page]].rip', 'docs/index.rip'])).toThrow(/both resolve/);
  });

  test('adjacent optionals are ambiguous with themselves', () => {
    expect(() => manifest(['a/[[x]]/[[y]]/b.rip'])).toThrow(/ambiguous with itself/);
  });

  test('separated optionals coexist', () => {
    const m = manifest(['a/[[x]]/mid/[[y]].rip']);
    expect(m.match('/a/mid').params).toEqual({});
    expect(m.match('/a/1/mid/2').params).toEqual({ x: '1', y: '2' });
  });

  test('more than eight optional segments reject', () => {
    const rel = Array.from({ length: 9 }, (_, i) => `s${i}/[[o${i}]]`).join('/') + '.rip';
    expect(() => manifest([rel])).toThrow(/optional segments/);
  });
});

describe('catch-all segments', () => {
  test('a root catch-all matches every path including /', () => {
    const m = manifest(['[...rest].rip']);
    expect(m.match('/').params).toEqual({ rest: '' });
    expect(m.match('/a/b/c').params).toEqual({ rest: 'a/b/c' });
  });

  test('a nested catch-all requires its prefix', () => {
    const m = manifest(['docs/[...rest].rip']);
    expect(m.match('/docs/x/y').params).toEqual({ rest: 'x/y' });
    expect(m.match('/docs/').params).toEqual({ rest: '' });
    expect(m.match('/docs')).toBeNull();
    expect(m.match('/other')).toBeNull();
  });

  test('a catch-all before the final segment rejects', () => {
    expect(() => manifest(['[...rest]/x.rip'])).toThrow(/catch-all/);
  });

  test('a catch-all directory index rejects', () => {
    expect(() => manifest(['docs/[...rest]/index.rip'])).toThrow(/catch-all/);
  });

  test('an optional route outranks a catch-all sibling', () => {
    const m = manifest(['docs/[[x]].rip', 'docs/[...rest].rip']);
    expect(m.match('/docs/a').route.file).toBe('_route/docs/[[x]].rip');
    expect(m.match('/docs/a/b').route.file).toBe('_route/docs/[...rest].rip');
  });
});

describe('route groups', () => {
  test('(group) segments vanish from the URL', () => {
    const m = manifest(['(app)/orders.rip']);
    expect(m.match('/orders').route.file).toBe('_route/(app)/orders.rip');
  });

  test('nested groups all vanish', () => {
    const m = manifest(['(a)/(b)/x.rip']);
    expect(m.match('/x')).not.toBeNull();
  });

  test('a group directory contributes its layout', () => {
    const m = manifest(['(app)/_layout.rip', '(app)/orders.rip']);
    expect(m.match('/orders').route.layouts).toEqual(['_route/(app)/_layout.rip']);
  });

  test('a route file named as a group rejects', () => {
    expect(() => manifest(['(x).rip'])).toThrow(/group/);
  });

  test('two groups exposing one URL reject deterministically', () => {
    const message = /'\(a\)\/orders\.rip' and '\(b\)\/orders\.rip' both resolve to '\/orders'/;
    expect(() => manifest(['(a)/orders.rip', '(b)/orders.rip'])).toThrow(message);
    expect(() => manifest(['(b)/orders.rip', '(a)/orders.rip'])).toThrow(message);
  });
});

describe('underscore exclusion', () => {
  test('_-prefixed files and directories are not routable', () => {
    const m = manifest(['_helpers.rip', 'shared/_partials/widget.rip', 'index.rip']);
    expect(patterns(m)).toEqual(['/']);
  });

  test('_layout.rip is not itself a route', () => {
    const m = manifest(['_layout.rip', 'index.rip']);
    expect(patterns(m)).toEqual(['/']);
  });
});

describe('layout chains', () => {
  test('the root layout wraps every route', () => {
    const m = manifest(['_layout.rip', 'index.rip', 'admin/users.rip']);
    expect(m.match('/').route.layouts).toEqual(['_route/_layout.rip']);
    expect(m.match('/admin/users').route.layouts).toEqual(['_route/_layout.rip']);
  });

  test('nested layouts chain outermost first', () => {
    const m = manifest(['_layout.rip', 'admin/_layout.rip', 'admin/users.rip']);
    expect(m.match('/admin/users').route.layouts).toEqual([
      '_route/_layout.rip',
      '_route/admin/_layout.rip',
    ]);
  });

  test('a route without layouts has an empty chain', () => {
    const m = manifest(['index.rip']);
    expect(m.match('/').route.layouts).toEqual([]);
  });
});

describe('precedence', () => {
  test('static beats dynamic beats catch-all', () => {
    const m = manifest(['users/[id].rip', 'users/list.rip', '[...rest].rip']);
    expect(m.match('/users/list').route.file).toBe('_route/users/list.rip');
    expect(m.match('/users/42').route.file).toBe('_route/users/[id].rip');
    expect(m.match('/anything/else').route.file).toBe('_route/[...rest].rip');
  });

  test('fewer dynamic segments win', () => {
    const m = manifest(['[x]/[y].rip', 'a/[y].rip']);
    expect(m.match('/a/z').route.file).toBe('_route/a/[y].rip');
  });

  test('precedence is decided per segment, left to right', () => {
    const m = manifest(['a/[x].rip', '[y]/b.rip']);
    expect(m.match('/a/b').route.file).toBe('_route/a/[x].rip');
    expect(m.match('/c/b').route.file).toBe('_route/[y]/b.rip');
  });

  test('pattern order is deterministic regardless of input order', () => {
    const files = ['b/[x].rip', 'a/[x].rip', 'users/list.rip', '[...rest].rip', 'index.rip'];
    const sorted = patterns(manifest(files));
    expect(sorted).toEqual(['/', '/users/list', '/a/:x', '/b/:x', '/*rest']);
    expect(patterns(manifest([...files].reverse()))).toEqual(sorted);
  });

  test('two routes claiming one URL shape reject as ambiguous', () => {
    expect(() => manifest(['users/[id].rip', 'users/[key].rip'])).toThrow(/both resolve/);
  });

  test('a file listed more than once rejects by name', () => {
    expect(() => manifest(['about.rip', 'about.rip'])).toThrow(/listed more than once/);
  });
});

describe('manifest contract', () => {
  test('routes and their fields are frozen', () => {
    const m = manifest(['index.rip', '_layout.rip']);
    expect(Object.isFrozen(m)).toBeTrue();
    expect(Object.isFrozen(m.routes)).toBeTrue();
    expect(Object.isFrozen(m.routes[0])).toBeTrue();
    expect(Object.isFrozen(m.routes[0].layouts)).toBeTrue();
  });

  test('files outside the root are ignored', () => {
    const m = buildRoutes(['_route/index.rip', '_app/stash.rip', '_lib/x/y.rip']);
    expect(patterns(m)).toEqual(['/']);
  });

  test('an empty root treats every file as a route', () => {
    const m = buildRoutes(['index.rip', 'about.rip'], '');
    expect(patterns(m)).toEqual(['/', '/about']);
  });

  test('match requires a string', () => {
    const m = manifest(['index.rip']);
    expect(() => m.match(null)).toThrow(TypeError);
  });

  test('non-array files reject', () => {
    expect(() => buildRoutes('index.rip')).toThrow(TypeError);
  });

  test('a non-.rip file under the root rejects', () => {
    expect(() => buildRoutes(['_route/readme.md'])).toThrow(TypeError);
  });

  test('an invalid root rejects', () => {
    expect(() => buildRoutes([], 'a//b')).toThrow(TypeError);
    expect(() => buildRoutes([], '../x')).toThrow(TypeError);
    expect(() => buildRoutes([], null)).toThrow(TypeError);
  });

  test('malformed route file paths reject', () => {
    expect(() => buildRoutes(['_route/a//b.rip'])).toThrow(TypeError);
    expect(() => buildRoutes(['_route/../x.rip'])).toThrow(TypeError);
    expect(() => buildRoutes(['_route/.rip'])).toThrow(TypeError);
    expect(() => buildRoutes(['_route/a\\b.rip'])).toThrow(TypeError);
  });

  test('non-source files under a _ directory are ignored, not errors', () => {
    const m = buildRoutes(['_route/_assets/logo.png', '_route/index.rip']);
    expect(patterns(m)).toEqual(['/']);
  });

  test('marker syntax errors reject naming the file', () => {
    expect(() => manifest(['users/[id.rip'])).toThrow(/users\/\[id/);
    expect(() => manifest(['users/[].rip'])).toThrow(/users\/\[\]/);
    expect(() => manifest(['pre[id].rip'])).toThrow(/whole segment/);
    expect(() => manifest(['[[...x]].rip'])).toThrow(/optional/);
    expect(() => manifest(['[my id].rip'])).toThrow(/dynamic/);
  });
});

describe('parseQuery', () => {
  test('parses pairs with and without a leading ?', () => {
    expect(parseQuery('a=1&b=2')).toEqual({ a: '1', b: '2' });
    expect(parseQuery('?a=1')).toEqual({ a: '1' });
  });

  test('duplicate keys keep the last value', () => {
    expect(parseQuery('a=1&a=2')).toEqual({ a: '2' });
  });

  test('values are decoded and bare keys are empty strings', () => {
    expect(parseQuery('q=a%20b&flag')).toEqual({ q: 'a b', flag: '' });
  });

  test('a plus is a space, per query semantics', () => {
    expect(parseQuery('a=1+2')).toEqual({ a: '1 2' });
  });

  test('malformed percent-sequences pass through verbatim', () => {
    expect(parseQuery('a=%zz')).toEqual({ a: '%zz' });
  });

  test('an empty string is an empty object', () => {
    expect(parseQuery('')).toEqual({});
  });

  test('a non-string rejects', () => {
    expect(() => parseQuery(null)).toThrow(TypeError);
  });
});
