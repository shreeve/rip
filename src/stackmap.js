// Display-time stack-frame remapping for compiled .rip modules.
//
// Bun (measured on 1.3.14) never consults plugin-supplied source maps
// when it materializes runtime stack traces: frames for a plugin-loaded
// module carry the module's path (the .rip file) but GENERATED-JS
// line/col. Only Bun's internal transpiler maps (TS/JSX) are applied;
// inline `sourceMappingURL` comments — whether emitted by an onLoad
// plugin or present in a plain .js file — are ignored. We own the
// mappings and they are verified
// exact, so the run harness (src/run.js) remaps frames itself before
// printing: the loader registers each compiled module's map here, and
// `remapStack` rewrites `path.rip:line:col` frame positions from
// generated to source coordinates.
//
// Frames for unregistered files pass through untouched — so do frames
// on generated lines that carry no mapping segment (nothing to claim
// about them; inventing a position would be worse than showing none).

import { decodeMappings } from './sourcemap.js';

const registry = new Map();

export function registerModuleMap(path, map) {
  registry.set(path, { map, segments: null });
}

const segmentsFor = (entry) =>
  (entry.segments ??= decodeMappings(entry.map.mappings).filter((s) => s.srcLine !== undefined));

// `<path>:<line>[:<col>]` → source coordinates, or null when the path
// has no registered map or the generated line carries no segment.
// Line/col are 1-based on both sides (V8-style frames); the segment
// lookup is the standard floor: the last segment on the generated line
// at-or-before the column. A position with no column (Bun omits it on
// some frames) remaps by line alone and stays column-less.
const remapPosition = (path, lineStr, colStr) => {
  const entry = registry.get(path);
  if (entry === undefined) return null;
  const genLine = Number(lineStr) - 1;
  const onLine = segmentsFor(entry).filter((s) => s.genLine === genLine);
  if (onLine.length === 0) return null;
  if (colStr === undefined) return `${path}:${onLine[0].srcLine + 1}`;
  const genCol = Number(colStr) - 1;
  let best = onLine[0];
  for (const s of onLine) {
    if (s.genCol <= genCol) best = s;
    else break;
  }
  return `${path}:${best.srcLine + 1}:${best.srcCol + 1}`;
};

// V8 frame shapes, location anchored at the end of the line:
//
//     at name (path:line:col)
//     at path:line:col
//
// The path spans from the location start to the trailing `:line[:col]`,
// so paths containing spaces (or anything else) need no guessing.
const FRAME_PAREN = /^(\s+at .*?\()(.+?):(\d+)(?::(\d+))?\)$/;
const FRAME_BARE = /^(\s+at (?:async )?)(.+?):(\d+)(?::(\d+))?$/;

// Rewrite frame locations from generated to source coordinates, one
// stack line at a time. Only lines with V8 frame shape are touched —
// message lines pass through byte-identical even when they contain a
// registered `path:line:col` literal. Frames for unregistered files,
// and frame shapes we don't recognize, pass through untouched.
export function remapStack(stack) {
  return stack
    .split('\n')
    .map((line) => {
      const paren = FRAME_PAREN.exec(line);
      const m = paren ?? FRAME_BARE.exec(line);
      if (m === null) return line;
      const [, head, path, lineStr, colStr] = m;
      const remapped = remapPosition(path, lineStr, colStr);
      if (remapped === null) return line;
      return paren !== null ? `${head}${remapped})` : `${head}${remapped}`;
    })
    .join('\n');
}
