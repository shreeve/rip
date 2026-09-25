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
  await swipe(box.width / 2)
  await expect.poll(() => isModal(page)).toBe(false)
  await expect(trigger).not.toHaveAttribute('data-popup-open')
})

// The layout's navigation drawer at phone width holds links, so a swipe
// that begins on one proves the capture: the drawer closes and the link
// does not navigate.
test('a swipe that starts on a link dismisses the drawer without following the link', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await expect.poll(() => isModal(page)).toBe(true)
  const link = page.getByRole('dialog', { name: 'Navigation' }).getByRole('link', { name: 'Dialog' })
  await link.evaluate((el) => Promise.all(el.closest('dialog').getAnimations().map((a) => a.finished)))
  const box = await link.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 - 100, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect.poll(() => isModal(page)).toBe(false)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Rip UI')
})

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
    if (side === 'left') expect(box.left).toBe(0)
    if (side === 'right') expect(Math.abs(box.right - inner.width)).toBeLessThan(1)
    if (side === 'top') expect(box.top).toBe(0)
    if (side === 'bottom') expect(Math.abs(box.bottom - inner.height)).toBeLessThan(1)
    await close.click()
    await expect.poll(() => isModal(page)).toBe(false)
    await expect(popup).toBeHidden()
  }
})
