import { expect, test } from '@playwright/test'
import { isModal, pick } from './support.mjs'

const entries = [
  { name: 'the demo drawer', path: '/drawer', popup: 'main dialog', trigger: 'Open Drawer', from: '100%' },
  { name: 'the navigation drawer', path: '/', popup: 'header dialog', trigger: 'Open navigation', from: '-100%', phone: true },
]
for (const { name, path, popup: selector, trigger, from, phone } of entries) {
  test(`opening slides ${name} in from off-screen`, async ({ page }) => {
    if (phone) await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(path)
    const popup = page.locator(selector)
    await popup.evaluate((el) => {
      window.entering = new Promise((resolve) => {
        new MutationObserver((_, observer) => {
          if (!el.open) return
          observer.disconnect()
          requestAnimationFrame(() => resolve(el.getAnimations().map((a) => a.effect.getKeyframes()[0].translate)))
        }).observe(el, { attributeFilter: ['open'] })
      })
    })
    await page.getByRole('button', { name: trigger }).click()
    expect(await page.evaluate(() => window.entering)).toEqual([from])
  })
}

// The demo's drawer sits on the right, so a swipe to the right dismisses.
test('a swipe toward the drawer\'s side dismisses it, and a short one settles back', async ({ page }) => {
  await page.goto('/drawer')
  const trigger = page.getByRole('button', { name: 'Open Drawer' })
  await trigger.click()
  await expect.poll(() => isModal(page)).toBe(true)
  const drawer = page.getByRole('dialog', { name: 'Settings' })
  await expect(drawer).toHaveAttribute('data-side', 'right')
  const settled = () => drawer.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
  await settled()
  const box = await drawer.boundingBox()
  const swipe = async (distance, hold = 0) => {
    await page.mouse.move(box.x + 40, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + 40 + distance, box.y + box.height / 2, { steps: 8 })
    await page.waitForTimeout(hold)
    await page.mouse.up()
  }
  await swipe(box.width / 8, 400)
  await expect.poll(() => isModal(page)).toBe(true)
  await expect.poll(() => page.evaluate(() => document.querySelector('main dialog').style.translate)).toBe('')
  await settled()
  await swipe(box.width * 0.6)
  await expect.poll(() => isModal(page)).toBe(false)
  await expect(trigger).not.toHaveAttribute('data-popup-open')
})

// A finger's swipe, through the Chromium protocol since Playwright's
// touchscreen only taps; WebKit has no such channel.
const touchSwipe = async (page, from, to) => {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
  const point = (x, y) => ({ x, y, radiusX: 4, radiusY: 4, force: 1, id: 1 })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(from.x, from.y)] })
  for (let i = 1; i <= 8; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(from.x + (to.x - from.x) * i / 8, from.y + (to.y - from.y) * i / 8)] })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false })
  await cdp.detach()
}

// The layout's navigation drawer at phone width holds links, so a swipe
// that begins on one proves the capture: the drawer closes and the link
// does not navigate.
test('a touch swipe that starts on a link dismisses the drawer without following the link', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'touch gestures are dispatched through the Chromium protocol')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await expect.poll(() => isModal(page)).toBe(true)
  const link = page.getByRole('dialog', { name: 'Navigation' }).getByRole('link', { name: 'Dialog' })
  await link.evaluate((el) => Promise.all(el.closest('dialog').getAnimations().map((a) => a.finished)))
  const box = await link.boundingBox()
  await touchSwipe(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, { x: box.x + box.width / 2 - 100, y: box.y + box.height / 2 })
  await expect.poll(() => isModal(page)).toBe(false)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Rip UI')
})

test('a mouse drag across the drawer\'s text selects it and does not dismiss', async ({ page }) => {
  await page.goto('/drawer')
  await page.getByRole('button', { name: 'Open Drawer' }).click()
  await expect.poll(() => isModal(page)).toBe(true)
  const text = page.getByRole('dialog', { name: 'Settings' }).getByText('Swipe the panel')
  await text.evaluate((el) => Promise.all(el.closest('dialog').getAnimations().map((a) => a.finished)))
  const box = await text.boundingBox()
  await page.mouse.move(box.x + 4, box.y + box.height / 4)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 4, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(600)
  await expect(page.locator('main dialog')).toHaveAttribute('data-open', 'true')
  expect(await isModal(page)).toBe(true)
  expect((await page.evaluate(() => String(getSelection()))).length).toBeGreaterThan(0)
})

for (const [what, markup, name] of [
  ['a field', '<input aria-label="Note" style="width: 100%">', 'textbox'],
  ['an opted-out region', '<div data-swipe-ignore role="region" aria-label="Chart" style="height: 80px; background: #eee"></div>', 'region'],
]) {
  test(`a swipe that starts on ${what} does not dismiss`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'touch gestures are dispatched through the Chromium protocol')
    await page.goto('/drawer')
    await page.getByRole('button', { name: 'Open Drawer' }).click()
    await expect.poll(() => isModal(page)).toBe(true)
    await page.evaluate((markup) => { document.querySelector('main dialog').lastElementChild.insertAdjacentHTML('beforebegin', markup) }, markup)
    const target = page.getByRole(name, { name: name === 'textbox' ? 'Note' : 'Chart' })
    await target.evaluate((el) => Promise.all(el.closest('dialog').getAnimations().map((a) => a.finished)))
    const box = await target.boundingBox()
    await touchSwipe(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, { x: box.x + box.width / 2 + 200, y: box.y + box.height / 2 })
    await page.waitForTimeout(600)
    await expect(page.locator('main dialog')).toHaveAttribute('data-open', 'true')
    expect(await isModal(page)).toBe(true)
    expect(await page.evaluate(() => document.querySelector('main dialog').style.translate)).toBe('')
  })
}

test('the side control moves the panel to that edge, and the close part closes', async ({ page }) => {
  await page.goto('/drawer')
  const trigger = page.getByRole('button', { name: 'Open Drawer' })
  const popup = page.locator('main dialog')
  const close = page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Close', exact: true })
  for (const [side, from] of [['left', '-100%'], ['top', '0px -100%'], ['bottom', '0px 100%'], ['right', '100%']]) {
    await pick(page, 'side', side)
    await popup.evaluate((el) => {
      window.entering = new Promise((resolve) => {
        new MutationObserver((_, observer) => {
          if (!el.open) return
          observer.disconnect()
          requestAnimationFrame(() => resolve(el.getAnimations().map((a) => a.effect.getKeyframes()[0].translate)))
        }).observe(el, { attributeFilter: ['open'] })
      })
    })
    await trigger.click()
    await expect.poll(() => isModal(page)).toBe(true)
    await expect(popup).toHaveAttribute('data-side', side)
    expect(await page.evaluate(() => window.entering)).toEqual([from])
    const inner = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    const box = await popup.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)).then(() => el.getBoundingClientRect().toJSON()))
    // The panel bleeds 3rem past its edge, so the edge itself sits 48px outside the viewport.
    if (side === 'left') expect(box.left).toBe(-48)
    if (side === 'right') expect(Math.abs(box.right - inner.width - 48)).toBeLessThan(1)
    if (side === 'top') expect(box.top).toBe(-48)
    if (side === 'bottom') expect(Math.abs(box.bottom - inner.height - 48)).toBeLessThan(1)
    await close.click()
    await expect.poll(() => isModal(page)).toBe(false)
    await expect(popup).toBeHidden()
  }
})

test('a swipe in progress reports its progress, and a dismissing release its strength', async ({ page }) => {
  await page.goto('/drawer')
  const trigger = page.getByRole('button', { name: 'Open Drawer' })
  await trigger.click()
  await expect.poll(() => isModal(page)).toBe(true)
  const drawer = page.locator('main dialog')
  await drawer.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
  const read = () => drawer.evaluate((el) => ({
    progress: el.style.getPropertyValue('--swipe-progress'),
    strength: el.style.getPropertyValue('--swipe-strength'),
    backdrop: getComputedStyle(el, '::backdrop').opacity,
    exit: getComputedStyle(el).transitionDuration,
  }))
  expect(await read()).toMatchObject({ progress: '', strength: '1', backdrop: '1', exit: '0.45s' })
  const box = await drawer.boundingBox()
  await page.mouse.move(box.x + 40, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 40 + box.width / 2, box.y + box.height / 2, { steps: 8 })
  const mid = await read()
  expect(Number(mid.progress)).toBeGreaterThan(0.4)
  expect(Number(mid.progress)).toBeLessThan(0.6)
  expect(Math.abs(Number(mid.backdrop) - (1 - Number(mid.progress)))).toBeLessThan(0.02)
  await page.mouse.up()
  await expect.poll(() => isModal(page)).toBe(false)
  const after = await read()
  expect(Number(after.strength)).toBeGreaterThan(0)
  expect(Number(after.strength)).toBeLessThan(1)
  expect(after.progress).toBe('')
  expect(parseFloat(after.exit)).toBeCloseTo(Number(after.strength) * 0.4, 2)
  await trigger.click()
  await expect.poll(() => isModal(page)).toBe(true)
  expect((await read()).strength).toBe('1')
  // A rest before the release makes it a slow one however it began.
  await drawer.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
  await page.mouse.move(box.x + 40, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 40 + box.width * 0.6, box.y + box.height / 2, { steps: 8 })
  await page.waitForTimeout(1200)
  await page.mouse.up()
  await expect.poll(() => isModal(page)).toBe(false)
  expect(await read()).toMatchObject({ strength: '1', exit: '0.4s' })
})

test('a pull into the screen moves the panel by less than the pull, and it springs back on release', async ({ page }) => {
  await page.goto('/drawer')
  await page.getByRole('button', { name: 'Open Drawer' }).click()
  await expect.poll(() => isModal(page)).toBe(true)
  const drawer = page.locator('main dialog')
  await drawer.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
  const box = await drawer.boundingBox()
  const rest = box.x
  await page.mouse.move(box.x + 40, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 40 - 120, box.y + box.height / 2, { steps: 8 })
  const pulled = rest - (await drawer.boundingBox()).x
  expect(pulled).toBeGreaterThan(5)
  expect(pulled).toBeLessThan(48)
  expect(await drawer.evaluate((el) => el.style.getPropertyValue('--swipe-progress'))).toBe('0')
  await page.mouse.up()
  await expect.poll(() => drawer.evaluate((el) => el.style.translate)).toBe('')
  await expect.poll(async () => Math.abs((await drawer.boundingBox()).x - rest)).toBeLessThan(1)
  expect(await isModal(page)).toBe(true)
  await expect(drawer).toHaveAttribute('data-open', 'true')
})
