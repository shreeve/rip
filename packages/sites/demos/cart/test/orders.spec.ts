import { expect, test, type Page } from '@playwright/test'
import { clearOrders, createOrder, fetchProducts, usd } from './support/util'

const rows = (page: Page) => page.locator('#content tbody tr')
const cell = (page: Page, row: number, column: number) => rows(page).nth(row).locator('td').nth(column)

test('no orders yet offers a way to the products', async ({ page }, testInfo) => {
  clearOrders(testInfo.config.rootDir)

  await page.goto('/orders')
  await expect(page.locator('h1')).toHaveText('Orders')
  await expect(page.locator('#content')).toContainText("You haven't placed any orders yet.")
  await expect(page.getByRole('button', { name: 'Browse Products' })).toHaveAttribute('href', '/')
})

test('orders are listed newest first, with their item counts and totals', async ({ page }, testInfo) => {
  clearOrders(testInfo.config.rootDir)
  const [first, second] = await fetchProducts(page)

  const older = await createOrder(page, { productId: first.id, quantity: 1 })
  const newer = await createOrder(page,
    { productId: first.id, quantity: 2 },
    { productId: second.id, quantity: 3 })

  await page.goto('/orders')
  await expect(rows(page)).toHaveCount(2)

  await expect(cell(page, 0, 0)).toHaveText(`#${newer.id}`)
  await expect(cell(page, 0, 2)).toHaveText('5')
  await expect(cell(page, 0, 3)).toHaveText(usd(newer.total))

  await expect(cell(page, 1, 0)).toHaveText(`#${older.id}`)
  await expect(cell(page, 1, 2)).toHaveText('1')
  await expect(cell(page, 1, 3)).toHaveText(usd(older.total))
})

test('an order opens directly from its url, showing its lines, total and a way back', async ({ page }, testInfo) => {
  clearOrders(testInfo.config.rootDir)
  const [product] = await fetchProducts(page)
  const order = await createOrder(page, { productId: product.id, quantity: 2 })

  await page.goto(`/orders/${order.id}`)
  await expect(page).toHaveTitle(`Order #${order.id} - Rip`)
  await expect(page.locator('h1')).toHaveText(`Order #${order.id}`)
  await expect(page.locator('#content')).toContainText('Placed on')

  await expect(cell(page, 0, 0)).toHaveText(`${product.image} ${product.name}`)
  await expect(cell(page, 0, 1)).toHaveText(usd(product.price))
  await expect(cell(page, 0, 2)).toHaveText('2')
  await expect(cell(page, 0, 3)).toHaveText(usd(product.price * 2))
  await expect(page.locator('#content tfoot strong').last()).toHaveText(usd(order.total))

  await page.getByRole('button', { name: 'Back to Orders' }).click()
  await expect(page.locator('h1')).toHaveText('Orders')
})
