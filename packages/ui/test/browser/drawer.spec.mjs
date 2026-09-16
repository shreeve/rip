import { expect, test } from '@playwright/test'
import { isModal } from './support.mjs'

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
  await expect(page.getByText('open: false')).toBeVisible()
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
