// Every frame a test reads, in the order it reads them, each with the
// element tree that drew it and the width it was drawn at. The runner
// empties the list before each test and files it with the test's record.

import React from 'react';
import * as ink from 'ink';

export type Tree = string | {type: string; props: Record<string, unknown>; children: Tree[]; via?: string};
export type Frame = {frame: string; columns: number; tree: Tree[]; rerendered: boolean; screenReader: boolean};

export const frames: Frame[] = [];

const names = new Map<unknown, string>([
	[ink.Box, 'Box'],
	[ink.Text, 'Text'],
	[ink.Spacer, 'Spacer'],
	[ink.Newline, 'Newline'],
	[ink.Transform, 'Transform'],
	[ink.Static, 'Static'],
	[React.Fragment, 'Fragment'],
]);

// A React element tree as plain data. A component of the test's own is
// called so its output takes its place; one that cannot be called out
// of a render (it uses hooks, or it is a class) is kept by name.
export const describe = (node: unknown): Tree[] => {
	if (node === null || node === undefined || typeof node === 'boolean') return [];
	if (typeof node === 'string' || typeof node === 'number') return [String(node)];
	if (Array.isArray(node)) return node.flatMap(kid => describe(kid));
	const element = node as React.ReactElement<Record<string, unknown>>;
	const {children, ...rest} = element.props ?? {};
	const name = names.get(element.type);
	if (!name && typeof element.type === 'function') {
		const label = (element.type as {name?: string}).name || 'anonymous';
		try {
			return describe((element.type as (props: unknown) => unknown)(element.props)).map(kid =>
				typeof kid === 'string' ? kid : {...kid, via: kid.via ?? label});
		} catch {
			return [{type: `Unsupported:${label}`, props: {}, children: []}];
		}
	}

	const props: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(rest)) {
		props[key] = typeof value === 'function' ? '[function]' : React.isValidElement(value) ? '[element]' : value;
	}

	if (element.key !== null && element.key !== undefined) props.key = element.key;
	return [{type: name ?? String(element.type), props, children: describe(children)}];
};

// `rerendered` marks a frame drawn by a `rerender` of a mounted tree, and
// `screenReader` one that is Ink's screen-reader text, not a picture.
export const record = (
	frame: string,
	columns: number,
	tree: Tree[],
	rerendered = false,
	screenReader = false,
): string => {
	frames.push({frame, columns, tree, rerendered, screenReader});
	return frame;
};
