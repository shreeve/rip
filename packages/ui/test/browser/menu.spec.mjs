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
const settled = (popup) => popup.evaluate((el) => Promise.allSettled(el.getAnimations().map((a) => a.finished)))

// The demo passes sideOffset 6; below the trigger, left edges aligned,
// is the package's own placement.
const anchored = async (page) => {
  const { trigger, popup } = parts(page)
  await settled(popup)
  const t = await trigger.boundingBox()
  const p = await popup.boundingBox()
  expect(Math.abs(p.x - t.x)).toBeLessThan(1)
  expect(Math.abs(p.y - (t.y + t.height + 6))).toBeLessThan(1)
  await expect(popup).toHaveAttribute('data-side', 'bottom')
  expect(await popup.evaluate((el) => el.style.getPropertyValue('--transform-origin'))).toBe('left top')
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

// A viewport too short for the popup below the trigger makes the
// browser's flip-block fallback place it above; scrolling the trigger to
// the top edge takes that room away and the popup returns below. The
// origin is read off the rendering, since Firefox's computed
// transform-origin can lag the frame: scaling in from the bottom-left
// keeps the bottom edge still while the top edge moves.
test('a popup that cannot fit below flips above, says so in data-side, and scales in from the edge by the trigger', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 260 })
  const { trigger, popup } = await boot(page)
  await trigger.evaluate((el) => el.scrollIntoView({ block: 'end' }))
  await popup.evaluate((el) => {
    window.edges = new Promise((resolve) => {
      const rows = []
      const tick = () => {
        if (el.dataset.open) { const r = el.getBoundingClientRect(); rows.push([r.top, r.bottom]) }
        if (el.dataset.open && el.getAnimations().length === 0) resolve(rows)
        else requestAnimationFrame(tick)
      }
      tick()
    })
  })
  await trigger.focus()
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => isOpen(page)).toBe(true)
  await settled(popup)
  const t = await trigger.boundingBox()
  const p = await popup.boundingBox()
  expect(Math.abs(p.x - t.x)).toBeLessThan(1)
  expect(Math.abs(p.y + p.height + 6 - t.y)).toBeLessThan(1)
  await expect(popup).toHaveAttribute('data-side', 'top')
  expect(await popup.evaluate((el) => el.style.getPropertyValue('--transform-origin'))).toBe('left bottom')
  const edges = await page.evaluate(() => window.edges)
  expect(edges.length).toBeGreaterThan(2)
  expect(Math.abs(edges[0][1] - edges[edges.length - 1][1])).toBeLessThan(0.5)
  expect(edges[0][0] - edges[edges.length - 1][0]).toBeGreaterThan(2)
  await trigger.evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await expect(popup).toHaveAttribute('data-side', 'bottom')
  expect(await popup.evaluate((el) => el.style.getPropertyValue('--transform-origin'))).toBe('left top')
})

const pick = (page, kind, value) => page.getByRole('button', { name: `${kind}: ${value}`, exact: true }).click()
const boxes = async (page) => {
  const { trigger, popup } = parts(page)
  await settled(popup)
  return { t: await trigger.boundingBox(), p: await popup.boundingBox() }
}
const near = (a, b) => expect(Math.abs(a - b)).toBeLessThan(1)

// Each side puts the popup 6px off the trigger's edge, aligned to the
// trigger's start on the other axis, with the origin at the corner by
// the trigger.
test('each side places the popup off that edge of the trigger and sets the origin to face it', async ({ page }) => {
  const { trigger, popup } = await boot(page)
  const cases = {
    bottom: ({ t, p }) => { near(p.y, t.y + t.height + 6); near(p.x, t.x) },
    top: ({ t, p }) => { near(p.y + p.height + 6, t.y); near(p.x, t.x) },
    left: ({ t, p }) => { near(p.x + p.width + 6, t.x); near(p.y, t.y) },
    right: ({ t, p }) => { near(p.x, t.x + t.width + 6); near(p.y, t.y) },
  }
  const origins = { bottom: 'left top', top: 'left bottom', left: 'right top', right: 'left top' }
  for (const side of ['bottom', 'top', 'left', 'right']) {
    await pick(page, 'side', side)
    await trigger.click()
    await expect.poll(() => isOpen(page)).toBe(true)
    await expect(popup).toHaveAttribute('data-side', side)
    cases[side](await boxes(page))
    expect(await popup.evaluate((el) => el.style.getPropertyValue('--transform-origin'))).toBe(origins[side])
    await page.keyboard.press('Escape')
    await expect.poll(() => isOpen(page)).toBe(false)
  }
})

test('align centers the popup on the trigger or lines up their far edges', async ({ page }) => {
  const { trigger, popup } = await boot(page)
  for (const [align, check, origin] of [
    ['center', ({ t, p }) => near(p.x + p.width / 2, t.x + t.width / 2), 'center top'],
    ['end', ({ t, p }) => near(p.x + p.width, t.x + t.width), 'right top'],
  ]) {
    await pick(page, 'align', align)
    await trigger.click()
    await expect.poll(() => isOpen(page)).toBe(true)
    check(await boxes(page))
    expect(await popup.evaluate((el) => el.style.getPropertyValue('--transform-origin'))).toBe(origin)
    await page.keyboard.press('Escape')
    await expect.poll(() => isOpen(page)).toBe(false)
  }
})

// The demo centers its trigger, which leaves both sides the same room,
// so the spec moves it to the hero's left edge: a popup asked for on
// the left cannot fit there and flip-inline sends it right.
test('a popup that cannot fit on the left flips to the right and says so', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 800 })
  const { trigger, popup } = await boot(page)
  await popup.evaluate((el) => { el.parentElement.style.justifyContent = 'flex-start' })
  await pick(page, 'side', 'left')
  await trigger.click()
  await expect.poll(() => isOpen(page)).toBe(true)
  await expect(popup).toHaveAttribute('data-side', 'right')
  const { t, p } = await boxes(page)
  near(p.x, t.x + t.width + 6)
  expect(await popup.evaluate((el) => el.style.getPropertyValue('--transform-origin'))).toBe('left top')
})

// With the trigger centered at phone width neither horizontal side has
// room, so a popup asked for on the left falls through to below.
test('a popup that fits on neither side lands below the trigger and says so', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 800 })
  const { trigger, popup } = await boot(page)
  await pick(page, 'side', 'left')
  await trigger.click()
  await expect.poll(() => isOpen(page)).toBe(true)
  await expect(popup).toHaveAttribute('data-side', 'bottom')
  const { t, p } = await boxes(page)
  near(p.y, t.y + t.height + 6)
  near(p.x, t.x)
  near(p.width, 224)
  expect(await popup.evaluate((el) => el.style.getPropertyValue('--transform-origin'))).toBe('left top')
})

// The exit is sampled the way the entry is: from the bottom-left the
// bottom edge holds while the top edge moves. A light dismiss keeps the
// element rendered through the exit only on Chrome.
for (const how of ['an item', 'Escape']) {
  test(`a flipped popup closed by ${how} scales out from the edge by the trigger`, async ({ page, browserName }) => {
    test.skip(how === 'Escape' && browserName !== 'chromium', 'Firefox and Playwright\'s WebKit hide a light-dismissed popover at once')
    await page.setViewportSize({ width: 1200, height: 260 })
    const { trigger, popup, item } = await boot(page)
    await trigger.evaluate((el) => el.scrollIntoView({ block: 'end' }))
    await trigger.focus()
    await page.keyboard.press('ArrowDown')
    await expect(popup).toHaveAttribute('data-side', 'top')
    await settled(popup)
    await popup.evaluate((el) => {
      window.edges = new Promise((resolve) => {
        const rows = []
        const tick = () => {
          const faded = Number(getComputedStyle(el).opacity) < 0.02
          if (!el.dataset.open && !faded) { const r = el.getBoundingClientRect(); rows.push([r.top, r.bottom]) }
          if (rows.length && faded) resolve(rows)
          else requestAnimationFrame(tick)
        }
        tick()
      })
    })
    if (how === 'Escape') await page.keyboard.press('Escape')
    else await item('Settings').click()
    const edges = await page.evaluate(() => window.edges)
    expect(edges.length).toBeGreaterThan(2)
    expect(Math.abs(edges[0][1] - edges[edges.length - 1][1])).toBeLessThan(0.5)
    expect(edges[edges.length - 1][0] - edges[0][0]).toBeGreaterThan(2)
    await expect(popup).toBeHidden()
  })
}

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
