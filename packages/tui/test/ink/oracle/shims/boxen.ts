// The part of boxen Ink's tests lean on: left-aligned text in a border,
// as wide as its widest line or as `width` says, as tall as its lines or
// as `height` says, with an optional border color or a dimmed border.

import cliBoxes from 'cli-boxes';
import stringWidth from 'string-width';
import chalk from 'chalk';

type Options = {
	width?: number;
	height?: number;
	borderStyle?: keyof typeof cliBoxes;
	borderColor?: string;
	dimBorder?: boolean;
};

const boxen = (text: string, options: Options = {}) => {
	const chars = (cliBoxes as any)[options.borderStyle ?? 'single'];
	const lines = text.split('\n');
	while (options.height !== undefined && lines.length < options.height - 2) lines.push('');
	const inner = options.width === undefined
		? Math.max(...lines.map(line => stringWidth(line)))
		: options.width - 2;
	const hue = (s: string) => (options.borderColor ? (chalk as any)[options.borderColor](s) : s);
	const tint = (s: string) => (options.dimBorder ? chalk.dim(hue(s)) : hue(s));
	const rows = lines.map(line =>
		tint(chars.left) + line + ' '.repeat(Math.max(0, inner - stringWidth(line))) + tint(chars.right));
	return [
		tint(chars.topLeft + chars.top.repeat(inner) + chars.topRight),
		...rows,
		tint(chars.bottomLeft + chars.bottom.repeat(inner) + chars.bottomRight),
	].join('\n');
};

export default boxen;
