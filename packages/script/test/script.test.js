import { describe, expect, test } from 'bun:test';
import Script, { prompts, replace, quote, enter } from '@rip-lang/script';

// A 1:1 conversion of v3's test/basic.rip, plus added coverage for the
// surfaces the v3 tests missed (Script.tcp, Script.connect, multiplexer
// value dispatch, timeout behavior). Every expected value was obtained
// by running the v3 implementation, never guessed. Rip symbol literals
// (`:redo`) compile to `Symbol.for(...)`, and Rip map literals (`*{ }`)
// compile to `new Map([...])` — the JS conversions below use those
// compiled forms directly.

const redo = Symbol.for('redo');
const skip = Symbol.for('skip');
const els = Symbol.for('else');
const ths = Symbol.for('this');
const pure = Symbol.for('pure');

const withChat = async (fn, opts = {}) => {
  const chat = await Script.spawn('bash', ['--noprofile', '--norc'], {
    line: '\n',
    live: false,
    slow: 5,
    ...opts,
  });
  try {
    await fn(chat);
  } finally {
    chat.disconnect();
  }
};

// TraceTransport and the trace-mode engine print through
// process.stdout.write; capture it to pin the dry-run transcript.
const captureStdout = async (fn) => {
  const orig = process.stdout.write;
  let buf = '';
  process.stdout.write = (chunk) => {
    buf += chunk;
    return true;
  };
  try {
    await fn();
  } finally {
    process.stdout.write = orig;
  }
  return buf;
};

describe('helper functions', () => {
  test('quote wraps in double quotes', () => {
    expect(quote('hello')).toBe('"hello"');
    expect(quote('SMITH,JOHN')).toBe('"SMITH,JOHN"');
    expect(quote('')).toBe('""');
  });

  test('replace returns a 3-entry Map', () => {
    const m = replace('newvalue');
    expect(m).toBeInstanceOf(Map);
    expect(m.size).toBe(3);
  });

  test('prompts passes through object', () => {
    const obj = prompts({ 'KEY:': ['val'], 'DATE:': '' });
    expect(obj['KEY:'][0]).toBe('val');
    expect(obj['DATE:']).toBe('');
  });

  test('prompts preserves all keys', () => {
    const obj = prompts({ 'A:': '1', 'B:': '2', 'C:': '3' });
    expect(Object.keys(obj).length).toBe(3);
  });
});

describe('control symbols', () => {
  test('control symbols are unique', () => {
    expect(typeof redo).toBe('symbol');
    expect(typeof skip).toBe('symbol');
    expect(typeof els).toBe('symbol');
    expect(typeof ths).toBe('symbol');
    expect(typeof pure).toBe('symbol');
    expect(redo).not.toBe(skip);
    expect(skip).not.toBe(els);
    expect(els).not.toBe(ths);
    expect(ths).not.toBe(pure);
  });

  test('symbols are interned', () => {
    expect(Symbol.for('redo')).toBe(redo);
  });

  test('symbol descriptions match', () => {
    expect(redo.description).toBe('redo');
    expect(skip.description).toBe('skip');
    expect(els.description).toBe('else');
  });
});

describe('multiplexer maps', () => {
  test('a Map multiplexer holds string keys', () => {
    const m = new Map([['a', 1], ['b', 2]]);
    expect(m).toBeInstanceOf(Map);
    expect(m.get('a')).toBe(1);
    expect(m.get('b')).toBe(2);
  });

  test('a Map multiplexer supports regex keys', () => {
    const m = new Map([[/^test/, 'found'], [els, 'fallback']]);
    expect(m).toBeInstanceOf(Map);
    expect(m.size).toBe(2);
  });

  test('a Map multiplexer supports symbol keys', () => {
    const m = new Map([[els, 'fallback'], [redo, 'retry']]);
    expect(m).toBeInstanceOf(Map);
    expect(m.get(els)).toBe('fallback');
    expect(m.get(redo)).toBe('retry');
  });
});

describe('trace mode', () => {
  test('trace mode creates a callable', () => {
    const chat = Script.trace();
    expect(typeof chat).toBe('function');
  });

  test('trace mode returns null for empty list', async () => {
    const chat = Script.trace();
    expect(await chat([])).toBeNull();
  });

  test('trace mode logs expect/send pairs', async () => {
    const chat = Script.trace();
    const out = await captureStdout(() =>
      chat(['prompt>', 'hello', 'result:', 'world']));
    expect(out).toBe(
      'EXPECT: "prompt>"\n  SEND: "hello\\r"\nEXPECT: "result:"\n  SEND: "world\\r"\n');
  });

  test('trace mode handles objects', async () => {
    const chat = Script.trace();
    const out = await captureStdout(() =>
      chat(['prompt>', 'test', { 'option1:': 'a', 'option2:': 'b' }]));
    expect(out).toBe(
      'EXPECT: "prompt>"\n  SEND: "test\\r"\nBRANCH: [option1:, option2:]\n');
  });

  test('trace mode handles conditionals', async () => {
    const chat = Script.trace();
    const out = await captureStdout(() =>
      chat([[true, 'prompt>', 'yes'], [false, 'prompt>', 'no']]));
    expect(out).toBe('EXPECT: "prompt>"\n  SEND: "yes\\r"\n');
  });

  test('trace mode handles nested arrays', async () => {
    const chat = Script.trace();
    const out = await captureStdout(() =>
      chat(['prompt>', 'start', ['inner>', 'nested']]));
    expect(out).toBe(
      'EXPECT: "prompt>"\n  SEND: "start\\r"\nEXPECT: "inner>"\n  SEND: "nested\\r"\n');
  });

  test('trace mode handles functions', async () => {
    let called = false;
    const chat = Script.trace();
    await captureStdout(() =>
      chat(['prompt>', 'test', () => { called = true; return true; }]));
    expect(called).toBeTrue();
  });
});

describe('chat API', () => {
  test('chat exposes buffer property', () => {
    const chat = Script.trace();
    expect(typeof chat.buffer).toBe('string');
    expect(chat.buffer).toBe('');
  });

  test('chat exposes last property', () => {
    const chat = Script.trace();
    expect(chat.last).toBeNull();
  });

  test('chat exposes send method', async () => {
    const chat = Script.trace();
    expect(typeof chat.send).toBe('function');
    const sent = await captureStdout(async () => {
      expect(await chat.send('hello')).toBe('hello');
    });
    expect(sent).toBe('  SEND: "hello\\r"\n');
  });

  test('chat exposes read method', () => {
    const chat = Script.trace();
    expect(typeof chat.read).toBe('function');
  });

  test('chat exposes disconnect method', () => {
    const chat = Script.trace();
    expect(typeof chat.disconnect).toBe('function');
  });
});

describe('spawn integration', () => {
  test('spawn and basic expect/send', () =>
    withChat(async (chat) => {
      await chat([/\$\s*/, 'echo RIPTEST123', 'RIPTEST123', '']);
    }));

  test('spawn captures regex groups', () =>
    withChat(async (chat) => {
      await chat([/\$\s*/, 'echo VERSION=42', /VERSION=(\d+)\n/]);
      expect(chat.last).toBe('42');
    }));

  test('spawn captures multiple regex groups', () =>
    withChat(async (chat) => {
      await chat([/\$\s*/, 'echo NAME=Alice AGE=30', /NAME=(\w+) AGE=(\d+)\n/]);
      expect(chat.last).toBe('Alice');
    }));

  test('spawn with function callback', () =>
    withChat(async (chat) => {
      let captured = null;
      await chat([
        /\$\s*/, 'echo DATA=hello',
        /DATA=(\w+)\n/, (...args) => {
          captured = args[1];
          return true;
        },
      ]);
      expect(captured).toBe('hello');
    }));

  test('spawn with conditional array (true)', () =>
    withChat(async (chat) => {
      await chat([
        /\$\s*/, 'echo START',
        'START', '',
        [true,
          /\$\s*/, 'echo EXTRA',
          'EXTRA', ''],
        /\$\s*/, 'echo DONE',
        'DONE', '',
      ]);
    }));

  test('spawn with conditional array (false skips)', () =>
    withChat(async (chat) => {
      await chat([
        /\$\s*/, 'echo ONLY',
        'ONLY', '',
        [false,
          /\$\s*/, 'echo NEVER',
          'NEVER', ''],
        /\$\s*/, 'echo END',
        'END', '',
      ]);
    }));

  test('spawn with object multiplexer', () =>
    withChat(async (chat) => {
      await chat([
        /\$\s*/, 'echo TESTMUX',
        { TESTMUX: null },
        /\$\s*/, 'echo DONE',
        'DONE', '',
      ]);
    }));

  test('spawn with multi-key multiplexer', () =>
    withChat(async (chat) => {
      await chat([
        /\$\s*/, 'echo BRAVO',
        { ALPHA: 'got-alpha', BRAVO: 'got-bravo' },
      ]);
    }));

  test('spawn multi-step conversation', () =>
    withChat(async (chat) => {
      await chat([
        /\$\s*/, 'echo STEP1',
        'STEP1', '',
        /\$\s*/, 'echo STEP2',
        'STEP2', '',
        /\$\s*/, 'echo STEP3',
        'STEP3', '',
      ]);
    }));

  test('spawn with sub-script array', () =>
    withChat(async (chat) => {
      await chat([
        /\$\s*/, 'echo OUTER',
        'OUTER', '',
        [/\$\s*/, 'echo INNER',
          'INNER', ''],
        /\$\s*/, 'echo AFTER',
        'AFTER', '',
      ]);
    }));

  test('spawn buffer clears after match', () =>
    withChat(async (chat) => {
      await chat([/\$\s*/, 'echo AAA; echo BBB', 'AAA', '']);
      expect(chat.buffer.includes('AAA')).toBeFalse();
    }));

  test('spawn with numeric send', () =>
    withChat(async (chat) => {
      await chat([/\$\s*/, 'cat', null, 42, null, /42\n/]);
    }));

  test('spawn with regex key in Map multiplexer', () =>
    withChat(async (chat) => {
      await chat([
        /\$\s*/, 'echo ITEM=hello',
        new Map([[/ITEM=(\w+)\n/, null]]),
        /\$\s*/, 'echo DONE',
        'DONE', '',
      ]);
    }));

  test('spawn with :skip stops current list', () =>
    withChat(async (chat) => {
      const result = await chat([
        /\$\s*/, 'echo A',
        'A', '',
        /\$\s*/, 'echo B',
        'B', () => skip,
      ]);
      expect(result).toBe(skip);
    }));

  test('spawn with boolean true continues', () =>
    withChat(async (chat) => {
      await chat([
        /\$\s*/, 'echo OK',
        'OK', '',
        true,
        /\$\s*/, 'echo DONE',
        'DONE', '',
      ]);
    }));

  test('spawn with explicit null mode toggle', () =>
    withChat(async (chat) => {
      await chat([
        /\$\s*/, 'echo TOGGLE_TEST',
        'TOGGLE_TEST',
        null,
        '',
        null,
        /\$\s*/, 'echo DONE',
        'DONE', '',
      ]);
    }));

  test('spawn with onMatch callback', async () => {
    const matches = [];
    const chat = await Script.spawn('bash', ['--noprofile', '--norc'], {
      line: '\n',
      live: false,
      slow: 5,
      onMatch: (pattern) => matches.push(pattern),
    });
    try {
      await chat([/\$\s*/, 'echo TRACK', 'TRACK', '']);
      expect(matches.length).toBeGreaterThan(0);
    } finally {
      chat.disconnect();
    }
  });

  test('spawn with onSend callback', async () => {
    const sent = [];
    const chat = await Script.spawn('bash', ['--noprofile', '--norc'], {
      line: '\n',
      live: false,
      slow: 5,
      onSend: (text) => sent.push(text),
    });
    try {
      await chat([/\$\s*/, 'echo TRACED', 'TRACED', '']);
      expect(sent).toContain('echo TRACED');
    } finally {
      chat.disconnect();
    }
  });

  test('spawn with onRecv callback', async () => {
    const chunks = [];
    const chat = await Script.spawn('bash', ['--noprofile', '--norc'], {
      line: '\n',
      live: false,
      slow: 5,
      onRecv: (data) => chunks.push(data),
    });
    try {
      await chat([/\$\s*/, 'echo RECV_TEST', 'RECV_TEST', '']);
      expect(chunks.length).toBeGreaterThan(0);
    } finally {
      chat.disconnect();
    }
  });
});

describe('helper structure', () => {
  test('replace Map has expected keys', () => {
    const m = replace('val');
    const keys = [...m.keys()];
    expect(keys.length).toBe(3);
    expect(typeof keys[0]).toBe('string');
    expect(typeof keys[1]).toBe('string');
    expect(keys[2]).toBe(els);
  });

  test('replace Map entries carry the editing dance', () => {
    const m = replace('VAL');
    expect([...m.entries()]).toEqual([
      ['Replace ', ['...', ' With ', 'VAL', '  Replace ', '']],
      ['// ', 'VAL'],
      [els, 'VAL'],
    ]);
  });

  test("enter returns a Map with 'Are you adding' key", () => {
    const m = enter('test');
    expect(m).toBeInstanceOf(Map);
    expect(m.has('Are you adding')).toBeTrue();
  });

  test('enter merges extra entries', () => {
    const m = enter('test', { 'Confirm:': 'Y' });
    expect(m).toBeInstanceOf(Map);
    expect(m.has('Are you adding')).toBeTrue();
    expect(m.has('Confirm:')).toBeTrue();
    expect(m.get('Confirm:')).toBe('Y');
  });

  // v3 wart, pinned: enter() never uses its `value` argument — the Map
  // carries only the "Are you adding" confirmation (plus any extras).
  test('enter ignores its value argument (v3 wart)', () => {
    const m = enter('test');
    expect(m.size).toBe(1);
    expect(m.get('Are you adding')).toEqual(['Y']);
    expect(enter('test', { 'Confirm:': 'Y' }).size).toBe(2);
  });
});

describe('multiplexer dispatch', () => {
  test(':else fires when nothing matches within the fast window', () =>
    withChat(async (chat) => {
      let hit = null;
      const back = await chat([
        /\$\s*/, 'echo ZZZ',
        new Map([
          ['NOMATCH', 'x'],
          [els, () => { hit = 'else'; return true; }],
        ]),
      ]);
      expect(hit).toBe('else');
      expect(back).toBe(els);
    }));

  test(':this returns the matched text itself', () =>
    withChat(async (chat) => {
      const back = await chat([
        /\$\s*/, 'echo THISTEST',
        { THISTEST: ths },
      ]);
      expect(back).toBe('echo THISTEST');
    }));

  test('a string multiplexer value is sent to the stream', () =>
    withChat(async (chat) => {
      const back = await chat([
        /\$\s*/, 'cat',
        { cat: 'MUXSEND' },
        /MUXSEND\n/,
      ]);
      expect(back).toEqual(['\nMUXSEND\n']);
    }));
});

describe('timeouts', () => {
  test('bomb: true throws on timeout with the buffer attached', () =>
    withChat(async (chat) => {
      let err = null;
      try {
        await chat(['NEVER_APPEARS_XYZ']);
      } catch (e) {
        err = e;
      }
      expect(err).not.toBeNull();
      expect(err.message).toStartWith('Timeout waiting for data');
      expect(err.message).toContain('Buffer:');
    }, { slow: 0.3 }));
});

describe('Script.tcp', () => {
  const listen = (handlers) =>
    Bun.listen({ hostname: '127.0.0.1', port: 0, socket: handlers });

  test('tcp connects and converses over a raw socket', async () => {
    const server = listen({
      open(s) { s.write('login: '); },
      data(s, d) {
        const t = d.toString();
        if (t.includes('alice')) s.write('password: ');
        else if (t.includes('secret')) s.write('welcome> ');
      },
    });
    try {
      const chat = await Script.tcp('127.0.0.1', server.port, {
        live: false,
        slow: 5,
      });
      const back = await chat([
        'login: ', 'alice',
        'password: ', 'secret',
        /welcome(>)/,
      ]);
      expect(back).toEqual(['welcome>', '>']);
      expect(chat.last).toBe('>');
      chat.disconnect();
    } finally {
      server.stop(true);
    }
  });
});

describe('Script.connect', () => {
  test('spawn:// URLs spawn the command', async () => {
    const chat = await Script.connect('spawn://bash', {
      line: '\n',
      live: false,
      slow: 5,
    });
    try {
      await chat([/[$#]\s*/, 'echo CONNECT_OK']);
      await chat(['CONNECT_OK', '']);
    } finally {
      chat.disconnect();
    }
  });

  // v3 wart, pinned: the README shows `Script.connect 'spawn:bash'`,
  // but connect() splits on '://' — the single-colon form is an
  // unknown scheme.
  test('single-colon spawn: URLs are rejected (v3 wart)', async () => {
    expect(Script.connect('spawn:bash')).rejects.toThrow(
      'Unknown scheme: spawn:bash');
  });

  test('unknown schemes are rejected', async () => {
    expect(Script.connect('foo://bar')).rejects.toThrow(
      'Unknown scheme: foo');
  });
});
