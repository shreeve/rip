// Published Ink, with the two ways a test draws a tree made to remember
// it: `renderToString` records the frame it returns, and `render` leaves
// the tree on the fake stdout, whose `get` records the frame it reads.

import {render as publishedRender, renderToString as publishedRenderToString} from 'ink';
import {describe, record} from './frames.ts';

export * from 'ink';

export const renderToString = (node: any, options?: {columns?: number}): string =>
	record(publishedRenderToString(node, options), options?.columns ?? 80, describe(node));

export const render = (node: any, options?: any) => {
	const stdout = options?.stdout;
	if (stdout) {
		stdout.tree = describe(node);
		stdout.screenReader = options?.isScreenReaderEnabled === true;
	}

	const instance = publishedRender(node, options);
	const {rerender} = instance;
	instance.rerender = (next: any) => {
		if (stdout) {
			stdout.tree = describe(next);
			stdout.rerendered = true;
		}

		return rerender(next);
	};

	return instance;
};
