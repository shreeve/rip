// A stand-in for `ava` that records instead of judging: every test an
// Ink test file registers lands in `registry`, and running one collects
// each assertion's actual and expected values.

export type Assertion = {kind: string; actual: unknown; expected: unknown; pass: boolean};
export type Entry = {title: string; fn: (t: any) => unknown; skipped: boolean; failing: boolean};

export const registry: Entry[] = [];

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export const context = (asserts: Assertion[]) => {
	const note = (kind: string, actual: unknown, expected: unknown, pass: boolean) => {
		asserts.push({kind, actual, expected, pass});
	};

	const t: any = {
		is: (a: unknown, b: unknown) => note('is', a, b, Object.is(a, b)),
		not: (a: unknown, b: unknown) => note('not', a, b, !Object.is(a, b)),
		deepEqual: (a: unknown, b: unknown) => note('deepEqual', a, b, same(a, b)),
		notDeepEqual: (a: unknown, b: unknown) => note('notDeepEqual', a, b, !same(a, b)),
		true: (a: unknown) => note('true', a, true, a === true),
		false: (a: unknown) => note('false', a, false, a === false),
		truthy: (a: unknown) => note('truthy', a, true, Boolean(a)),
		falsy: (a: unknown) => note('falsy', a, false, !a),
		regex: (a: string, r: RegExp) => note('regex', a, String(r), r.test(a)),
		notRegex: (a: string, r: RegExp) => note('notRegex', a, String(r), !r.test(a)),
		pass: () => note('pass', null, null, true),
		fail: (m?: string) => note('fail', m, null, false),
		throws(fn: () => unknown, expectation?: any) {
			try {
				fn();
			} catch (error) {
				note('throws', (error as Error).message, expectation?.message ?? null, true);
				return error;
			}

			note('throws', null, expectation?.message ?? null, false);
			return undefined;
		},
		notThrows(fn: () => unknown) {
			try {
				fn();
				note('notThrows', null, null, true);
			} catch (error) {
				note('notThrows', (error as Error).message, null, false);
			}
		},
		async throwsAsync(fn: any, expectation?: any) {
			try {
				await (typeof fn === 'function' ? fn() : fn);
			} catch (error) {
				note('throwsAsync', (error as Error).message, expectation?.message ?? null, true);
				return error;
			}

			note('throwsAsync', null, null, false);
			return undefined;
		},
		async notThrowsAsync(fn: any) {
			try {
				await (typeof fn === 'function' ? fn() : fn);
				note('notThrowsAsync', null, null, true);
			} catch (error) {
				note('notThrowsAsync', (error as Error).message, null, false);
			}
		},
		log() {},
		teardown() {},
		timeout() {},
		plan() {},
	};
	return t;
};

// `failing` is ava's mark for a test its authors expect to fail: the
// assertion states the frame they want, and no build draws it.
const register = (skipped: boolean, failing = false) => (title: string, fn: (t: any) => unknown) => {
	registry.push({title, fn, skipped, failing});
};

const test: any = register(false);
test.serial = register(false);
test.failing = register(false, true);
test.skip = register(true);
test.todo = (title: string) => registry.push({title, fn: () => {}, skipped: true, failing: false});
test.only = register(false);
test.serial.skip = register(true);
test.serial.failing = register(false, true);
const hook = () => {};
test.before = hook;
test.after = hook;
test.beforeEach = hook;
test.afterEach = hook;
test.after.always = hook;
test.afterEach.always = hook;
test.serial.before = hook;
test.serial.after = hook;
test.serial.beforeEach = hook;
test.serial.afterEach = hook;

export default test;
