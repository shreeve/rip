import { expect, test } from '@playwright/test'

// Each test pins what BROWSERS.md records for an engine by driving the
// entry's repro page. A failure is an engine that changed: update the
// entry, and drop its workaround once the engine fixed it.
const repro = (name) => new URL(`../../repro/${name}.html`, import.meta.url).href
const ALL_NONE = ['none', 'none', 'none', 'none', 'none']
// The transition is 2s; the samples at 1700ms and 2500ms straddle its end
// too closely to pin under load.
const kept = (samples) => {
  expect(samples.map((s) => s.display).slice(0, 3)).toEqual(['block', 'block', 'block'])
  expect(samples.at(-1).display).toBe('none')
}
const dropped = (samples) => expect(samples.map((s) => s.display)).toEqual(ALL_NONE)

test('an anchored popover inside a modal is off by the page scroll in WebKit, and placed elsewhere', async ({ page, browserName }) => {
  await page.goto(repro('anchor-in-modal'))
  for (const kind of ['dialog', 'page', 'outside']) {
    const r = await page.evaluate((k) => run(k), kind)
    expect(r.scrollY).toBeGreaterThan(0)
    expect(r.offBy).toBe(browserName === 'webkit' && kind !== 'page' ? -r.scrollY : 0)
  }
})

test('a closed dialog with discrete transitions is kept through them in Chromium and dropped at once elsewhere', async ({ page, browserName }) => {
  await page.goto(repro('dialog-close-transition'))
  for (const kind of ['display', 'both']) {
    const r = await page.evaluate((k) => run(k), kind)
    if (browserName === 'chromium') kept(r.samples)
    else dropped(r.samples)
  }
  const r = await page.evaluate(() => run('neither'))
  dropped(r.samples)
})

test('a hidden popover with discrete transitions is kept in Chromium and dropped at once elsewhere, by script and by light dismiss, and no engine lets the light dismiss be canceled', async ({ page, browserName }) => {
  await page.goto(repro('popover-light-dismiss'))
  const shown = async () => {
    await page.evaluate(() => show())
    await expect(page.locator('#p')).toBeVisible()
  }
  await shown()
  await page.mouse.click(300, 600)
  const light = await page.evaluate(() => result)
  expect(light.cancelable).toBe(false)
  await shown()
  await page.evaluate(() => hide())
  const script = await page.evaluate(() => result)
  for (const r of [light, script]) {
    if (browserName === 'chromium') kept(r.samples)
    else dropped(r.samples)
  }
})

test('inside @starting-style, WebKit computes an unset registered property to nothing and other engines to its initial value', async ({ page, browserName }) => {
  await page.goto(repro('starting-style-registered-property'))
  const unset = await page.evaluate(() => run(false))
  expect(unset.from).toBe(browserName === 'webkit' ? 'none' : '200px')
  const set = await page.evaluate(() => run(true))
  expect(set.from).toBe('200px')
})

test('closedby is honored: Escape under none is refused and a backdrop press under any closes', async ({ page, browserName }) => {
  await page.goto(repro('dialog-closedby'))
  const dialog = page.locator('#d')
  const open = async (value) => {
    const r = await page.evaluate((v) => run(v), value)
    expect(r.supported).toBe(true)
    await expect(dialog).toBeVisible()
  }
  await open('none')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  await expect(dialog).toBeVisible()
  await open('any')
  await page.mouse.click(5, 5)
  await expect(dialog).toBeHidden()
})

test('the element showModal focuses after a mouse click shows a ring in WebKit and none elsewhere, and a ring everywhere after Enter', async ({ page, browserName }) => {
  await page.goto(repro('modal-focus-ring'))
  await page.click('#open')
  expect(await page.evaluate(() => result)).toEqual({ engine: expect.any(String), focused: 'first', ring: browserName === 'webkit' })
  await page.evaluate(() => d.close())
  await page.focus('#open')
  await page.keyboard.press('Enter')
  expect(await page.evaluate(() => result)).toEqual({ engine: expect.any(String), focused: 'first', ring: true })
})

test('a scroll under a still pointer fires enter on the row now under it, and in WebKit a move with no motion', async ({ page, browserName }) => {
  await page.goto(repro('pointer-under-scroll'))
  await page.mouse.move(100, 150)
  await page.mouse.move(120, 160)
  const r = await page.evaluate(() => run())
  expect(r.enter).toBe(1)
  expect(r.moved).toBe(false)
  expect(r.move).toBe(browserName === 'webkit' ? 1 : 0)
})
