import { expect, test, type Page } from '@playwright/test'
import { fetchUser, nav, reseed } from './support/util'

const field = (page: Page, label: string) => page.getByLabel(label)
const save = (page: Page) => page.getByRole('button', { name: 'Update Profile' })

test('shows the signed-in user, with the email read-only', async ({ page }) => {
  await page.goto('/profile')
  const user = await fetchUser(page)

  await expect(field(page, 'First name')).toHaveValue(user.firstName)
  await expect(field(page, 'Last name')).toHaveValue(user.lastName)
  await expect(field(page, 'Email')).toHaveValue(user.email)
  await expect(field(page, 'Phone')).toHaveValue(user.phone ?? '')
  await expect(field(page, 'Email')).not.toBeEditable()
})

test('a blank name is rejected, marked invalid, and nothing is saved', async ({ page }) => {
  await page.goto('/profile')
  const user = await fetchUser(page)

  await field(page, 'First name').fill('')
  await field(page, 'Last name').fill('')
  await save(page).click()

  await expect(page.locator('small')).toHaveText(['Enter a first name', 'Enter a last name'])
  await expect(field(page, 'First name')).toHaveAttribute('aria-invalid', 'true')
  await expect(field(page, 'Last name')).toHaveAttribute('aria-invalid', 'true')
  await expect(page.locator('p.success')).toHaveCount(0)

  await page.reload()
  await expect(field(page, 'First name')).toHaveValue(user.firstName)
  await expect(field(page, 'Last name')).toHaveValue(user.lastName)
})

test('a saved change persists across a reload and renames the nav', async ({ page }, testInfo) => {
  reseed(testInfo.config.rootDir)

  await page.goto('/profile')
  const user = await fetchUser(page)
  expect(user.firstName, 'the rename must actually change something').not.toBe('Ada')

  await field(page, 'First name').fill('Ada')
  await field(page, 'Phone').fill('(555) 010-1234')
  await save(page).click()

  await expect(page.locator('p.success')).toHaveText('Profile updated!')
  await expect(page.locator(nav.menu)).toHaveText(`Ada ${user.lastName}`)

  await page.reload()
  await expect(field(page, 'First name')).toHaveValue('Ada')
  await expect(field(page, 'Phone')).toHaveValue('(555) 010-1234')
  await expect(page.locator(nav.menu)).toHaveText(`Ada ${user.lastName}`)
})

test('a failed save shows a form error', async ({ page }) => {
  await page.goto('/profile')

  await page.route('**/api/user', route =>
    route.request().method() === 'PATCH'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
      : route.continue())

  await field(page, 'First name').fill('Grace')
  await save(page).click()
  await expect(page.locator('p.error')).toHaveText('Something went wrong')
  await expect(page.locator('p.success')).toHaveCount(0)

  await page.unroute('**/api/user')
  await page.route('**/api/user', route =>
    route.request().method() === 'PATCH' ? route.abort() : route.continue())

  await save(page).click()
  await expect(page.locator('p.error')).toHaveText('Network error')
})
