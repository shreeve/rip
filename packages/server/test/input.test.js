// Route input validation and the deterministic OpenAPI document:
// reading() installs c.read over body ∪ query ∪ params, withInput
// validates the body through a schema (structured 400, @input
// ownership), and openapi() derives the always-current document from
// a matcher's routes.
import { describe, expect, test } from 'bun:test';
import { compose, createContext, createMatcher, openapi, reading, withInput } from '@rip-lang/server';
import { CreateOrder, Rename } from './fixtures/schemas.rip';

const request = (path = '/x', opts = {}) => new Request(`http://test.local${path}`, opts);
const jsonRequest = (path, body, opts = {}) => request(path, {
  method: 'POST',
  body: JSON.stringify(body),
  headers: { 'Content-Type': 'application/json' },
  ...opts,
});
const ctxOf = (req, params) => createContext(req, { params });

describe('reading', () => {
  const run = (handler, req, params) =>
    compose({ use: [reading()], handler })(ctxOf(req, params));

  test('read pools body, query, and params — params win', async () => {
    const res = await run(
      c => ({ id: c.read('id'), sort: c.read('sort'), note: c.read('note') }),
      jsonRequest('/orders/7?sort=age&id=query-loses', { note: 'from body', id: 'body-loses' }),
      { id: '7' },
    );
    expect(await res.json()).toEqual({ id: '7', sort: 'age', note: 'from body' });
  });

  test('read() with no name returns the whole parsed body', async () => {
    const res = await run(c => c.read(), jsonRequest('/x', { a: 1, b: [2] }));
    expect(await res.json()).toEqual({ a: 1, b: [2] });
  });

  test('dotted paths walk nested bodies', async () => {
    const res = await run(
      c => ({ first: c.read('patient.name.first') }),
      jsonRequest('/x', { patient: { name: { first: 'Ada' } } }),
    );
    expect(await res.json()).toEqual({ first: 'Ada' });
  });

  test('validator names normalize; a trailing bang requires the field', async () => {
    const res = await run(
      c => ({ phone: c.read('phone', 'phone') }),
      jsonRequest('/x', { phone: '502.555.1212' }),
    );
    expect(await res.json()).toEqual({ phone: '(502) 555-1212' });

    const missing = await run(c => c.read('email', 'email!'), jsonRequest('/x', {}));
    expect(missing.status).toBe(400);
    expect((await missing.json()).error.message).toContain('email');
  });

  test('a validation miss answers null or the given default', async () => {
    const res = await run(
      c => ({
        bad: c.read('zip', 'zip'),
        fallback: c.read('role', ['admin', 'user'], 'user'),
      }),
      jsonRequest('/x', { zip: 'not-a-zip', role: 'superadmin' }),
    );
    expect(await res.json()).toEqual({ bad: null, fallback: 'user' });
  });

  test('enumerations, ranges, and regex forms constrain values', async () => {
    const res = await run(
      c => ({
        role: c.read('role', ['admin', 'user']),
        age: c.read('age', [18, 120]),
        tooYoung: c.read('young', [18, 120]),
        code: c.read('code', /^[A-Z]{3}$/),
      }),
      jsonRequest('/x', { role: 'admin', age: '42', young: '11', code: 'ABC' }),
    );
    expect(await res.json()).toEqual({ role: 'admin', age: 42, tooYoung: null, code: 'ABC' });
  });

  test('an unreadable body still reads query and params', async () => {
    const res = await run(
      c => ({ q: c.read('q'), whole: c.read() }),
      request('/x?q=1', { method: 'POST', body: '{nope', headers: { 'Content-Type': 'application/json' } }),
    );
    expect(await res.json()).toEqual({ q: '1', whole: {} });
  });

  test('a scalar met mid-path is a miss, never the parent value', async () => {
    const res = await run(
      c => ({ deep: c.read('patient.name.first'), deeper: c.read('a.b.c', null, 'fallback') }),
      jsonRequest('/x', { patient: 'Ada', a: { b: 'abc' } }),
    );
    expect(await res.json()).toEqual({ deep: null, deeper: 'fallback' });
  });

  test('the pool answers own data only, never prototype members', async () => {
    const res = await run(
      c => ({ ctor: c.read('constructor'), str: c.read('toString'), has: c.read('a.hasOwnProperty') }),
      jsonRequest('/x', { a: { real: 1 } }),
    );
    expect(await res.json()).toEqual({ ctor: null, str: null, has: null });
  });

  test('required outranks a miss default, for absence and blankness alike', async () => {
    const missing = await run(c => c.read('note', 'string!', () => 'fn-fallback'), jsonRequest('/x', {}));
    expect(missing.status).toBe(400);
    expect((await missing.json()).error.issues[0]).toEqual({ field: 'note', error: 'required', message: 'note is required' });
    const blank = await run(c => c.read('name', 'name!'), jsonRequest('/x', { name: '   ' }));
    expect(blank.status).toBe(400);
  });

  test('a present-but-invalid required field says invalid, not missing', async () => {
    const res = await run(c => c.read('zip', 'zip!'), jsonRequest('/x', { zip: 'not-a-zip' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.issues[0]).toEqual({ field: 'zip', error: 'invalid', message: 'zip is invalid' });
  });

  test('an optional blank or absent field takes its default through total validators', async () => {
    const res = await run(
      c => ({ phone: c.read('phone', 'phone', 'DEFAULT'), note: c.read('note', 'string') }),
      jsonRequest('/x', { phone: '' }),
    );
    expect(await res.json()).toEqual({ phone: 'DEFAULT', note: null });
  });

  test('a numeric enumeration spelled as a range rejects loudly', async () => {
    const res = await run(c => c.read('n', [1, 2, 3]), jsonRequest('/x', { n: 2 }));
    expect(res.status).toBe(500);
  });

  test('read outside reading() rejects loudly', async () => {
    const res = await compose({ handler: c => c.read('x') })(ctxOf(request('/x')));
    expect(res.status).toBe(500);
  });
});

describe('withInput', () => {
  const run = (schema, handler, req) =>
    compose({ handler: withInput(schema, handler) })(ctxOf(req));

  test('a valid body lands parsed, coerced, and owned as c.input', async () => {
    const res = await run(CreateOrder, c => c.input,
      jsonRequest('/orders', { total: '$12.50', placed: '20240229' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ total: 1250, placed: '2024-02-29' });
  });

  test('a failing body is a structured 400 that never reaches the handler', async () => {
    let reached = false;
    const res = await run(CreateOrder, () => { reached = true; return 'never'; },
      jsonRequest('/orders', { total: 'one million dollars' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toBe('Validation failed');
    expect(Array.isArray(body.error.issues)).toBe(true);
    expect(body.error.issues.length).toBeGreaterThan(0);
    expect(reached).toBe(false);
  });

  test('an unparseable JSON body is its own structured 400', async () => {
    const res = await run(CreateOrder, () => 'never',
      request('/orders', { method: 'POST', body: '{nope', headers: { 'Content-Type': 'application/json' } }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.issues[0].error).toBe('json');
  });

  test('withInput cooperates with reading() — one body parse, both surfaces', async () => {
    const res = await compose({
      use: [reading()],
      handler: withInput(CreateOrder, c => ({ input: c.input, viaRead: c.read('total') })),
    })(ctxOf(jsonRequest('/orders', { total: '$1.00', placed: '20240229' })));
    expect(await res.json()).toEqual({ input: { total: 100, placed: '2024-02-29' }, viaRead: '$1.00' });
  });

  test('withInput stamps the schema for the OpenAPI seam', () => {
    const wrapped = withInput(CreateOrder, () => 'x');
    expect(wrapped.inputSchema).toBe(CreateOrder);
  });

  test('withInput on a bodyless method is a loud mistake', async () => {
    const res = await run(CreateOrder, () => 'never', request('/orders', { method: 'GET' }));
    expect(res.status).toBe(500);
  });
});

describe('openapi', () => {
  const build = () => {
    const m = createMatcher();
    m.add('POST', '/orders', withInput(CreateOrder, () => 'x'));
    m.add('PUT', '/users/:id/name', withInput(Rename, () => 'x'));
    m.add('GET', '/health', () => 'ok');
    m.add('POST', '/echo/:kind{\\w+}', withInput(Rename, () => 'x'));
    return m;
  };

  test('every schema route contributes an operation; bare routes do not', () => {
    const doc = openapi(build().routes(), { title: 'Probe API', version: '1.2.3' });
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info).toEqual({ title: 'Probe API', version: '1.2.3' });
    expect(Object.keys(doc.paths)).toEqual(['/echo/{kind}', '/orders', '/users/{id}/name']);
    expect(doc.paths['/orders'].post.requestBody.required).toBe(true);
    expect(doc.paths['/health']).toBeUndefined();
  });

  test('path params derive from the pattern', () => {
    const doc = openapi(build().routes());
    expect(doc.paths['/users/{id}/name'].put.parameters).toEqual([
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
    ]);
    expect(doc.paths['/echo/{kind}'].post.parameters[0].name).toBe('kind');
  });

  test('repeated schemas deduplicate into components with refs', () => {
    const doc = openapi(build().routes());
    const renameRef = doc.paths['/users/{id}/name'].put.requestBody.content['application/json'].schema;
    const echoRef = doc.paths['/echo/{kind}'].post.requestBody.content['application/json'].schema;
    expect(renameRef.$ref).toBe(echoRef.$ref);
    expect(renameRef.$ref).toMatch(/^#\/components\/schemas\//);
    const name = renameRef.$ref.split('/').pop();
    expect(doc.components.schemas[name]).toEqual(Rename.toJSONSchema());
    const orderRef = doc.paths['/orders'].post.requestBody.content['application/json'].schema;
    expect(orderRef.$ref).not.toBe(renameRef.$ref);
  });

  test('the document is deterministic: same routes, same bytes, any registration order', () => {
    const a = openapi(build().routes());
    const m = createMatcher();
    m.add('POST', '/echo/:kind{\\w+}', withInput(Rename, () => 'x'));
    m.add('GET', '/health', () => 'ok');
    m.add('PUT', '/users/:id/name', withInput(Rename, () => 'x'));
    m.add('POST', '/orders', withInput(CreateOrder, () => 'x'));
    const b = openapi(m.routes());
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  test('constraint variants templating to one path stay deterministic, first registered documents', () => {
    const forward = createMatcher();
    forward.add('POST', '/u/:id{\\d+}', withInput(CreateOrder, () => 'x'));
    forward.add('POST', '/u/:id{\\w+}', withInput(Rename, () => 'x'));
    const reverse = createMatcher();
    reverse.add('POST', '/u/:id{\\w+}', withInput(Rename, () => 'x'));
    reverse.add('POST', '/u/:id{\\d+}', withInput(CreateOrder, () => 'x'));
    const a = openapi(forward.routes());
    const b = openapi(reverse.routes());
    expect(a.paths['/u/{id}'].post.requestBody.content['application/json'].schema.$ref)
      .toContain('CreateOrder');
    expect(b.paths['/u/{id}'].post.requestBody.content['application/json'].schema.$ref)
      .toContain('Rename');
    expect(JSON.stringify(openapi(forward.routes()))).toBe(JSON.stringify(a));
  });

  test('mutating a built document never corrupts the next build', () => {
    const doc = openapi(build().routes());
    doc.paths['/orders'].post.responses['400'].description = 'vandalized';
    const fresh = openapi(build().routes());
    expect(fresh.paths['/orders'].post.responses['400'].description).toBe('Validation failed');
  });

  test('every operation carries the standard 400 failure shape', () => {
    const doc = openapi(build().routes());
    const failure = doc.paths['/orders'].post.responses['400'];
    expect(failure.description).toBe('Validation failed');
    const shape = failure.content['application/json'].schema;
    expect(shape.properties.error.properties.issues.type).toBe('array');
  });
});
