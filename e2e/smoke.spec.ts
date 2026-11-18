import { expect, test } from '@playwright/test'

test('loads empty app shell without console errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
  })
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text())
    }
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Knovites' })).toBeVisible()
  expect(errors).toEqual([])
})
