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
