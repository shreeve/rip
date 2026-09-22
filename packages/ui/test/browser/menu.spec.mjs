import { expect, test } from '@playwright/test'
import { isModal } from './support.mjs'

const parts = (page) => ({
  trigger: page.getByRole('button', { name: 'Open Menu' }),
  popup: page.locator('main [role="menu"]').first(),
  fromParent: page.getByRole('button', { name: 'Open from the Parent' }),
  item: (name) => page.getByRole('menuitem', { name, exact: true }),
})
// The popover's own show and hide run listeners with the stack empty,
// so a call from a microtask lands inside them and throws: every test
// fails on a page error.
let errors = []
test.beforeEach(({ page }) => {
  errors = []
  page.on('pageerror', (e) => errors.push(e.message))
})
test.afterEach(() => expect(errors).toEqual([]))
const boot = async (page) => {
  await page.goto('/menu')
  await expect(parts(page).trigger).toBeVisible()
  return parts(page)
}
const isOpen = (page) => page.evaluate(() => document.querySelector('main [role="menu"]:popover-open') !== null)
const focusedRole = (page) => page.evaluate(() => document.activeElement?.getAttribute('role'))
const settled = (popup) => popup.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))

// The demo popup's margin above is 6px; below the trigger, left edges
// aligned, is the package's own placement.
const anchored = async (page) => {
  const { trigger, popup } = parts(page)
  await settled(popup)
  const t = await trigger.boundingBox()
  const p = await popup.boundingBox()
  expect(Math.abs(p.x - t.x)).toBeLessThan(1)
  expect(Math.abs(p.y - (t.y + t.height + 6))).toBeLessThan(1)
}

test('the trigger opens a popover menu under itself, focus lands on the popup, and the state shows on both parts', async ({ page }) => {
  const { trigger, popup } = await boot(page)
  expect(await isOpen(page)).toBe(false)
  await expect(popup).toHaveAttribute('popover', 'auto')
  await trigger.click()
  await expect.poll(() => isOpen(page)).toBe(true)
  await expect(page.getByRole('menu', { name: 'Open Menu' })).toBeVisible()
  await expect.poll(() => focusedRole(page)).toBe('menu')
  await expect(popup).toHaveAttribute('data-open', 'true')
  await expect(popup).not.toHaveAttribute('data-closed')
  await expect(trigger).toHaveAttribute('data-popup-open', 'true')
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByText('open: true')).toBeVisible()
  await anchored(page)
})

test('ArrowDown on the trigger opens with the first item focused, the arrows wrap, Home and End jump, and Escape closes and returns focus to the trigger', async ({ page }) => {
  const { trigger, popup, item } = await boot(page)
  await trigger.focus()
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => isOpen(page)).toBe(true)
  await expect(item('Dialog')).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(item('Sign Out')).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(item('Dialog')).toBeFocused()
  await page.keyboard.press('End')
  await expect(item('Sign Out')).toBeFocused()
  await page.keyboard.press('Home')
  await expect(item('Dialog')).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(item('Settings')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect.poll(() => isOpen(page)).toBe(false)
  await expect(page.getByText('open: false')).toBeVisible()
  await expect(popup).not.toHaveAttribute('data-open')
  await expect(popup).toHaveAttribute('data-closed', 'true')
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await expect(trigger).toBeFocused()
})

test('ArrowUp on the trigger opens with the last item focused; Enter and Space open with the first', async ({ page }) => {
  const { trigger, item } = await boot(page)
  await trigger.focus()
  await page.keyboard.press('ArrowUp')
  await expect(item('Sign Out')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  for (const key of ['Enter', 'Space']) {
    await page.keyboard.press(key)
    await expect.poll(() => isOpen(page)).toBe(true)
    await expect(item('Dialog')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect.poll(() => isOpen(page)).toBe(false)
    await expect(trigger).toBeFocused()
  }
})

test('Enter on an item selects it and closes; Space on a link follows it', async ({ page }) => {
  const { trigger, item } = await boot(page)
  await trigger.focus()
  await page.keyboard.press('ArrowDown')
  await expect(item('Dialog')).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(item('Settings')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByText('selected: Settings')).toBeVisible()
  await expect.poll(() => isOpen(page)).toBe(false)
  await expect(trigger).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(item('Dialog')).toBeFocused()
  await page.keyboard.press('Space')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dialog')
  expect(await page.evaluate(() => document.querySelector(':popover-open'))).toBeNull()
})

test('a click outside closes it, and a click on the trigger while open closes it instead of reopening, however it was opened', async ({ page }) => {
  const { trigger, fromParent } = await boot(page)
  await trigger.click()
  await expect.poll(() => isOpen(page)).toBe(true)
  await page.getByRole('heading', { level: 1 }).click()
  await expect.poll(() => isOpen(page)).toBe(false)
  await expect(page.getByText('open: false')).toBeVisible()
  await trigger.click()
  await expect.poll(() => isOpen(page)).toBe(true)
  await trigger.click()
  await expect.poll(() => isOpen(page)).toBe(false)
  await page.waitForTimeout(300)
  expect(await isOpen(page)).toBe(false)
  await expect(page.getByText('open: false')).toBeVisible()
  await fromParent.click()
  await expect.poll(() => isOpen(page)).toBe(true)
  await trigger.click()
  await expect.poll(() => isOpen(page)).toBe(false)
  await page.waitForTimeout(300)
  expect(await isOpen(page)).toBe(false)
})

test('Tab closes it and moves focus on past the menu', async ({ page }) => {
  const { trigger, item, fromParent } = await boot(page)
  await trigger.focus()
  await page.keyboard.press('ArrowDown')
  await expect(item('Dialog')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(fromParent).toBeFocused()
  await expect.poll(() => isOpen(page)).toBe(false)
  await expect(page.getByText('open: false')).toBeVisible()
})

test('the pointer highlights by focusing the item under it, and leaving the item hands focus back to the popup', async ({ page }) => {
  const { trigger, popup, item } = await boot(page)
  await trigger.click()
  await expect.poll(() => isOpen(page)).toBe(true)
  await settled(popup)
  await item('Settings').hover()
  await expect(item('Settings')).toBeFocused()
  await item('Sign Out').hover()
  await expect(item('Sign Out')).toBeFocused()
  await trigger.hover()
  await expect.poll(() => focusedRole(page)).toBe('menu')
})

test('the parent drives the cell through the binding, and the popup is anchored under the trigger without a click', async ({ page }) => {
  const { fromParent } = await boot(page)
  await fromParent.click()
  await expect.poll(() => isOpen(page)).toBe(true)
  await expect(page.getByText('open: true')).toBeVisible()
  await anchored(page)
  await page.keyboard.press('Escape')
  await expect.poll(() => isOpen(page)).toBe(false)
  await expect(page.getByText('open: false')).toBeVisible()
})

test('closing by an item keeps the popover shown through its exit transition', async ({ page }) => {
  const { trigger, popup, item } = await boot(page)
  await trigger.focus()
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => isOpen(page)).toBe(true)
  await settled(popup)
  await popup.evaluate((el) => {
    window.exiting = new Promise((resolve) => {
      el.addEventListener('click', () => requestAnimationFrame(() => requestAnimationFrame(() => {
        resolve({ open: el.matches(':popover-open'), display: getComputedStyle(el).display, running: el.getAnimations().length > 0 })
      })), { once: true })
    })
  })
  await item('Settings').click()
  expect(await page.evaluate(() => window.exiting)).toEqual({ open: true, display: 'block', running: true })
  await expect.poll(() => isOpen(page)).toBe(false)
  await expect(popup).toBeHidden()
})

// With no transition there is no animation to wait on, so every close
// hides at once and nothing is in flight between one step and the next.
test('with transitions off, every way of opening and closing works, and none throws', async ({ page }) => {
  const { trigger, popup, item, fromParent } = await boot(page)
  await popup.evaluate((el) => { el.style.transition = 'none' })
  await trigger.click()
  await expect.poll(() => isOpen(page)).toBe(true)
  await page.keyboard.press('Escape')
  await expect.poll(() => isOpen(page)).toBe(false)
  await trigger.focus()
  await page.keyboard.press('ArrowDown')
  await expect(item('Dialog')).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(item('Settings')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect.poll(() => isOpen(page)).toBe(false)
  await expect(page.getByText('selected: Settings')).toBeVisible()
  await fromParent.click()
  await expect.poll(() => isOpen(page)).toBe(true)
  await trigger.click()
  await expect.poll(() => isOpen(page)).toBe(false)
  await trigger.click()
  await expect.poll(() => isOpen(page)).toBe(true)
  await page.getByRole('heading', { level: 1 }).click()
  await expect.poll(() => isOpen(page)).toBe(false)
  await expect(page.getByText('open: false')).toBeVisible()
})

test('inside a modal dialog the menu opens above it, an item is clickable, and Escape closes the menu before the dialog', async ({ page }) => {
  const { item } = await boot(page)
  await page.getByRole('button', { name: 'Open Dialog' }).click()
  await expect.poll(() => isModal(page)).toBe(true)
  const inner = page.getByRole('button', { name: 'Open Inner Menu' })
  await inner.click()
  await expect(page.getByRole('menu', { name: 'Open Inner Menu' })).toBeVisible()
  await item('Inner Settings').click()
  await expect(page.getByText('selected: Inner Settings')).toBeVisible()
  await expect(page.getByRole('menu', { name: 'Open Inner Menu' })).toBeHidden()
  expect(await isModal(page)).toBe(true)
  await inner.click()
  await expect(page.getByRole('menu', { name: 'Open Inner Menu' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu', { name: 'Open Inner Menu' })).toBeHidden()
  expect(await isModal(page)).toBe(true)
  await page.keyboard.press('Escape')
  await expect.poll(() => isModal(page)).toBe(false)
})
