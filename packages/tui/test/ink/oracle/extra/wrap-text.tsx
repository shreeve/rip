// Ink's test/wrap-text.tsx, asked through components. That file calls
// the `wrapText(text, width, mode)` function directly, and it imports a
// cache the published build does not export, so it cannot load here.
// Each call is drawn instead as the tree that reaches the same code:
// a <Text wrap={mode}> inside a <Box width={width}>, held to the literal
// Ink's test holds the function to. Titles are Ink's.
// A style that spans a newline is given as a `color` prop, where Ink's
// test writes the escape sequence into the text. The one case that
// draws a tree of its own, a rerender, goes through Ink's synchronous
// `render`, where Ink's test awaits its concurrent renderer.

import React from 'react';
import test from 'ava';
import {Box, Text, render} from '../src/index.js';
import {renderToString} from './helpers/render-to-string.js';
import createStdout from './helpers/create-stdout.js';

type Wrap = 'wrap' | 'truncate' | 'truncate-end' | 'truncate-middle' | 'truncate-start';

test('changing text wrapping recalculates the container height', t => {
	function Example({truncate}: {readonly truncate: boolean}) {
		return (
			<Box width={7} borderStyle="single">
				<Text wrap={truncate ? 'truncate' : 'wrap'}>abcdefghij</Text>
			</Box>
		);
	}

	const stdout = createStdout();
	const {rerender, unmount} = render(<Example truncate={false} />, {stdout, debug: true});
	t.is(stdout.get(), '┌─────┐\n│abcde│\n│fghij│\n└─────┘');
	rerender(<Example truncate />);
	t.is(stdout.get(), '┌─────┐\n│abcd…│\n└─────┘');
	rerender(<Example truncate={false} />);
	t.is(stdout.get(), '┌─────┐\n│abcde│\n│fghij│\n└─────┘');
	unmount();
});

const wrapped = (text: string, width: number, wrap: Wrap, color?: string) =>
	renderToString(
		<Box width={width}>
			<Text wrap={wrap} color={color}>
				{text}
			</Text>
		</Box>,
	);

test('wraps text', t => {
	t.is(wrapped('hello world', 5, 'wrap'), 'hello\n \nworld');
});

test('truncates text at the end', t => {
	t.is(wrapped('hello world', 5, 'truncate-end'), 'hell…');
});

test('truncates each line of multi-line text separately', t => {
	t.is(wrapped('hello world\nfoo', 6, 'truncate-end'), 'hello…\nfoo');
	t.is(wrapped('foo\nhello world', 6, 'truncate-end'), 'foo\nhello…');
	t.is(wrapped('ab\ncdefgh\nij', 4, 'truncate-end'), 'ab\ncde…\nij');
	t.is(wrapped('hello world\nfoo', 6, 'truncate-middle'), 'hel…ld\nfoo');
	t.is(wrapped('hello world\nfoo', 6, 'truncate-start'), '…world\nfoo');
});

test('truncated multi-line text keeps styles that span a newline', t => {
	t.is(
		wrapped('abcdef\nuvwxyz', 4, 'truncate-end', 'red'),
		'\u001B[31mabc…\u001B[39m\n\u001B[31muvw…\u001B[39m',
	);
});

test('truncated multi-line text keeps its lines in the layout', t => {
	const output = renderToString(
		<Box width={8} borderStyle="single">
			<Text wrap="truncate">{'hello world\nfoo'}</Text>
		</Box>,
	);

	t.is(output, '┌──────┐\n│hello…│\n│foo   │\n└──────┘');
});

// The C1 and colon forms, as Ink's file draws them: through components.
for (const [name, text, expected] of [
	[
		'C1 SGR color',
		'\u009B31mabcdef\nuvwxyz\u009B39m',
		'\u001B[31mabc…\u001B[39m\n\u001B[31muvw…\u001B[39m',
	],
	[
		'C1 OSC hyperlink',
		'\u009D8;;https://example.com\u009Cabcdef\nuvwxyz\u009D8;;\u009C',
		'\u001B]8;;https://example.com\u001B\\abc\u001B]8;;\u001B\\…\n\u001B]8;;https://example.com\u001B\\uvw\u001B]8;;\u001B\\…',
	],
	[
		'colon 256-color',
		'\u001B[38:5:196mabcdef\nuvwxyz\u001B[39m',
		'\u001B[38;5;196mabc…\u001B[39m\n\u001B[38;5;196muvw…\u001B[39m',
	],
	[
		'colon truecolor',
		'\u001B[38:2::255:0:0mabcdef\nuvwxyz\u001B[39m',
		'\u001B[38;2;255;0;0mabc…\u001B[39m\n\u001B[38;2;255;0;0muvw…\u001B[39m',
	],
] as const) {
	test(`truncated multi-line text keeps a ${name} that spans a newline`, t => {
		const output = renderToString(
			<Box width={4}>
				<Text wrap="truncate">{text}</Text>
			</Box>,
		);

		t.is(output, expected);
	});
}

test('uses separate cache entries for different widths', t => {
	t.is(wrapped('hello world', 5, 'truncate-end'), 'hell…');
	t.is(wrapped('hello world', 8, 'truncate-end'), 'hello w…');
});

test('uses separate cache entries for texts that end with digits', t => {
	t.is(wrapped('ab', 12, 'wrap'), 'ab');
	t.is(wrapped('ab1', 2, 'wrap'), 'ab\n1');
});

test('does not reuse a cached result from a wider box', t => {
	renderToString(
		<Box width={15}>
			<Text>一二三四五六七八九十</Text>
		</Box>,
	);

	const output = renderToString(
		<Box width={5}>
			<Text>一二三四五六七八九十1</Text>
		</Box>,
	);

	t.is(output, '一二\n三四\n五六\n七八\n九十1');
});
