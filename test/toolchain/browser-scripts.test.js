// The script loader's contract, driven through an injectable host:
// document order, one genuinely shared program scope, positioned
// drop-not-abort compile failures, loud duplicates, compiler-owned
// module-form rejection, and the construction-phase CSP posture.
import { describe, expect, test } from 'bun:test';
import { processRipScripts } from '../../src/browser.js';

const makeHost = ({ scripts = [], dataSrc = null, files = {}, blockPrepare = false } = {}) => {
  const reported = [];
  return {
    host: {
      scripts: () => scripts,
      dataSrc: dataSrc ? () => dataSrc : undefined,
      async fetchText(url) {
        if (!(url in files)) throw new Error('404 Not Found');
        return files[url];
      },
      prepare(code, names) {
        if (blockPrepare) throw new EvalError('Refused to evaluate a string as JavaScript');
        return new Function(...names, code);
      },
      report: error => reported.push(error),
    },
    reported,
  };
};

describe('processRipScripts', () => {
  test('runs data-src, inline, and src sources in document order with one scope', async () => {
    globalThis.__order = [];
    const { host } = makeHost({
      dataSrc: ['/lib.rip'],
      files: {
        '/lib.rip': 'shared = 10\nglobalThis.__order.push "lib"',
        '/page.rip': 'globalThis.__order.push "page:#{shared}"',
      },
      scripts: [
        { text: 'later = 32\nglobalThis.__order.push "inline:#{shared + later}"' },
        { src: '/page.rip' },
      ],
    });
    try {
      const result = await processRipScripts(host);
      expect(result.count).toBe(3);
      expect(result.executed).toBeTrue();
      expect(result.failures).toEqual([]);
      expect(globalThis.__order).toEqual(['lib', 'inline:42', 'page:10']);
    } finally {
      delete globalThis.__order;
    }
  });

  test('the page scope is one program: re-spelling assigns, reactive state crosses directly', async () => {
    globalThis.__value = null;
    const { host } = makeHost({
      scripts: [
        { text: 'count := 20\ndouble ~= count * 2' },
        { text: 'count = 21\nglobalThis.__value = double' },
      ],
    });
    try {
      const result = await processRipScripts(host);
      expect(result.failures).toEqual([]);
      expect(globalThis.__value).toBe(42);
    } finally {
      delete globalThis.__value;
    }
  });

  test('a compile failure drops its own script, named and positioned, and the page still runs', async () => {
    globalThis.__ran = [];
    const { host, reported } = makeHost({
      scripts: [
        { text: 'globalThis.__ran.push 1' },
        { text: 'good = 1\nx = ((' },
        { text: 'globalThis.__ran.push 3' },
      ],
    });
    try {
      const result = await processRipScripts(host);
      expect(result.count).toBe(2);
      expect(result.failures.length).toBe(1);
      expect(result.failures[0].label).toBe('<script:2>');
      expect(reported[0].message).toContain('<script:2>:2');
      expect(reported[0].line).toBe(2);
      expect(globalThis.__ran).toEqual([1, 3]);
    } finally {
      delete globalThis.__ran;
    }
  });

  test('a failed fetch is reported and the rest of the page runs', async () => {
    globalThis.__ran = [];
    const { host, reported } = makeHost({
      scripts: [{ src: '/missing.rip' }, { text: 'globalThis.__ran.push "ok"' }],
    });
    try {
      const result = await processRipScripts(host);
      expect(result.count).toBe(1);
      expect(reported[0].message).toContain('/missing.rip');
      expect(globalThis.__ran).toEqual(['ok']);
    } finally {
      delete globalThis.__ran;
    }
  });

  test('duplicate sources reject loudly across spellings; query strings stay distinct', async () => {
    const dup = makeHost({ scripts: [{ src: '/a.rip' }, { src: './a.rip' }], files: { '/a.rip': 'x = 1' } });
    await expect(processRipScripts(dup.host)).rejects.toThrow(/listed more than once/);
    const busted = makeHost({
      scripts: [{ src: '/a.rip' }, { src: '/a.rip?v=1' }],
      files: { '/a.rip': 'x = 1', '/a.rip?v=1': 'y = 2' },
    });
    const result = await processRipScripts(busted.host);
    expect(result.count).toBe(2);
  });

  test('module forms reject at their own script and position; string content is never touched', async () => {
    globalThis.__doc = null;
    const { host, reported } = makeHost({
      scripts: [
        { text: "import { x } from './x.rip'" },
        { text: 'export answer = 42' },
        { text: 'globalThis.__doc = """\n  first line\n  export DATABASE_URL=secret\n  import the goods\n  last line\n"""' },
      ],
    });
    try {
      const result = await processRipScripts(host);
      expect(result.count).toBe(1);
      expect(result.failures.length).toBe(2);
      expect(reported[0].message).toContain('<script:1>');
      expect(reported[0].message).toContain('script tag');
      expect(reported[1].message).toContain('<script:2>');
      expect(reported[1].message).toContain('export keyword');
      expect(globalThis.__doc).toContain('export DATABASE_URL=secret');
      expect(globalThis.__doc).toContain('import the goods');
    } finally {
      delete globalThis.__doc;
    }
  });

  test('a runtime throw is the page’s own error: reported, later statements dead, result returned', async () => {
    globalThis.__ran = [];
    const { host, reported } = makeHost({
      scripts: [
        { text: 'globalThis.__ran.push 1' },
        { text: 'throw new Error "boom at runtime"' },
        { text: 'globalThis.__ran.push 3' },
      ],
    });
    try {
      const result = await processRipScripts(host);
      expect(result.executed).toBeFalse();
      expect(result.failures[0].label).toBe('<runtime>');
      expect(reported[0].message).toBe('boom at runtime');
      expect(globalThis.__ran).toEqual([1]);
    } finally {
      delete globalThis.__ran;
    }
  });

  test('a user EvalError is a runtime error, never a CSP diagnostic', async () => {
    const { host, reported } = makeHost({
      scripts: [{ text: 'throw new EvalError "my own eval problem"' }],
    });
    const result = await processRipScripts(host);
    expect(result.failures[0].label).toBe('<runtime>');
    expect(reported[0].message).toBe('my own eval problem');
  });

  test('a CSP that blocks function construction produces one loud requirement diagnostic', async () => {
    const { host, reported } = makeHost({ scripts: [{ text: 'x = 1' }], blockPrepare: true });
    const result = await processRipScripts(host);
    expect(result.executed).toBeFalse();
    expect(result.failures[0].label).toBe('<evaluate>');
    expect(reported[0].message).toContain("unsafe-eval");
    expect(reported[0].cause).toBeInstanceOf(EvalError);
  });

  test('inline labels are page tag positions, src tags included', async () => {
    const { host, reported } = makeHost({
      scripts: [{ src: '/a.rip' }, { text: 'x = ((' }],
      files: { '/a.rip': 'y = 1' },
    });
    const result = await processRipScripts(host);
    expect(result.failures[0].label).toBe('<script:2>');
    expect(reported.length).toBe(1);
  });

  test('mixed tab and space indentation never dedents dishonestly', async () => {
    globalThis.__mixed = null;
    const { host } = makeHost({
      scripts: [{ text: 'if true\n  globalThis.__mixed = 42' }],
    });
    try {
      await processRipScripts(host);
      expect(globalThis.__mixed).toBe(42);
    } finally {
      delete globalThis.__mixed;
    }
  });

  test('inline indentation is stripped before compiling', async () => {
    globalThis.__dedent = null;
    const { host } = makeHost({
      scripts: [{ text: '\n      x = 40\n      globalThis.__dedent = x + 2\n    ' }],
    });
    try {
      await processRipScripts(host);
      expect(globalThis.__dedent).toBe(42);
    } finally {
      delete globalThis.__dedent;
    }
  });

  test('a host with src sources but no fetchText rejects by name', async () => {
    const { host } = makeHost({ scripts: [{ src: '/a.rip' }] });
    delete host.fetchText;
    await expect(processRipScripts(host)).rejects.toThrow(/fetchText/);
  });

  test('without a host, the browser is required loudly', async () => {
    await expect(processRipScripts()).rejects.toThrow(/browser or an injected host/);
  });
});
