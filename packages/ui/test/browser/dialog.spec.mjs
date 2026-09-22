import { expect, test } from '@playwright/test'
import { boot, focusInside, isModal } from './support.mjs'

test('the trigger opens a modal dialog, focus lands inside, and the state shows on both parts', async ({ page }) => {
  const { trigger, popup } = await boot(page)
  expect(await isModal(page)).toBe(false)
  await trigger.click()
  await expect.poll(() => isModal(page)).toBe(true)
  await expect(page.getByRole('dialog', { name: 'Notifications' })).toBeVisible()
  expect(await focusInside(page)).toBe(true)
  await expect(popup).toHaveAttribute('data-open', 'true')
  await expect(popup).not.toHaveAttribute('data-closed')
  await expect(trigger).toHaveAttribute('data-popup-open', 'true')
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByText('open: true')).toBeVisible()
})

// The demo scrolls inside main, which a modal already holds still, so
// the page grows past the viewport to give the document a scroll of its
// own: that one a modal does not stop.
test('the document does not scroll while a modal is open, with no stylesheet of the app\'s', async ({ page }) => {
  const { trigger, popup } = await boot(page)
  await page.evaluate(() => document.body.append(Object.assign(document.createElement('div'), { style: 'height: 200vh' })))
  const scrolled = () => page.evaluate(() => scrollY)
  const wheel = async () => {
    await page.mouse.move(8, 8)
    await page.mouse.wheel(0, 400)
    await page.waitForTimeout(100)
  }
  await trigger.click()
  await expect.poll(() => isModal(page)).toBe(true)
  await wheel()
  expect(await scrolled()).toBe(0)
  await page.keyboard.press('Escape')
  await expect.poll(() => isModal(page)).toBe(false)
  await expect(popup).toBeHidden()
  await wheel()
  await expect.poll(scrolled).toBeGreaterThan(0)
})

// Opened from the keyboard: WebKit does not focus a button on a mouse
// click, so a mouse-opened dialog there restores focus to the body,
// which is the platform's own rule, not the component's.
test('Escape closes it, the cell follows, and focus returns to the trigger', async ({ page }) => {
  const { trigger, popup } = await boot(page)
  await trigger.focus()
  await page.keyboard.press('Enter')
  await expect.poll(() => isModal(page)).toBe(true)
  await page.keyboard.press('Escape')
  await expect.poll(() => isModal(page)).toBe(false)
  await expect(page.getByText('open: false')).toBeVisible()
  await expect(popup).not.toHaveAttribute('data-open')
  await expect(popup).toHaveAttribute('data-closed', 'true')
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await expect(trigger).toBeFocused()
})

// Stable Safari and every iOS browser ignore closedby, and no Playwright
// engine is one of them, so the second run strips the attribute after the
// dialog opens: the browser then ignores the press, and only the popup's
// own handler can close it.
for (const native of [true, false]) {
  test(`a click on the backdrop closes it${native ? '' : ' without native closedby'}; a click inside the panel or a drag out of it does not`, async ({ page }) => {
    const { trigger, popup } = await boot(page)
    await expect(popup).toHaveAttribute('closedby', 'any')
    await trigger.click()
    await expect.poll(() => isModal(page)).toBe(true)
    if (!native) await popup.evaluate((el) => el.removeAttribute('closedby'))
    const { left, top, padding } = await page.evaluate(() => {
      const dialog = document.querySelector('main dialog')
      const { left, top } = dialog.getBoundingClientRect()
      const { paddingLeft, paddingTop } = getComputedStyle(dialog)
      return { left, top, padding: { left: parseFloat(paddingLeft), top: parseFloat(paddingTop) } }
    })
    expect(Math.min(padding.left, padding.top)).toBeGreaterThan(0)
    expect(Math.min(left, top)).toBeGreaterThan(1)
    await page.mouse.click(left + padding.left / 2, top + padding.top / 2)
    await expect.poll(() => isModal(page)).toBe(true)
    await page.mouse.move(left + padding.left / 2, top + padding.top / 2)
    await page.mouse.down()
    await page.mouse.move(left / 2, top / 2, { steps: 4 })
    await page.mouse.up()
    await expect.poll(() => isModal(page)).toBe(true)
    await page.mouse.click(left / 2, top / 2)
    await expect.poll(() => isModal(page)).toBe(false)
    await expect(page.getByText('open: false')).toBeVisible()
  })
}

const pass = (page, value) => page.getByRole('button', { name: `closedby: ${value}`, exact: true }).click()

test('the popup carries the closedby the page passes, and any when it passes none', async ({ page }) => {
  const { popup } = await boot(page)
  await expect(popup).toHaveAttribute('closedby', 'any')
  for (const value of ['none', 'closerequest', 'any']) {
    await pass(page, value)
    await expect(popup).toHaveAttribute('closedby', value)
    await pass(page, 'not passed')
    await expect(popup).toHaveAttribute('closedby', 'any')
  }
})

test('without native closedby, a popup passed none refuses Escape and a press on the backdrop', async ({ page }) => {
  const { trigger, popup } = await boot(page)
  await pass(page, 'none')
  await trigger.click()
  await expect.poll(() => isModal(page)).toBe(true)
  await popup.evaluate((el) => el.removeAttribute('closedby'))
  await page.keyboard.press('Escape')
  await page.mouse.click(2, 2)
  await page.waitForTimeout(300)
  await expect(popup).toHaveAttribute('data-open', 'true')
  expect(await isModal(page)).toBe(true)
})

for (const how of ['mouse', 'keyboard']) {
  test(`opened by ${how}, the focused close part ${how === 'mouse' ? 'shows no' : 'shows a'} focus ring`, async ({ page }) => {
    const { trigger, close } = await boot(page)
    if (how === 'mouse') {
      const box = await trigger.boundingBox()
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    } else {
      await trigger.focus()
      await page.keyboard.press('Enter')
    }
    await expect.poll(() => isModal(page)).toBe(true)
    await expect(close).toBeFocused()
    expect(await close.evaluate((el) => el.matches(':focus-visible'))).toBe(how === 'keyboard')
  })
}

// The demo popup has one focusable, so the spec adds a frame with a
// field of its own and a field ahead of the close part. The frame comes
// first: a Tab inside it never reaches the popup, so the wrap out of it
// rides the browser's own move onto the sentinel. Where focus lands
// inside a frame it enters is the engine's own choice, so the spec places
// it in the field itself before leaving.
test('Tab wraps at the popup\'s ends, through a frame at one end, and a programmatic focus outside never leaves the modal', async ({ page }) => {
  const { trigger, close, fromParent } = await boot(page)
  await trigger.click()
  await expect.poll(() => isModal(page)).toBe(true)
  await expect(close).toBeFocused()
  await page.evaluate(() => {
    const frame = document.createElement('iframe')
    frame.title = 'Frame'
    frame.srcdoc = '<input aria-label="Inner">'
    const field = document.createElement('input')
    field.setAttribute('aria-label', 'Note')
    document.querySelector('main dialog').lastElementChild.before(frame, field)
  })
  const field = page.getByRole('textbox', { name: 'Note' })
  const frame = page.locator('main dialog iframe')
  const inner = page.frameLocator('main dialog iframe').getByRole('textbox', { name: 'Inner' })
  await expect(inner).toBeVisible()
  await close.focus()
  await page.keyboard.press('Tab')
  await expect(frame).toBeFocused()
  await inner.focus()
  await page.keyboard.press('Shift+Tab')
  await expect(close).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(field).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(frame).toBeFocused()
  await inner.focus()
  await page.keyboard.press('Tab')
  await expect(field).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(close).toBeFocused()
  await fromParent.focus()
  expect(await focusInside(page)).toBe(true)
  await expect(fromParent).not.toBeFocused()
})

test('the parent drives the cell through the binding, and the close part closes', async ({ page }) => {
  const { fromParent, close } = await boot(page)
  await fromParent.click()
  await expect.poll(() => isModal(page)).toBe(true)
  await expect(page.getByText('open: true')).toBeVisible()
  await close.click()
  await expect.poll(() => isModal(page)).toBe(false)
  await expect(page.getByText('open: false')).toBeVisible()
})

test('the popup is named by its title and described by its description', async ({ page }) => {
  const { trigger } = await boot(page)
  await trigger.click()
  const popup = page.getByRole('dialog')
  await expect(popup).toHaveAccessibleName('Notifications')
  await expect(popup).toHaveAccessibleDescription('You are all caught up. Good job!')
})

for (const how of ['the close part', 'Escape']) {
  test(`closing by ${how} keeps the popup modal and rendered through its exit transition`, async ({ page }) => {
    const { trigger, popup, close } = await boot(page)
    await trigger.focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => isModal(page)).toBe(true)
    await popup.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
    await popup.evaluate((el) => {
      window.exiting = new Promise((resolve) => {
        const sample = () => requestAnimationFrame(() => requestAnimationFrame(() => {
          resolve({ modal: el.matches(':modal'), display: getComputedStyle(el).display, running: el.getAnimations().length > 0 })
        }))
        el.addEventListener('keyup', sample, { once: true })
        el.addEventListener('click', sample, { once: true })
      })
    })
    if (how === 'Escape') await page.keyboard.press('Escape')
    else await close.click()
    expect(await page.evaluate(() => window.exiting)).toEqual({ modal: true, display: 'block', running: true })
    await expect.poll(() => isModal(page)).toBe(false)
    await expect(popup).toBeHidden()
  })
}
