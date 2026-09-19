// Shared fixtures and helpers for the editor-features suites (the
// completions / navigation / rename / actions files), over the one editor
// harness. linkSupport mirrors VS Code: a definition may answer
// LocationLink, and the specifier-origin test depends on it. Identifier
// definitions still answer plain locations either way.
import { inWorkspace as inHarness, decodeSemanticTokens } from './harness.mjs';

export { tsgoAvailable } from './harness.mjs';

export const inWorkspace = (files, fn) => inHarness(files, fn, {
  prefix: 'rip-feat-',
  capabilities: { workspace: { configuration: true }, textDocument: { definition: { linkSupport: true } } },
});

// Apply LSP TextEdits to a text (bottom-up, so earlier offsets stay valid).
export function applyEdits(text, edits) {
  const ls = (() => {
    const starts = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
    return starts;
  })();
  const toOff = ({ line, character }) =>
    line >= ls.length ? text.length : Math.min(ls[line] + character, text.length);
  const ordered = [...edits].sort((a, b) => toOff(b.range.start) - toOff(a.range.start));
  let out = text;
  for (const e of ordered) {
    out = out.slice(0, toOff(e.range.start)) + e.newText + out.slice(toOff(e.range.end));
  }
  return out;
}

// Semantic-token decoding is LSP wire format, shared from the tsgo client

// (`decodeSemanticTokens`) rather than hand-rolled per consumer.
export const decodeTokens = decodeSemanticTokens;

export const CompletionItemKind = { Field: 5, Property: 10 };

export const UTIL = 'export def shout(s: string): string\n  s.toUpperCase()\nexport answer = 42\n';

// Three files around one symbol: util defines `answer`; a and b import
// and use it; app imports a and b (so both join the program unopened).
export const THREE_FILES = {
  'util.rip': 'export answer = 42\n',
  'a.rip': 'import { answer } from "./util.rip"\nexport aa = answer + 1\n',
  'b.rip': 'import { answer } from "./util.rip"\nexport bb = answer + 2\n',
};
export const APP_AB = 'import { aa } from "./a.rip"\nimport { bb } from "./b.rip"\nk = aa + bb\n';
