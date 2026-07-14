// The development watch transport: an SSE endpoint that pushes
// revisioned reloads, a CSS-only fast path, sticky compile-error
// delivery, and deterministic reconnection. Web-standard streams
// throughout, so it drives under Node without a socket.
import { describe, expect, test } from 'bun:test';
import { createContext, createWatch, watchClient } from '@rip-lang/server';

const request = (path = '/_rip/watch', opts = {}) => new Request(`http://test.local${path}`, opts);
const ctxOf = (req) => createContext(req);

// Read decoded SSE chunks from a live stream until `count` events
// (blank-line-terminated records) arrive, then return them.
const readEvents = async (response, count) => {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = '';
  while (events.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      events.push(buffer.slice(0, sep));
      buffer = buffer.slice(sep + 2);
    }
  }
  reader.cancel();
  return events;
};

const parseEvent = raw => {
  const out = { id: null, event: 'message', data: '' };
  for (const line of raw.split('\n')) {
    if (line.startsWith('id:')) out.id = line.slice(3).trim();
    else if (line.startsWith('event:')) out.event = line.slice(6).trim();
    else if (line.startsWith('data:')) out.data += line.slice(5).trim();
    else if (line.startsWith('retry:')) out.retry = Number(line.slice(6).trim());
  }
  return out;
};

describe('createWatch endpoint', () => {
  test('the handler opens a text/event-stream that never caches', async () => {
    const watch = createWatch();
    const res = await watch.handler(ctxOf(request()));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
    await res.body.cancel();
  });

  test('a fresh connection opens with a retry hint', async () => {
    const watch = createWatch();
    const res = await watch.handler(ctxOf(request()));
    const [first] = await readEvents(res, 1);
    expect(parseEvent(first).retry).toBe(1000);
  });

  test('reload, css, and error push revisioned events to a client', async () => {
    const watch = createWatch();
    const res = await watch.handler(ctxOf(request()));
    const reader = res.body.getReader();
    await reader.read(); // drain the opening retry frame
    const collect = async () => {
      const { value } = await reader.read();
      return parseEvent(new TextDecoder().decode(value).trim());
    };
    watch.reload();
    const reload = await collect();
    expect(reload.event).toBe('reload');
    expect(reload.id).toBe('1');
    watch.css(['/style.css', '/theme.css']);
    const css = await collect();
    expect(css.event).toBe('css');
    expect(JSON.parse(css.data)).toEqual({ hrefs: ['/style.css', '/theme.css'] });
    expect(css.id).toBe('2');
    watch.error({ file: 'app.rip', line: 3, message: 'unexpected token' });
    const err = await collect();
    expect(err.event).toBe('error');
    expect(JSON.parse(err.data).message).toBe('unexpected token');
    await reader.cancel();
  });

  test('the revision is monotonic across every event kind', () => {
    const watch = createWatch();
    expect(watch.revision()).toBe(0);
    watch.reload();
    watch.css(['/a.css']);
    watch.error({ message: 'x' });
    expect(watch.revision()).toBe(3);
  });
});

describe('deterministic reconnection', () => {
  test('a client reconnecting behind the current revision is reloaded at once', async () => {
    const watch = createWatch();
    watch.reload();
    watch.reload(); // revision now 2
    const res = await watch.handler(ctxOf(request('/_rip/watch', { headers: { 'Last-Event-ID': '1' } })));
    const events = (await readEvents(res, 2)).map(parseEvent);
    const reload = events.find(e => e.event === 'reload');
    expect(reload).toBeDefined();
    expect(reload.id).toBe('2');
  });

  test('a client already current gets only the retry hint, no spurious reload', async () => {
    const watch = createWatch();
    watch.reload(); // revision 1
    const res = await watch.handler(ctxOf(request('/_rip/watch', { headers: { 'Last-Event-ID': '1' } })));
    const [first] = await readEvents(res, 1);
    expect(parseEvent(first).event).not.toBe('reload');
  });
});

describe('sticky compile error', () => {
  test('a live error reaches a client that connects after it', async () => {
    const watch = createWatch();
    watch.error({ file: 'broken.rip', message: 'boom' });
    const res = await watch.handler(ctxOf(request()));
    const events = (await readEvents(res, 2)).map(parseEvent);
    const err = events.find(e => e.event === 'error');
    expect(err).toBeDefined();
    expect(JSON.parse(err.data).message).toBe('boom');
  });

  test('a reload clears the sticky error, so later clients see none', async () => {
    const watch = createWatch();
    watch.error({ message: 'boom' });
    watch.reload();
    const res = await watch.handler(ctxOf(request('/_rip/watch', { headers: { 'Last-Event-ID': String(watch.revision()) } })));
    const [first] = await readEvents(res, 1);
    expect(parseEvent(first).event).not.toBe('error');
  });
});

describe('client teardown', () => {
  test('cancelling the stream drops the client at once, before any emit', async () => {
    const watch = createWatch();
    const res = await watch.handler(ctxOf(request()));
    expect(watch.clientCount()).toBe(1);
    await res.body.cancel();
    expect(watch.clientCount()).toBe(0);
    watch.reload(); // a push after cancel must not throw on the dead controller
    expect(watch.clientCount()).toBe(0);
  });
});

describe('hostile and malformed inputs never wedge the endpoint', () => {
  test('a non-serializable error payload does not tear the stream or 500 new clients', async () => {
    const watch = createWatch();
    const circular = {};
    circular.self = circular;
    expect(() => watch.error(circular)).not.toThrow();
    expect(watch.revision()).toBe(1);
    const res = await watch.handler(ctxOf(request()));
    expect(res.status).toBe(200);
    const events = (await readEvents(res, 2)).map(parseEvent);
    const err = events.find(e => e.event === 'error');
    expect(JSON.parse(err.data).message).toContain('could not be serialized');
  });

  test('malformed css and error payloads normalize before reaching the client', async () => {
    const watch = createWatch();
    const res = await watch.handler(ctxOf(request()));
    const reader = res.body.getReader();
    await reader.read();
    const collect = async () => parseEvent(new TextDecoder().decode((await reader.read()).value).trim());
    watch.css(null);
    expect(JSON.parse((await collect()).data)).toEqual({ hrefs: [] });
    watch.error(undefined);
    expect(JSON.parse((await collect()).data).message).toBe('error');
    await reader.cancel();
  });

  test('a non-GET request to the watch endpoint is 405, no stream', async () => {
    const watch = createWatch();
    const res = await watch.handler(ctxOf(request('/_rip/watch', { method: 'POST' })));
    expect(res.status).toBe(405);
    expect(watch.clientCount()).toBe(0);
  });
});

describe('watchClient', () => {
  test('emits a single self-contained EventSource client with the three handlers', () => {
    const js = watchClient();
    expect(js).toContain('EventSource');
    expect(js).toContain('/_rip/watch');
    expect(js).toContain("addEventListener('reload'");
    expect(js).toContain("addEventListener('css'");
    expect(js).toContain("addEventListener('error'");
    expect(js).toContain('location.reload');
  });

  test('honors a custom path', () => {
    expect(watchClient({ path: '/__dev' })).toContain('/__dev');
  });
});
