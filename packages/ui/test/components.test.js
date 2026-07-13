import { test, expect } from 'bun:test';
import * as email from '../email/email.rip';
import { DoubleCodeInline } from './fixtures/double-code-inline.rip';

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
  expect(() => email.toHTML(email.Font, {
    fontFamily: 'Demo',
    webFontUrl: 'https://example.com/font.woff2',
    fontWeight: '1}*{color:red',
  })).toThrow(/invalid fontWeight/);
});

test('curated URLs reject control-prefixed and protocol-relative schemes', () => {
  for (const href of [
    '\u0001javascript:alert(1)',
    'java\nscript:alert(1)',
    'java%09script:alert(1)',
    '//evil.example/path',
  ]) {
    expect(email.toHTML(email.Link, { href, children: 'unsafe' }))
      .toContain('href="#"');
  }
  expect(email.toHTML(email.Image, {
    src: '\u0001data:text/html,<script>alert(1)</script>',
    alt: 'unsafe',
  })).not.toContain(' src=');
  expect(email.toHTML(email.Image, {
    src: '//evil.example/image.png',
    alt: 'unsafe',
  })).not.toContain(' src=');
  expect(email.toHTML(email.Image, {
    src: 'java%09script:alert(1)',
    alt: 'unsafe',
  })).not.toContain(' src=');

  const markdown = email.toHTML(email.Markdown, {
    text: '[unsafe](\u0001javascript:alert(1))',
  });
  expect(markdown).toContain('href="#"');
  expect(markdown).not.toContain('javascript:');
  expect(email.toHTML(email.Markdown, {
    text: '[unsafe](java%09script:alert(1))',
  })).toContain('href="#"');
});

test('Markdown escapes URLs once and inline code preserves slot content', () => {
  const markdown = email.toHTML(email.Markdown, {
    text: '[good](https://example.com?a=1&b=2)',
  });
  expect(markdown).toContain('href="https://example.com?a=1&amp;b=2"');
  expect(markdown).not.toContain('&amp;amp;');
  expect(email.toHTML(email.Markdown, { text: '#######not-a-heading' }))
    .toContain('<p>#######not-a-heading</p>');

  const code = email.toHTML(email.CodeInline, { children: 'hello' });
  expect(code.match(/hello/g)).toHaveLength(2);
});

test('CodeInline keeps its fallback hidden despite caller display styles', () => {
  const html = email.toHTML(email.CodeInline, {
    children: 'hello',
    style: 'display:inline-block',
  });
  expect(html).toMatch(/<span class="cio" style="[^"]*display:none[^"]*">/);
});

test('email rendering emits shared CodeInline CSS once', () => {
  const html = email.toHTML(DoubleCodeInline);
  expect(html.match(/meta ~ \.cino/g)).toHaveLength(1);
  expect(html).toContain('>first</code>');
  expect(html).toContain('>second</code>');
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
