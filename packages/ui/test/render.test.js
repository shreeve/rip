import { test, expect } from 'bun:test';
import { BasicEmail, lifecycle } from './fixtures/basic-email.rip';
import { toEmail, toHTML, toText } from '../email/render.rip';

test('email SSR mounts, serializes, disposes, and restores globals', () => {
  const hadDocument = Object.hasOwn(globalThis, 'document');
  const previousDocument = globalThis.document;
  lifecycle.length = 0;

  const html = toHTML(BasicEmail, { message: 'welcome' });
  expect(html).toContain('<!DOCTYPE');
  expect(html).toContain('<h1>Title</h1>');
  expect(html).toContain('<p>welcome</p>');
  expect(lifecycle).toEqual(['effect', 'cleanup']);

  expect(toText(BasicEmail, { message: 'plain' })).toBe('Title\n\nplain');
  expect(toEmail(BasicEmail, { message: 'both' })).toEqual({
    html: expect.stringContaining('<p>both</p>'),
    text: 'Title\n\nboth',
  });

  expect(Object.hasOwn(globalThis, 'document')).toBe(hadDocument);
  expect(globalThis.document).toBe(previousDocument);
});

test('email SSR rejects nested render ownership', () => {
  const hadDocument = Object.hasOwn(globalThis, 'document');
  const previousDocument = globalThis.document;
  globalThis.document = { __ripRenderActive: true };
  try {
    expect(() => toHTML(BasicEmail)).toThrow(/nested or concurrent Rip SSR/);
  } finally {
    if (hadDocument) globalThis.document = previousDocument;
    else delete globalThis.document;
  }
});
