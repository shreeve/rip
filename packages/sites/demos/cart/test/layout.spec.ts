import { expect, test } from '@playwright/test'
import { cards, fetchUser, menu, nav } from './support/util'

test('the chrome names the shop, the routes, and the signed-in user', async ({ page }) => {
  await page.goto('/')
  const user = await fetchUser(page)

  await expect(page.locator(nav.brand)).toHaveText('Shop')
  await expect(page.locator(nav.products)).toHaveText('Products')
  await expect(page.locator(nav.cart)).toHaveText('Cart (0)')
  await expect(page.locator(nav.menu)).toHaveText(`${user.firstName} ${user.lastName}`)

  await page.locator(nav.menu).click()
  await expect(page.locator(menu.profile)).toBeVisible()
  await expect(page.locator(menu.orders)).toBeVisible()

  await page.locator(menu.profile).click()
  await expect(page.locator('h1')).toHaveText('Profile')
})

test('every route renders inside the chrome and titles the document', async ({ page }) => {
  const routes = [
    ['/', 'Products - Rip'],
    ['/cart', 'Cart - Rip'],
    ['/profile', 'Profile - Rip'],
    ['/orders', 'Orders - Rip'],
    ['/nowhere', 'Not Found - Rip'],
    ['/a/b/c', 'Not Found - Rip'],
  ]

  for (const [path, title] of routes) {
    const response = await page.goto(path)
    expect(response?.status(), `${path} should be served the shell, not the edge's 404`).toBe(200)
    await expect(page).toHaveTitle(title)
    await expect(page.locator(nav.brand)).toHaveText('Shop')
  }

  await expect(page.locator('#content')).toHaveText('Page not found')
})

test('a failing gate shows the error, and it does not follow you', async ({ page }) => {
  await page.goto('/orders/999')
  await expect(page.locator('p.error')).toHaveText("Couldn't load this page")
  await expect(page.locator('#content')).toBeEmpty()
  await expect(page.locator(nav.brand)).toHaveText('Shop')

  await page.locator(nav.products).click()
  await expect(page.locator('p.error')).toHaveCount(0)
  await expect(page.locator(cards)).not.toHaveCount(0)
})

test('the cart survives navigation and is dropped by a reload', async ({ page }) => {
  await page.goto('/')
  await page.locator(cards).first().getByRole('button', { name: 'Add to Cart' }).click()
  await expect(page.locator(nav.cart)).toHaveText('Cart (1)')

  await page.locator(nav.cart).click()
  await expect(page.locator('h1')).toHaveText('Cart')
  await expect(page.locator(nav.cart)).toHaveText('Cart (1)')

  await page.locator(nav.products).click()
  await expect(page.locator('h1')).toHaveText('Products')
  await expect(page.locator(nav.cart)).toHaveText('Cart (1)')

  await page.reload()
  await expect(page.locator(nav.cart)).toHaveText('Cart (0)')
})
