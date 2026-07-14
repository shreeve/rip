// The `rip server` CLI: argv parsing and command dispatch, pure and
// host-free. The bin reads process.argv, calls process.exit, and
// writes to the terminal; parseServerArgs and dispatchServer decide
// what should happen, so the dispatch table tests without spawning a
// process or touching a socket.
import { describe, expect, test } from 'bun:test';
import { dispatchServer, parseServerArgs, serverUsage } from '@rip-lang/server';

describe('parseServerArgs', () => {
  test('the first bare word is the command; the rest are its arguments', () => {
    const parsed = parseServerArgs(['start', './app', 'extra']);
    expect(parsed.command).toBe('start');
    expect(parsed.args).toEqual(['./app', 'extra']);
  });

  test('no command defaults to help', () => {
    expect(parseServerArgs([]).command).toBe('help');
    expect(parseServerArgs(['--port', '3000']).command).toBe('help');
  });

  test('valued flags take the next token or an = form, numbers coerce', () => {
    expect(parseServerArgs(['start', '--port', '8080']).flags.port).toBe(8080);
    expect(parseServerArgs(['start', '--port=8080']).flags.port).toBe(8080);
    expect(parseServerArgs(['start', '--host', 'example.com']).flags.host).toBe('example.com');
  });

  test('short aliases resolve to their long flag', () => {
    expect(parseServerArgs(['start', '-p', '9000', '-w', '4']).flags).toMatchObject({ port: 9000, workers: 4 });
  });

  test('boolean flags are true when present, false under --no-', () => {
    expect(parseServerArgs(['start', '--https']).flags.https).toBe(true);
    expect(parseServerArgs(['start', '--no-https']).flags.https).toBe(false);
    expect(parseServerArgs(['start']).flags.https).toBeUndefined();
  });

  test('a boolean flag rejects an inline value instead of silently enabling', () => {
    expect(() => parseServerArgs(['start', '--https=false'])).toThrow(/does not take a value/);
  });

  test('--no- on a valued flag rejects instead of dropping the negation', () => {
    expect(() => parseServerArgs(['start', '--no-port', '3000'])).toThrow(/cannot be negated/);
  });

  test('an empty value for a number flag rejects', () => {
    expect(() => parseServerArgs(['start', '--port='])).toThrow(/port/);
  });

  test('a boolean flag never swallows the following command argument', () => {
    const parsed = parseServerArgs(['start', '--https', './app']);
    expect(parsed.flags.https).toBe(true);
    expect(parsed.args).toEqual(['./app']);
  });

  test('a non-numeric value for a number flag rejects loudly', () => {
    expect(() => parseServerArgs(['start', '--port', 'abc'])).toThrow(/port/);
  });

  test('a valued flag with no value rejects loudly', () => {
    expect(() => parseServerArgs(['start', '--port'])).toThrow(/port/);
  });

  test('an unknown flag rejects, naming it', () => {
    expect(() => parseServerArgs(['start', '--bogus'])).toThrow(/bogus/);
  });
});

describe('dispatchServer', () => {
  const handlers = (log) => ({
    start: p => { log.push(['start', p.args[0], p.flags.port]); return 0; },
    stop: () => { log.push(['stop']); return 0; },
    status: () => ({ code: 0, message: 'running' }),
  });

  test('dispatches to the matching command handler with the parsed input', async () => {
    const log = [];
    const result = await dispatchServer(parseServerArgs(['start', './app', '--port', '3000']), handlers(log));
    expect(log).toEqual([['start', './app', 3000]]);
    expect(result.code).toBe(0);
  });

  test('help and version are built in, not required of the handler table', async () => {
    const help = await dispatchServer(parseServerArgs(['help']), {});
    expect(help.code).toBe(0);
    expect(help.message).toContain('rip server');
    const version = await dispatchServer(parseServerArgs(['version']), {}, { version: '1.2.3' });
    expect(version.message).toContain('1.2.3');
  });

  test('an unknown command returns a non-zero code and the usage', async () => {
    const result = await dispatchServer(parseServerArgs(['frobnicate']), handlers([]));
    expect(result.code).toBe(1);
    expect(result.message).toContain('rip server');
  });

  test('a known command with no handler wired returns a clear error and the usage', async () => {
    const result = await dispatchServer(parseServerArgs(['stop']), { start: () => 0 });
    expect(result.code).toBe(1);
    expect(result.message).toMatch(/stop/);
    expect(result.message).toContain('Commands:');
  });

  test('a handler that throws surfaces as a non-zero result, never an unhandled throw', async () => {
    const result = await dispatchServer(parseServerArgs(['start']), { start: () => { throw new Error('port in use'); } });
    expect(result.code).toBe(1);
    expect(result.message).toContain('port in use');
    const strThrow = await dispatchServer(parseServerArgs(['start']), { start: () => { throw 'raw string'; } });
    expect(strThrow.message).toContain('raw string');
  });

  test('an async handler is awaited to its result', async () => {
    const result = await dispatchServer(parseServerArgs(['reload']), { reload: async () => ({ code: 0, message: 'reloaded' }) });
    expect(result).toEqual({ code: 0, message: 'reloaded' });
    const rejected = await dispatchServer(parseServerArgs(['stop']), { stop: async () => { throw new Error('not running'); } });
    expect(rejected.code).toBe(1);
    expect(rejected.message).toContain('not running');
  });
});

describe('serverUsage', () => {
  test('lists the commands and the primary flags', () => {
    const usage = serverUsage();
    for (const command of ['start', 'stop', 'restart', 'reload', 'status', 'list']) {
      expect(usage).toContain(command);
    }
    expect(usage).toContain('--port');
  });
});
