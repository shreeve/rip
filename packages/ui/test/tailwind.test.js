import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Document } from '../email/dom.rip';
import { inlineEmailTree } from '../tailwind/tailwind.rip';

test('Tailwind inlines simple classes and preserves unsupported classes', () => {
  const document = new Document();
  const root = document.createElement('__root');
  const html = document.createElement('html');
  const head = document.createElement('head');
  const body = document.createElement('body');
  const paragraph = document.createElement('p');
  paragraph.className = 'text-gray-400 custom-class';
  body.appendChild(paragraph);
  html.appendChild(head);
  html.appendChild(body);
  root.appendChild(html);

  const result = inlineEmailTree(root);
  expect(paragraph.style.color).toBe('var(--color-gray-400)');
  expect(paragraph.className).toBe('custom-class');
  expect(result.unsupported).toEqual(['custom-class']);
  expect(head.childNodes.some((node) => node.tag === 'style')).toBe(true);
});

test('email modules do not import Tailwind dependencies directly', () => {
  for (const file of ['components.rip', 'render.rip', 'dom.rip', 'compat.rip']) {
    const source = readFileSync(new URL(`../email/${file}`, import.meta.url), 'utf8');
    expect(source).not.toMatch(/from ['"](?:tailwindcss|css-tree)['"]/);
  }
});
