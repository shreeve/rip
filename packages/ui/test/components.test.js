import { test, expect } from 'bun:test';
import * as email from '../email/email.rip';

test('email public barrel exposes the curated named component surface', () => {
  expect(Object.keys(email).sort()).toEqual([
    'Body', 'Button', 'CodeBlock', 'CodeInline', 'Column', 'Container',
    'Divider', 'Email', 'Font', 'Head', 'Heading', 'Image', 'Link',
    'Markdown', 'Preview', 'Row', 'Section', 'Tailwind', 'Text',
    'toEmail', 'toHTML', 'toText',
  ]);
});

test('curated components render through the public barrel', () => {
  const text = email.toHTML(email.Text, { children: 'hello' });
  expect(text).toContain('style="font-size:14px;line-height:24px;margin:16px 0"');
  expect(text).toContain('>hello</p>');
  expect(email.toHTML(email.Font, { google: 'Inter' }))
    .toContain("@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap')");
});

test('curated email components neutralize unsafe URL and style inputs', () => {
  expect(email.toHTML(email.Link, {
    href: 'javascript:alert(1)',
    children: 'unsafe',
  })).toContain('href="#"');
  expect(email.toHTML(email.Button, {
    href: 'JaVaScRiPt:alert(1)',
    children: 'unsafe',
  })).toContain('href="#"');
  expect(email.toHTML(email.Image, {
    src: 'data:text/html,<svg onload=alert(1)>',
    alt: 'unsafe',
  })).not.toContain(' src=');
  expect(email.toHTML(email.Image, {
    src: 'cid:logo',
    alt: 'logo',
  })).toContain('src="cid:logo"');

  expect(() => email.toHTML(email.Font, {
    fontFamily: 'x</style><img src=x onerror=1><style>',
  })).toThrow(/unsafe fontFamily/);
});

test('Markdown escapes URLs once and inline code preserves slot content', () => {
  const markdown = email.toHTML(email.Markdown, {
    text: '[good](https://example.com?a=1&b=2)',
  });
  expect(markdown).toContain('href="https://example.com?a=1&amp;b=2"');
  expect(markdown).not.toContain('&amp;amp;');

  const code = email.toHTML(email.CodeInline, { children: 'hello' });
  expect(code.match(/hello/g)).toHaveLength(2);
});

test('optional image dimensions remain absent', () => {
  const html = email.toHTML(email.Image, {
    src: 'https://example.com/logo.png',
    alt: 'logo',
  });
  expect(html).not.toContain('width=');
  expect(html).not.toContain('height=');
  expect(html).not.toContain('undefined');
});
