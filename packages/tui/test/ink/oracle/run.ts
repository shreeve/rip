// Runs Ink's own test files against the published Ink installed under
// packages/tui/bench and records what each assertion saw.
//
//   cd packages/tui/bench && bun ../test/ink/oracle/run.ts borders [more…]
//
// React's development build is the one that runs (NODE_ENV unset): the
// async helpers in Ink's tests need `act`, which production React omits.
//
// Each named file is read from misc/ink/test/<name>.tsx, unless
// extra/<name>.tsx stands in for it (a file that cannot load against
// the published build, asked through components instead). Imports are
// redirected: `ava`, `boxen`, `delay`, `sinon` and its fake timers to
// the shims beside this file, Ink's `../src/*` to the published build
// (its index through shims/ink.ts, its fake stdout and pty helper
// through their shims), and every bare specifier to the bench install.
// One JSON document per file is written to test/ink/oracle/out/<name>.json:
//
//   [{ title, skipped, failing, error,
//      frames:  [{ frame, columns, tree, rerendered, screenReader }],
//      asserts: [{ kind, actual, expected, pass }] }]
//
// `frames` holds every frame the test read, in order, escape sequences
// and all — also where the test itself only asserts on stripped text —
// each with the element tree that drew it, as plain data. `error` names
// a test that threw or hung and was left out of the run that finished.
// `actual` is what published Ink drew; `expected` is what the test on
// Ink's main branch asked for. `pass: false` marks a case where the two
// disagree, which is where main is ahead of the published build.

import {plugin} from 'bun';
import {existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';

// Colors are forced before chalk loads, so the recorded frames carry
// their SGR sequences whatever this process's stdout is.
process.env.FORCE_COLOR = '3';

const here = import.meta.dir;
const root = resolve(here, '../../../../..');
const bench = join(root, 'packages/tui/bench');
const inkTests = join(root, 'misc/ink/test');
const inkBuild = join(bench, 'node_modules/ink/build');
const extra = join(here, 'extra');
const shims: Record<string, string> = {
	ava: join(here, 'shims/ava.ts'),
	boxen: join(here, 'shims/boxen.ts'),
	sinon: join(here, 'shims/sinon.ts'),
	'@sinonjs/fake-timers': join(here, 'shims/fake-timers.ts'),
	delay: join(here, 'shims/delay.ts'),
};

// Where an import written in one of Ink's test files (or in a shim)
// really lives. A file under extra/ resolves as if it sat in Ink's test
// directory.
const locate = (specifier: string, from: string): string => {
	const importer = from.startsWith(extra) ? join(inkTests, basename(from)) : from;
	if (shims[specifier]) return shims[specifier]!;
	if (importer.startsWith(inkTests)) {
		if (/(^|\/)create-stdout\.js$/.test(specifier)) return join(here, 'shims/create-stdout.ts');
		if (/(^|\/)helpers\/run\.js$/.test(specifier)) return join(here, 'shims/run.ts');
		const source = /^(?:\.\.\/)+src\/(.*)$/.exec(specifier);
		if (source) return source[1] === 'index.js' ? join(here, 'shims/ink.ts') : join(inkBuild, source[1]!);
	}

	if (specifier.startsWith('node:')) return specifier;
	if (specifier.startsWith('.')) {
		const path = resolve(dirname(importer), specifier);
		return importer.startsWith(inkTests) ? path.replace(/\.js$/, '.ts') : path;
	}

	return Bun.resolveSync(specifier, bench);
};

// Ink's tests are written for the classic JSX transform (`React` is
// imported by hand), and the runtime resolves a module's static imports
// without asking a plugin, so each file is transpiled here and its
// import specifiers are rewritten to absolute paths.
const classic = new Bun.Transpiler({
	loader: 'tsx',
	tsconfig: {compilerOptions: {jsx: 'react'}},
});

plugin({
	name: 'ink-oracle',
	setup(build) {
		build.onLoad({filter: /(misc\/ink\/test|test\/ink\/oracle\/(shims|extra))\/.*\.tsx?$/}, async args => {
			const code = classic.transformSync(await Bun.file(args.path).text());
			const contents = code.replace(
				/(\bfrom\s*|\bimport\s*\(?\s*)(["'])([^"'\n]+)\2/g,
				(_, lead, quote, specifier) => `${lead}${quote}${locate(specifier, args.path)}${quote}`,
			);
			return {contents, loader: 'js'};
		});
	},
});

// React's advice about `act` is noise here. IS_REACT_ACT_ENVIRONMENT
// stays unset on purpose: with it set, a synchronous render outside
// `act` is queued rather than flushed, and Ink's `renderToString`
// returns an empty frame.
const complain = console.error;
console.error = (...args: unknown[]) => {
	if (!/act\(/.test(String(args[0]))) complain(...args);
};

const names = process.argv.slice(2);
if (names.length === 0) {
	console.error('usage: bun run.ts <ink test file base name>…');
	process.exit(2);
}

const {registry, context} = await import(shims.ava!);
const {frames} = await import(join(here, 'shims/frames.ts'));
mkdirSync(join(here, 'out'), {recursive: true});

// A test that throws inside published Ink can leave the reconciler
// wedged, and every later frame in the process comes back empty; a test
// that waits on a terminal never returns. So each file runs in a child
// process that stops at the first test to throw or to outlast its
// allowance, and the parent starts a fresh child with that test left
// out, until a child finishes the file.
const ALLOWANCE = 5000;
const poisonFile = (name: string) => join(here, 'out', `${name}.poisoned.json`);
const runningFile = (name: string) => join(here, 'out', `${name}.running.txt`);
const poisoned: Record<string, string> = JSON.parse(process.env.ORACLE_POISONED ?? '{}');

if (process.env.ORACLE_CHILD) {
	const name = names[0]!;
	const own = join(extra, `${name}.tsx`);
	await import(existsSync(own) ? own : join(inkTests, `${name}.tsx`));
	const report = [];
	for (const entry of [...registry]) {
		const asserts: unknown[] = [];
		frames.length = 0;
		let error: string | null = poisoned[entry.title] ?? null;
		if (!entry.skipped && error === null) {
			if (process.env.ORACLE_DEBUG) console.error(`running: ${entry.title}`);
			writeFileSync(runningFile(name), entry.title);
			try {
				await Promise.race([
					entry.fn(context(asserts)),
					new Promise((_, reject) => {
						setTimeout(() => reject(new Error(`no answer in ${ALLOWANCE} ms`)), ALLOWANCE);
					}),
				]);
			} catch (caught) {
				error = String((caught as Error)?.message ?? caught);
				// An Ink app left mounted can hold `process.exit` in its exit
				// handlers for good, so the child names the test in a file
				// and ends itself outright.
				writeFileSync(poisonFile(name), JSON.stringify({title: entry.title, error}));
				process.kill(process.pid, 'SIGKILL');
			}
		}

		report.push({title: entry.title, skipped: entry.skipped, failing: entry.failing, error, frames: structuredClone(frames), asserts});
	}

	writeFileSync(join(here, 'out', `${name}.json`), JSON.stringify(report, null, '\t') + '\n');
	process.kill(process.pid, 'SIGKILL');
}

for (const name of names) {
	const left: Record<string, string> = {};
	const started = Date.now() - 1000;
	for (;;) {
		const child = Bun.spawnSync([process.execPath, import.meta.path, name], {
			cwd: process.cwd(),
			env: {...process.env, ORACLE_CHILD: '1', ORACLE_POISONED: JSON.stringify(left)},
			stdout: 'pipe',
			stderr: process.env.ORACLE_DEBUG ? 'inherit' : 'pipe',
			timeout: 90_000,
		});
		const last = existsSync(runningFile(name)) ? readFileSync(runningFile(name), 'utf8') : null;
		if (last !== null) rmSync(runningFile(name));
		if (existsSync(poisonFile(name))) {
			const {title, error} = JSON.parse(readFileSync(poisonFile(name), 'utf8'));
			rmSync(poisonFile(name));
			left[title] = error;
			continue;
		}

		// A child that ran out its time was held inside one test, which
		// never gave the event loop back for its allowance to be judged.
		if (child.exitedDueToTimeout && last !== null && !(last in left)) {
			left[last] = 'held the process until the oracle stopped it';
			continue;
		}

		const written = join(here, 'out', `${name}.json`);
		if (existsSync(written) && statSync(written).mtimeMs >= started) {
			const report = JSON.parse(readFileSync(written, 'utf8'));
			const agreed = report.filter((r: any) => !r.error && r.asserts.every((a: any) => a.pass)).length;
			const threw = report.filter((r: any) => r.error).length;
			console.log(`${name}: ${report.length} tests, ${agreed} agree with main's expectations, ${threw} threw or hung`);
		} else {
			console.log(`${name}: cannot load against the published build — ${child.stderr?.toString().trim().split('\n')[0] ?? 'see above'}`);
		}

		break;
	}
}

process.exit(0);
