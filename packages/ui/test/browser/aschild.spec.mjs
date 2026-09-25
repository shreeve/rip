import { expect, test } from '@playwright/test'
import { focusInside, isModal } from './support.mjs'

// The demo renders every trigger and close part through its own Button
// with `asChild`, so the element the platform facts are asserted
// on is the application's, carrying both the Button's mark and the
// part's.
const hosted = async (locator, part, variant = 'primary') => {
  await expect(locator).toHaveAttribute('data-part', part)
  await expect(locator).toHaveAttribute('type', 'button')
  await expect(locator).toHaveClass(variant === 'primary' ? /bg-accent/ : /bg-input/)
}

for (const { path, name, close } of [
  { path: '/dialog', name: 'Open Dialog', close: 'Close' },
  { path: '/drawer', name: 'Open Drawer', close: 'Close' },
]) {
  test(`${path}: the app's Button is the trigger and the close part; the modal opens, focus lands inside, and Escape returns focus to it`, async ({ page }) => {
    await page.goto(path)
    const trigger = page.getByRole('button', { name })
    await expect(trigger).toBeVisible()
    await hosted(trigger, 'Trigger')
    await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
    expect(await isModal(page)).toBe(false)
    await trigger.focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => isModal(page)).toBe(true)
    expect(await focusInside(page)).toBe(true)
    await expect(trigger).toHaveAttribute('data-popup-open', 'true')
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const closePart = page.getByRole('button', { name: close, exact: true })
    await hosted(closePart, 'Close')
    await expect(closePart).toBeFocused()
    await page.keyboard.press('Escape')
    await expect.poll(() => isModal(page)).toBe(false)
    await expect(trigger).not.toHaveAttribute('data-popup-open')
    await expect(trigger).toBeFocused()
    // The close part closes it too.
    await page.keyboard.press('Enter')
    await expect.poll(() => isModal(page)).toBe(true)
    await closePart.click()
    await expect.poll(() => isModal(page)).toBe(false)
  })
}

test('/menu: the app\'s Button is the menu trigger; the popup anchors under it, says its side, and Escape returns focus to it', async ({ page }) => {
  await page.goto('/menu')
  const trigger = page.getByRole('button', { name: 'Open Menu' })
  const popup = page.locator('main [role="menu"]').first()
  await expect(trigger).toBeVisible()
  await hosted(trigger, 'Trigger')
  await expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
  await expect(trigger).toHaveAttribute('popovertarget', /rip-menu-popup/)
  expect(await trigger.evaluate((el) => el.style.getPropertyValue('anchor-name'))).toMatch(/^--rip-menu-anchor/)
  await trigger.focus()
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => page.evaluate(() => document.querySelector('main [role="menu"]:popover-open') !== null)).toBe(true)
  await expect(page.getByRole('menuitem', { name: 'Dialog', exact: true })).toBeFocused()
  await popup.evaluate((el) => Promise.allSettled(el.getAnimations().map((a) => a.finished)))
  const t = await trigger.boundingBox()
  const p = await popup.boundingBox()
  expect(Math.abs(p.x - t.x)).toBeLessThan(1)
  expect(Math.abs(p.y - (t.y + t.height + 6))).toBeLessThan(1)
  await expect(popup).toHaveAttribute('data-side', 'bottom')
  await expect(trigger).toHaveAttribute('data-popup-open', 'true')
  await page.keyboard.press('Escape')
  await expect.poll(() => page.evaluate(() => document.querySelector(':popover-open'))).toBeNull()
  await expect(trigger).toBeFocused()
  // The input-styled variant hosts the inner triggers the same way.
  const inner = page.getByRole('button', { name: 'Open Dialog' })
  await hosted(inner, 'Trigger', 'secondary')
  await inner.click()
  await expect.poll(() => isModal(page)).toBe(true)
  const innerMenu = page.getByRole('button', { name: 'Open Inner Menu' })
  await hosted(innerMenu, 'Trigger', 'secondary')
  await innerMenu.click()
  await expect.poll(() => page.evaluate(() => document.querySelector('dialog [role="menu"]:popover-open') !== null)).toBe(true)
  await page.keyboard.press('Escape')
  await expect.poll(() => page.evaluate(() => document.querySelector(':popover-open'))).toBeNull()
  expect(await isModal(page)).toBe(true)
})
