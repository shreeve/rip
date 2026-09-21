// What cli-truncate — the bench install's, the version Ink's main branch
// asks for — answers for the CJK row of Ink's test/text-width.tsx at the
// 20 columns its box offers. Ink's main branch draws these rows: its
// measure reserves the whole offered width for truncated text. Published
// Ink 7.1.1 cuts `middle` a second time, at the width of the first cut.
//
//   cd packages/tui/bench && bun ../test/ink/oracle/truncate.ts

import {join, resolve} from 'node:path';

const bench = resolve(import.meta.dir, '../../../bench');
const {default: cliTruncate} = await import(Bun.resolveSync('cli-truncate', bench));
const {default: stringWidth} = await import(Bun.resolveSync('string-width', join(bench, 'node_modules/cli-truncate')));

for (const position of ['end', 'middle', 'start'] as const) {
	const row = cliTruncate('あいうえおかきくけこ|end', 20, {position});
	console.log(position.padEnd(7), JSON.stringify(row), `${stringWidth(row)} columns`);
}
