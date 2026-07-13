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

test('email DOM replacements clear omitted and superseded content', () => {
  const document = new Document();
  const element = document.createElement('div');

  element.setAttribute('style', 'color:red;background:blue');
  element.setAttribute('style', 'color:green');
  expect(serialize(element)).toBe('<div style="color:green"></div>');

  element.innerHTML = '<b>raw</b>';
  element.textContent = 'safe';
  expect(serialize(element)).toBe('<div style="color:green">safe</div>');

  element.innerHTML = '<i>next</i>';
  expect(element.childNodes).toEqual([]);
  expect(serialize(element)).toBe('<div style="color:green"><i>next</i></div>');

  element.removeAttribute('style');
  expect(serialize(element)).toBe('<div><i>next</i></div>');
});

test('email DOM rejects invalid tree mutations and void content', () => {
  const document = new Document();
  const parent = document.createElement('div');
  const first = document.createElement('a');
  const second = document.createElement('b');
  parent.appendChild(first);
  parent.appendChild(second);

  parent.insertBefore(first, first);
  expect(parent.childNodes).toEqual([first, second]);
  expect(() => parent.insertBefore(document.createElement('i'), document.createElement('u')))
    .toThrow(/reference is not a child/);
  expect(() => parent.appendChild(parent)).toThrow(/cannot insert a node into itself/);

  const child = document.createElement('span');
  first.appendChild(child);
  expect(() => child.appendChild(parent)).toThrow(/cannot insert an ancestor/);

  const image = document.createElement('img');
  image.appendChild(document.createTextNode('lost'));
  expect(() => serialize(image)).toThrow(/void element 'img' cannot contain children/);
  image.textContent = '';
  image.innerHTML = '<b>invalid</b>';
  expect(() => serialize(image)).toThrow(/void element 'img' cannot have innerHTML/);
});

test('email DOM rejects markup delimiters in structural names and comments', () => {
  const document = new Document();
  expect(() => document.createElement('div><script')).toThrow(/invalid element name/);

  const element = document.createElement('div');
  expect(() => element.setAttribute('x" onclick="run()', 'value'))
    .toThrow(/invalid attribute name/);

  const comment = document.createComment('safe');
  comment.data = 'x--><script>';
  expect(() => serialize(comment)).toThrow(/invalid comment data/);
});
