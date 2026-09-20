// The element writer's rules in a real browser (fixture/elements.rip): what
// an element carries for a value the page passes, on every road — a plain
// render line, a key forwarded through `extends <tag>`, one forwarded
// through `extends <Component>`, and a two-way binding. The recording DOM
// the Node suites run on reflects no properties, so these hold only here.
import { expect, test } from '@playwright/test';

const boot = async (page) => {
  await page.goto('/elements.html');
  await expect.poll(() => page.evaluate(() => globalThis.__bootResult)).toBe('ok');
  await expect(page.locator('#bind-cell')).toBeAttached();
};
// The element as `<tag a="1" b="2">`, its attributes sorted and the ids the
// page minted left out, so a wrapper and its plain twin compare as one
// string whatever order each road wrote them in.
const tag = (page, id) => page.locator(`#${id}`).evaluate((el) => {
  const attrs = [...el.attributes].filter((a) => a.name !== 'id' && a.name !== 'data-part').map((a) => ` ${a.name}="${a.value}"`).sort();
  return `<${el.localName}${attrs.join('')}>`;
});
const valueOf = (page, id) => page.locator(`#${id}`).evaluate((el) => el.value);
const click = async (page, id) => { await page.click(`#${id}`); await page.waitForTimeout(50); };

test('a nullish value is absence: a forwarded key agrees with the plain line through undefined, a value, and undefined again', async ({ page }) => {
  await boot(page);
  const agree = async () => {
    expect(await tag(page, 'wrap-a')).toBe(await tag(page, 'plain-a'));
    expect(await tag(page, 'wrap-input')).toBe(await tag(page, 'plain-input'));
    expect(await valueOf(page, 'wrap-input')).toBe(await valueOf(page, 'plain-input'));
  };
  await agree();
  // `false` is the word on any attribute that is not a boolean one: an
  // absent `aria-pressed` says "not a toggle", and an empty one is invalid.
  expect(await tag(page, 'wrap-a')).toBe('<a aria-pressed="false" data-on="false" draggable="false">');
  expect(await valueOf(page, 'wrap-input')).toBe('');
  await click(page, 'press');
  await agree();
  expect(await tag(page, 'wrap-a')).toBe('<a aria-pressed="true" data-on="true" draggable="true">');
  await click(page, 'press');
  await click(page, 'nullish-set');
  await agree();
  expect(await tag(page, 'wrap-a')).toBe('<a aria-pressed="false" data-on="false" draggable="false" hidden="" lang="hello" title="hello">');
  expect(await valueOf(page, 'wrap-input')).toBe('hello');
  expect(await tag(page, 'wrap-input')).toBe('<input disabled="" placeholder="hello">');
  await click(page, 'nullish-unset');
  await agree();
  expect(await tag(page, 'wrap-a')).toBe('<a aria-pressed="false" data-on="false" draggable="false">');
  expect(await tag(page, 'wrap-input')).toBe('<input>');
  expect(await valueOf(page, 'wrap-input')).toBe('');
});

test("a key the host line sets is the line's, for a fixed or reactive caller value, through a component host too", async ({ page }) => {
  await boot(page);
  const read = async (id) => [await page.locator(`#${id}`).getAttribute('type'), await page.locator(`#${id}`).getAttribute('title')];
  expect(await read('owned-fixed')).toEqual(['button', 'fixed']);
  expect(await read('owned-reactive')).toEqual(['button', 'submit']);
  expect(await read('owned-host')).toEqual(['button', 'submit']);
  await click(page, 'owned-change');
  expect(await read('owned-fixed')).toEqual(['button', 'fixed']);
  expect(await read('owned-reactive')).toEqual(['button', 'reset']);
  expect(await read('owned-host')).toEqual(['button', 'reset']);
});

test('a reactive name passed for an undeclared key reads as its value inside the component, live', async ({ page }) => {
  await boot(page);
  const read = (id) => page.locator(`#${id}`).evaluate((el) => [el.dataset.typeof, el.dataset.is, el.dataset.fallback, el.dataset.text, el.getAttribute('title')]);
  for (const id of ['probe-literal', 'probe-state', 'probe-computed', 'probe-module', 'probe-wrapped']) {
    expect(await read(id), id).toEqual(['string', 'true', 'x', 'x', 'x']);
  }
  expect(await read('probe-empty')).toEqual(['undefined', 'false', 'fallback', 'undefined', null]);
  await click(page, 'reactive-change');
  for (const id of ['probe-state', 'probe-computed', 'probe-wrapped']) {
    expect(await read(id), id).toEqual(['string', 'false', 'y', 'y', 'y']);
  }
  expect(await read('probe-literal')).toEqual(['string', 'true', 'x', 'x', 'x']);
  expect(await read('probe-module')).toEqual(['string', 'true', 'x', 'x', 'x']);
});

test('a cleared field is the empty string both ways: a cell set to undefined empties the field, a field the user clears writes ""', async ({ page }) => {
  await boot(page);
  expect(await valueOf(page, 'bound')).toBe('hello');
  expect(await valueOf(page, 'oneway')).toBe('hello');
  await click(page, 'bind-clear');
  expect(await valueOf(page, 'bound')).toBe('');
  expect(await valueOf(page, 'oneway')).toBe('');
  await page.fill('#bound', 'typed');
  await expect(page.locator('#bind-cell')).toHaveText('"typed"');
  await page.fill('#bound', '');
  await expect(page.locator('#bind-cell')).toHaveText('""');
});
