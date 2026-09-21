// Ink's fake stdout (test/helpers/create-stdout.ts), with one addition:
// `get` and the write spy's `lastCall` record the frame they return,
// beside the tree `render` left on the stream.

import EventEmitter from 'node:events';
import {spy} from 'sinon';
import {record} from './frames.ts';

const createStdout = (columns?: number, isTTY?: boolean): any => {
	const stdout: any = new EventEmitter();
	stdout.columns = columns ?? 100;
	stdout.isTTY = isTTY ?? true;

	const write = spy((...arguments_: unknown[]) => {
		const callback = arguments_.at(-1);
		if (typeof callback === 'function') {
			queueMicrotask(callback as () => void);
		}

		return true;
	});
	stdout.write = write;

	// A test that reads the spy's last write reads a frame too.
	Object.defineProperty(write, 'lastCall', {
		get() {
			const args = write.args.at(-1);
			if (typeof args?.[0] === 'string') {
				record(args[0], stdout.columns, stdout.tree ?? [], stdout.rerendered === true, stdout.screenReader === true);
			}

			return {args};
		},
	});

	stdout.get = () =>
		record(
			(write.args as string[][]).findLast(args => args[0]?.length > 0)?.[0] ?? '',
			stdout.columns,
			stdout.tree ?? [],
			stdout.rerendered === true,
			stdout.screenReader === true,
		);

	stdout.getWrites = () => (write.args as string[][]).map(args => args[0]!);

	return stdout;
};

export default createStdout;
