import { expect, test, type Page } from '@playwright/test'
import { cards, clearOrders, fetchProducts, nav, usd } from './support/util'

const rows = (page: Page) => page.locator('.cart-table tbody tr')
const line = (page: Page, index = 0) => rows(page).nth(index)
const total = (page: Page) => page.locator('.cart-table tfoot strong').last()

const quantity = (page: Page, index = 0) => line(page, index).locator('.stepper input')
const minus = (page: Page, index = 0) => line(page, index).locator('.stepper button').first()
const plus = (page: Page, index = 0) => line(page, index).locator('.stepper button').last()

const subtotal = (page: Page, index = 0) => line(page, index).locator('td').nth(3)

async function fillCart(page: Page, ...indexes: number[]) {
  await page.goto('/')
  for (const index of indexes) {
    await page.locator(cards).nth(index).getByRole('button', { name: 'Add to Cart' }).click()
  }
  await page.locator(nav.cart).click()
  await expect(page.locator('h1')).toHaveText('Cart')
}

test('a line carries the product, its price, quantity and subtotal', async ({ page }) => {
  await fillCart(page, 0)
  const [product] = await fetchProducts(page)

  await expect(rows(page)).toHaveCount(1)
  await expect(line(page).locator('td.name')).toHaveText(`${product.image} ${product.name}`)
  await expect(line(page).locator('td').nth(1)).toHaveText(usd(product.price))
  await expect(quantity(page)).toHaveValue('1')
  await expect(subtotal(page)).toHaveText(usd(product.price))
  await expect(total(page)).toHaveText(usd(product.price))
})

test('the stepper raises and lowers the quantity, and drops the line at one', async ({ page }) => {
  await fillCart(page, 0)
  const [product] = await fetchProducts(page)

  await plus(page).click()
  await expect(quantity(page)).toHaveValue('2')
  await expect(subtotal(page)).toHaveText(usd(product.price * 2))
  await expect(total(page)).toHaveText(usd(product.price * 2))
  await expect(page.locator(nav.cart)).toHaveText('Cart (2)')

  await minus(page).click()
  await expect(quantity(page)).toHaveValue('1')
  await expect(total(page)).toHaveText(usd(product.price))

  await minus(page).click()
  await expect(page.locator('#content')).toContainText('Your cart is empty.')
  await expect(page.locator(nav.cart)).toHaveText('Cart (0)')
  await expect(page.getByRole('button', { name: 'Continue Shopping' })).toHaveAttribute('href', '/')
})

test('a quantity below one is clamped', async ({ page }) => {
  await fillCart(page, 0)

  for (const rejected of ['0', '', '-5']) {
    await quantity(page).fill(rejected)
    await expect(quantity(page)).toHaveValue('1')
    await expect(page.locator(nav.cart)).toHaveText('Cart (1)')
  }

  await quantity(page).fill('3')
  await expect(page.locator(nav.cart)).toHaveText('Cart (3)')
})

test('remove drops a single line, and clear empties the rest', async ({ page }) => {
  await fillCart(page, 0, 1, 2)
  await expect(rows(page)).toHaveCount(3)

  await line(page).getByRole('button', { name: 'Remove' }).click()
  await expect(rows(page)).toHaveCount(2)
  await expect(page.locator(nav.cart)).toHaveText('Cart (2)')

  await page.getByRole('button', { name: 'Clear Cart' }).click()
  await expect(page.locator('#content')).toContainText('Your cart is empty.')
  await expect(page.locator(nav.cart)).toHaveText('Cart (0)')
})

test('placing an order confirms it, empties the cart, and lists it in the orders', async ({ page }, testInfo) => {
  clearOrders(testInfo.config.rootDir)
  await fillCart(page, 0)
  const [product] = await fetchProducts(page)
  await plus(page).click()

  await page.getByRole('button', { name: 'Place Order' }).click()
  await expect(page.locator('h1')).toHaveText('Order Placed!')
  await expect(page.locator('#content')).toContainText('Your order has been placed successfully.')
  await expect(page.locator(nav.cart)).toHaveText('Cart (0)')
  await expect(page.getByRole('button', { name: 'Continue Shopping' })).toHaveAttribute('href', '/')

  await page.getByRole('button', { name: 'View Orders' }).click()
  await expect(page.locator('h1')).toHaveText('Orders')
  await expect(page.locator('#content tbody tr')).toHaveCount(1)

  const order = page.locator('#content tbody tr').first().locator('td')
  await expect(order.nth(2)).toHaveText('2')
  await expect(order.nth(3)).toHaveText(usd(product.price * 2))
})

test('a rejected order shows the error and keeps the cart', async ({ page }) => {
  await fillCart(page, 0)

  await page.route('**/api/orders', route =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: '{"errors":{"form":"Invalid order data"}}',
        })
      : route.continue())

  await page.getByRole('button', { name: 'Place Order' }).click()
  await expect(page.locator('p.error')).toHaveText('Invalid order data')
  await expect(rows(page)).toHaveCount(1)
  await expect(page.locator(nav.cart)).toHaveText('Cart (1)')
})
