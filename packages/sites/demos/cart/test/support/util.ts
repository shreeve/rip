import { expect, type Page } from '@playwright/test'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

export type User = {
  id: number
  firstName: string
  lastName: string
  email: string
  phone?: string
}

export type Product = {
  id: number
  name: string
  price: number
  image: string
}

export type OrderLine = {
  productId: number
  quantity: number
}

export type OrderItem = {
  productId: number
  name: string
  price: number
  image: string
  quantity: number
}

export type Order = {
  id: number
  total: number
  items: OrderItem[]
  createdAt: string
}

export const nav = {
  brand: 'nav strong',
  products: 'nav a[href="/"]',
  cart: 'nav a[href="/cart"]',
  menu: 'nav summary',
}

export const menu = {
  profile: 'nav a[href="/profile"]',
  orders: 'nav a[href="/orders"]',
}

export const cards = '#content article'

export const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`

export async function fetchUser(page: Page) {
  const response = await page.request.get('/api/user')
  expect(response.ok(), 'the api should return the signed-in user').toBeTruthy()
  const user: User = await response.json()
  return user
}

export async function fetchProducts(page: Page) {
  const response = await page.request.get('/api/products')
  expect(response.ok(), 'the api should list products').toBeTruthy()
  const products: Product[] = await response.json()
  expect(products.length, 'the api should list more than one product').toBeGreaterThan(1)
  return products
}

export async function createOrder(page: Page, ...items: OrderLine[]) {
  const response = await page.request.post('/api/orders', { data: { items } })
  expect(response.ok(), 'the api should accept the order').toBeTruthy()
  const order: Order = await response.json()
  return order
}

export function clearOrders(rootDir: string) {
  const db = new DatabaseSync(join(rootDir, 'api/cart.sqlite'))
  try {
    db.exec('PRAGMA busy_timeout = 5000')
    db.prepare('DELETE FROM orders').run()
  } finally {
    db.close()
  }
}
