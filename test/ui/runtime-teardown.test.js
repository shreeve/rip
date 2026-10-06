// A view swapped away by an `if` tears down inside that effect's run. A
// read during the teardown — a lifecycle hook, a DOM listener the detach
// fires — must not subscribe the swapping effect, or a later cleanup's
// write re-enters it before it has recorded the swap and the entering
// branch mounts twice.
import { test, expect } from 'bun:test';
import parser from '../../src/parser.js';
import { makeParserLexer } from '../../src/lexer.js';
import { emit } from '../../src/emitter.js';
import { installRecordingDOM, serialize } from '../support/recording-dom.js';
installRecordingDOM();
import * as v4r from '../../src/runtime/reactive.js';
import * as v4c from '../../src/runtime/components.js';
parser.lexer = makeParserLexer();
const RT = { ...v4r, ...v4c, isLive: true };

const run = (source) => {
  const r = parser.parse(source);
  expect(r.diagnostics).toEqual([]);
  const { code } = emit(r, { source, runtimeDelivery: 'none' });
  const env = {};
  for (const [name, value] of Object.entries(RT)) {
    const esc = name.replace(/\$/g, '\\$');
    for (const m of code.matchAll(new RegExp(`\\b${esc}_\\d*\\b`, 'g'))) env[m[0]] = value;
    if (!new RegExp(`\\b(?:let|const|var|function|class)\\s+${esc}\\b`).test(code) && new RegExp(`\\b${esc}\\b`).test(code)) env[name] = value;
  }
  const keys = Object.keys(env);
  return new Function(...keys, `${code}\nreturn { app, mounts };`)(...keys.map((k) => env[k]));
};

const alphas = () => serialize(document.body).split('data-part="Alpha"').length - 1;
const clear = () => { document.body.childNodes.length = 0; };

test('a hook that reads a cell during teardown, followed by a cleanup that writes it, mounts the entering branch once', () => {
  const { app, mounts } = run([
    'mounts = { a: 0 }',
    'Alpha = component',
    '  mounted: -> mounts.a += 1',
    '  render',
    '    div "a"',
    'Beta = component',
    '  y := 1',
    '  z := 0',
    '  beforeUnmount: -> z = y',
    '  ~>',
    '    -> y = 2',
    '  render',
    '    div "b"',
    'App = component',
    '  show := false',
    '  render',
    '    if show',
    '      Alpha',
    '    else',
    '      Beta',
    'app = App.new()',
  ].join('\n'));
  clear();
  app.mount(document.body);
  expect(mounts.a).toBe(0);
  app.show.value = true;
  expect(mounts.a).toBe(1);
  expect(alphas()).toBe(1);
  app.show.value = false;
  expect(alphas()).toBe(0);
});

// The browser fires focusout on a focused element as it is removed; the
// recording DOM does not, so the element's remove dispatches it here.
test('a listener that fires as an effect detaches its element does not subscribe that effect', () => {
  clear();
  const cell = v4r.__state(1);
  const gone = v4r.__state(false);
  let runs = 0;
  const el = document.createElement('input');
  document.body.appendChild(el);
  el.addEventListener('focusout', () => { cell.value; });
  const remove = el.remove;
  el.remove = function () { this.dispatchEvent({ type: 'focusout', bubbles: false }); return remove.call(this); };
  v4r.__effect(() => { runs++; if (gone.value) v4c.__detach(el); });
  expect(runs).toBe(1);
  gone.value = true;
  expect(runs).toBe(2);
  expect(el.parentNode).toBeNull();
  cell.value = 2;
  expect(runs).toBe(2);
});
