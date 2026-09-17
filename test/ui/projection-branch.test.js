// A component constructed under a branch inside another component's
// projection reaches its receiver through the block's `ctx`: block
// functions run with the block as `this`, and the receiver is held on
// the component.
import { test, expect } from 'bun:test';
import { compile } from '../../src/compile.js';
import { installRecordingDOM, serialize } from '../support/recording-dom.js';
import * as R from '../../src/runtime/reactive.js';
import * as Cm from '../../src/runtime/components.js';

installRecordingDOM();
const RT = { ...R, ...Cm };
const NAMES = ['__Component', '__state', '__computed', '__effect', '__batch', '__ownerFrame', '__pushOwner', '__popOwner', '__detach', '__transition', '__detachRef', '__pushComponent', '__popComponent'];

const load = (lines) => {
  const { code } = compile(lines.join('\n'), { runtimeDelivery: 'none' });
  return new Function(...NAMES, `${code}\nreturn C;`)(...NAMES.map((n) => RT[n]));
};

test('a branch inside a projection constructs its component under the receiver', () => {
  const C = load([
    'Kid = component',
    "  @label: string := 'kid'",
    '  render',
    '    em "#{@label}"',
    'Box = component',
    '  render',
    '    section',
    '      slot',
    'C = component',
    '  @show: boolean := true',
    '  render',
    '    Box',
    '      if @show',
    "        Kid label: 'inside'",
  ]);
  const target = document.createElement('div');
  const inst = new C({ show: true });
  inst.mount(target);
  expect(serialize(target)).toBe('<div><section data-part="Box"><!--if--><em data-part="Kid">inside</em></section></div>');
  inst._updateProp('show', false);
  expect(serialize(target)).toBe('<div><section data-part="Box"><!--if--></section></div>');
  inst._updateProp('show', true);
  expect(serialize(target)).toBe('<div><section data-part="Box"><!--if--><em data-part="Kid">inside</em></section></div>');
  inst.unmount();
});
