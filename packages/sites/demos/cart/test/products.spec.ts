import { expect, test, type Page } from '@playwright/test'
import { cards, fetchProducts, nav, usd } from './support/util'

const names = (page: Page) => page.locator(`${cards} h5`)

test('lists every product with its image, name and price', async ({ page }) => {
  await page.goto('/')
  const products = await fetchProducts(page)
  await expect(page.locator(cards)).toHaveCount(products.length)

  for (const product of products) {
    const card = page.locator(cards).filter({ hasText: product.name })
    await expect(card.locator('.image')).toHaveText(product.image)
    await expect(card.locator('p')).toHaveText(usd(product.price))
  }
})

test('search filters the list, ignores case, and records the term in the url', async ({ page }) => {
  await page.goto('/')
  const products = await fetchProducts(page)
  const matching = products.filter(p => p.name.toLowerCase().includes('mug')).map(p => p.name)
  expect(matching.length, 'the products should have something to search for').toBeGreaterThan(0)

  await page.getByRole('searchbox').fill('mug')
  await expect(names(page)).toHaveText(matching)
  await expect(page).toHaveURL(/[?&]search=mug/)

  await page.getByRole('searchbox').fill('MUG')
  await expect(names(page)).toHaveText(matching)
})

test('sorting orders by price both ways and records it in the url', async ({ page }) => {
  await page.goto('/')
  const products = await fetchProducts(page)
  const cheapestFirst = [...products].sort((a, b) => a.price - b.price).map(p => p.name)

  await page.getByRole('combobox').selectOption('price-asc')
  await expect(names(page)).toHaveText(cheapestFirst)
  await expect(page).toHaveURL(/[?&]sort=price-asc/)

  await page.getByRole('combobox').selectOption('price-desc')
  await expect(names(page)).toHaveText([...cheapestFirst].reverse())
  await expect(page).toHaveURL(/[?&]sort=price-desc/)
})

test('a deep link applies both filters on first render', async ({ page }) => {
  await page.goto('/?search=o&sort=price-desc')
  const products = await fetchProducts(page)
  const expected = products
    .filter(p => p.name.toLowerCase().includes('o'))
    .sort((a, b) => b.price - a.price)
    .map(p => p.name)
  expect(expected.length, 'the deep link should match more than one product').toBeGreaterThan(1)

  await expect(names(page)).toHaveText(expected)
  await expect(page.getByRole('searchbox')).toHaveValue('o')
  await expect(page.getByRole('combobox')).toHaveValue('price-desc')
})

test('a search matching nothing offers to clear the filters, and clearing empties the url', async ({ page }) => {
  await page.goto('/')
  const products = await fetchProducts(page)

  await page.getByRole('searchbox').fill('zzz')
  await expect(page.locator(cards)).toHaveCount(0)
  await expect(page.locator('#content')).toContainText('No products found.')

  await page.getByRole('button', { name: 'Clear Filters' }).click()
  await expect(page.locator(cards)).toHaveCount(products.length)
  await expect(page.getByRole('searchbox')).toHaveValue('')
  await expect(page).toHaveURL(/\/$/)
})

test('adding a product flips its button, and removing puts it back', async ({ page }) => {
  await page.goto('/')
  const button = page.locator(cards).first().getByRole('button')

  await expect(button).toHaveText('Add to Cart')
  await expect(page.locator(nav.cart)).toHaveText('Cart (0)')

  await button.click()
  await expect(button).toHaveText('Added to Cart')
  await expect(page.locator(nav.cart)).toHaveText('Cart (1)')

  await button.click()
  await expect(button).toHaveText('Add to Cart')
  await expect(page.locator(nav.cart)).toHaveText('Cart (0)')
})
