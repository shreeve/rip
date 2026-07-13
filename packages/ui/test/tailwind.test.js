import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Document } from '../email/dom.rip';
import {
  configKey,
  inlineEmailTree,
  prepareConfig,
} from '../tailwind/tailwind.rip';

function emailTree(className, style = {}) {
  const document = new Document();
  const root = document.createElement('__root');
  const html = document.createElement('html');
  const head = document.createElement('head');
  const body = document.createElement('body');
  const paragraph = document.createElement('p');
  paragraph.className = className;
  Object.assign(paragraph.style, style);
  body.appendChild(paragraph);
  html.appendChild(head);
  html.appendChild(body);
  root.appendChild(html);
  return { root, head, paragraph };
}

test('Tailwind inlines simple classes and preserves unsupported classes', () => {
  const { root, head, paragraph } = emailTree('text-gray-400 p-4 custom-class');

  const result = inlineEmailTree(root);
  expect(paragraph.style.color).toBe('oklch(70.7% 0.022 261.325)');
  expect(paragraph.style.padding).not.toContain('var(');
  expect(paragraph.className).toBe('custom-class');
  expect(result.unsupported).toEqual(['custom-class']);
  expect(head.childNodes.some((node) => node.tag === 'style')).toBe(true);
});

test('Tailwind applies stylesheet cascade independently of class order', () => {
  const forward = emailTree('p-4 p-2').paragraph;
  const reverse = emailTree('p-2 p-4').paragraph;
  const forwardRoot = forward.parentNode.parentNode.parentNode;
  const reverseRoot = reverse.parentNode.parentNode.parentNode;

  inlineEmailTree(forwardRoot);
  inlineEmailTree(reverseRoot);

  expect(forward.style.padding).toBe(reverse.style.padding);
  expect(forward.style.padding).toContain('*4');
});

test('Tailwind preserves explicit inline precedence', () => {
  const normal = emailTree('text-red-500', { color: 'green' });
  inlineEmailTree(normal.root);
  expect(normal.paragraph.style.color).toBe('green');

  const important = emailTree('!text-red-500', { color: 'green' });
  inlineEmailTree(important.root);
  expect(important.paragraph.style.color).toEndWith('!important');
});

test('Tailwind resolves local variable fallbacks for email clients', () => {
  const { root, paragraph } = emailTree('shadow-md ring-1');
  inlineEmailTree(root);
  expect(paragraph.style.boxShadow).not.toContain('var(');
  expect(paragraph.style.boxShadow).toContain('rgb(0 0 0 / 0.1)');
});

test('Tailwind residual CSS keeps responsive declarations scoped once', () => {
  const { root } = emailTree('sm:text-lg');
  const { headCss } = inlineEmailTree(root);
  expect(headCss).toContain('.sm\\:text-lg');
  expect(headCss.match(/font-size:1\.125rem/g)).toHaveLength(1);
  expect(headCss).not.toMatch(/@media[^{]+\{font-size:/);
});

test('prepared custom configs inline resolved theme values', async () => {
  const config = { theme: { extend: { colors: { brand: '#123456' } } } };
  await prepareConfig(config);
  const { root, paragraph } = emailTree('text-brand');
  inlineEmailTree(root, config);
  expect(paragraph.style.color).toBe('#123456');
});

test('Tailwind cache keys distinguish closure-backed configs', () => {
  const plugin = (color) => () => color;
  const red = { plugins: [plugin('red')] };
  const blue = { plugins: [plugin('blue')] };
  expect(configKey(red)).not.toBe(configKey(blue));
});

test('Tailwind output is independent of earlier renders', () => {
  inlineEmailTree(emailTree('sm:text-lg').root);
  const isolated = inlineEmailTree(emailTree('text-red-500').root);
  expect(isolated.headCss).not.toContain('text-lg');
  expect(isolated.headCss).not.toContain('@media');
});

test('email modules do not import Tailwind dependencies directly', () => {
  for (const file of ['email.rip', 'render.rip', 'dom.rip', 'compat.rip']) {
    const source = readFileSync(new URL(`../email/${file}`, import.meta.url), 'utf8');
    expect(source).not.toMatch(/from ['"](?:tailwindcss|css-tree)['"]/);
  }
});
