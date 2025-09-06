// Location helper functions for our compact array format
// Makes working with [startLine, startCol, endLine, endCol] easy!

export function getLoc(node) {
  if (!node.loc) return null;
  const [startLine, startCol, endLine, endCol] = node.loc;
  return {startLine, startCol, endLine, endCol};
}

export function getStart(node) {
  if (!node.loc) return null;
  return {line: node.loc[0], column: node.loc[1]};
}

export function getEnd(node) {
  if (!node.loc) return null;
  return {line: node.loc[2], column: node.loc[3]};
}

export function formatLoc(loc) {
  if (!loc) return '?:?';
  return `${loc[0]}:${loc[1]}-${loc[2]}:${loc[3]}`;
}

export function getLineCol(node) {
  if (!node.loc) return null;
  return {
    start: {line: node.loc[0], column: node.loc[1]},
    end: {line: node.loc[2], column: node.loc[3]}
  };
}

export function showError(source, node, message) {
  if (!node.loc) {
    console.error(`Error: ${message}`);
    return;
  }

  const [line, col] = node.loc;
  const lines = source.split('\n');
  const errorLine = lines[line - 1];

  console.error(`Error: ${message}`);
  console.error(`  Line ${line}, Column ${col}:`);
  console.error(`    ${errorLine}`);
  console.error(`    ${' '.repeat(col)}^`);
}

export function mergeLocs(start, end) {
  if (!start || !end) return null;
  return [
    start.loc ? start.loc[0] : start[0],
    start.loc ? start.loc[1] : start[1],
    end.loc ? end.loc[2] : end[2],
    end.loc ? end.loc[3] : end[3]
  ];
}

// For nice error messages
export function formatError(source, loc, message) {
  const [line, col] = loc;
  const lines = source.split('\n');
  const errorLine = lines[line - 1] || '';
  const pointer = ' '.repeat(col) + '^';

  return `
Error: ${message}
  at ${formatLoc(loc)}

  ${line} | ${errorLine}
  ${' '.repeat(String(line).length + 3)}${pointer}
`;
}

export default {
  getLoc,
  getStart,
  getEnd,
  formatLoc,
  getLineCol,
  showError,
  mergeLocs,
  formatError
};
