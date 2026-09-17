import { expect } from '@playwright/test'

export const parts = (page) => ({
  trigger: page.getByRole('button', { name: 'Open Dialog' }),
  popup: page.locator('main dialog'),
  close: page.getByRole('button', { name: 'Close' }),
  fromParent: page.getByRole('button', { name: 'Open from the Parent' }),
})
export const boot = async (page) => {
  await page.goto('/dialog')
  await expect(parts(page).trigger).toBeVisible()
  return parts(page)
}
export const isModal = (page) => page.evaluate(() => document.querySelector('dialog:modal') !== null)
export const focusInside = (page) => page.evaluate(() => document.querySelector('main dialog').contains(document.activeElement))
