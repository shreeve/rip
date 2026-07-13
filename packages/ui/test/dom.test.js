import { test, expect } from 'bun:test';
import { Document, serialize, toPlainText } from '../email/dom.rip';

test('email DOM owns mutation, serialization, and plain text', () => {
  const document = new Document();
  const root = document.createElement('div');
  const link = document.createElement('a');
  link.setAttribute('href', 'https://example.com');
  link.appendChild(document.createTextNode('Example'));
  root.appendChild(link);

  expect(serialize(root)).toBe('<div><a href="https://example.com">Example</a></div>');
  expect(toPlainText(root)).toBe('Example (https://example.com)');

  link.remove();
  expect(root.childNodes).toEqual([]);
  expect(link.parentNode).toBeNull();
});
