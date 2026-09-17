// The onEnterRules in language-configuration.json decide whether the
// line after Enter opens a block. `then` and `else` read two ways in
// Rip — the tail of a conditional, or a loose `and` / `or` below
// assignment (`x = get() else fallback()`) — and a tail with an inline
// body (`else p 1`) opens no block either. The rules are regexes over
// the line before the cursor, so this pins the lines they must and
// must not indent after.
import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'fs';
import path from 'node:path';

const config = JSON.parse(readFileSync(
  path.resolve(import.meta.dir, '..', '..', 'language-configuration.json'), 'utf8'));

// VS Code takes the first rule whose beforeText matches (none here use
// afterText or previousLineText).
const indentAfter = (line) => {
  const rule = config.onEnterRules.find((r) => new RegExp(r.beforeText).test(line));
  return rule ? rule.action.indent : 'none';
};

describe('onEnterRules: then / else', () => {
  test('a conditional or tail that opens a block indents', () => {
    for (const line of ['if x', '  unless ready', 'else', '  else', 'else if y', 'else unless z', 'when 1', 'switch v', 'try', 'catch e', 'finally']) {
      expect(indentAfter(line), line).toBe('indent');
    }
  });

  test('an inline body after then opens no block', () => {
    for (const line of ['if x then a', 'when 1 then a = 1', 'else if y then b', 'unless ok then return']) {
      expect(indentAfter(line), line).toBe('none');
    }
  });

  test('an inline else body opens no block', () => {
    for (const line of ['else p 1', '  else return []', 'else a = 2']) {
      expect(indentAfter(line), line).toBe('none');
    }
  });

  test('a connector on its own line opens no block', () => {
    for (const line of ['  else fallback()', 'else throw Error.new("nope")']) {
      expect(indentAfter(line), line).toBe('none');
    }
  });

  test('a same-line connector opens no block', () => {
    for (const line of [
      "str = String(str ?? '').trim() else return []",
      'user = findUser(id) then return user',
      'found else return found',
      'ok then print "ok"',
      '  x = get() then\tprint "ok"',
    ]) {
      expect(indentAfter(line), line).toBe('none');
    }
  });

  test('a bare call line still opens a block', () => {
    for (const line of ['describe "loops"', 'test "it works", ->', 'f = ->', 'App = component']) {
      expect(indentAfter(line), line).toBe('indent');
    }
  });
});
