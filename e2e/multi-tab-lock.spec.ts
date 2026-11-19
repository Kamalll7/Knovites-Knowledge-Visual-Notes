import { expect, test } from '@playwright/test'

test.describe('Multi-tab Web Locks protection [T2.3, FR-LOC-05]', () => {
  test('second tab opens read-only with banner and Take over transfers write access', async ({
    context,
  }) => {
    const page1 = await context.newPage()
    const page2 = await context.newPage()

    const errors: string[] = []
    for (const page of [page1, page2]) {
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text())
      })
    }

    await page1.goto('/#/')
    await expect(page1.getByRole('heading', { name: 'Knowledge Map' })).toBeVisible()
    // Allow initial mount + StrictMode lock re-acquisition to settle cleanly
    await page1.waitForFunction(async () => {
      const snapshot = await navigator.locks?.query()
      return snapshot?.held?.some((lock) => lock.name === 'knovites-writer-lock') ?? false
    })
    await expect(page1.getByTestId('readonly-tab-banner')).toHaveCount(0)

    // Open second tab in the same browser context -> must enter read-only mode
    await page2.goto('/#/')
    await expect(page2.getByRole('heading', { name: 'Knowledge Map' })).toBeVisible()
    await expect(page2.getByTestId('readonly-tab-banner')).toBeVisible()
    await expect(page2.getByTestId('take-over-button')).toBeVisible()
    await expect(page1.getByTestId('readonly-tab-banner')).toHaveCount(0)

    // Click Take over on the second tab -> transfers write lock and demotes first tab
    await page2.getByTestId('take-over-button').click()
    await expect(page2.getByTestId('readonly-tab-banner')).toHaveCount(0)
    await expect(page1.getByTestId('readonly-tab-banner')).toBeVisible()
    await expect(page1.getByTestId('take-over-button')).toBeVisible()

    // Take back from first tab as well to confirm bi-directional handoff
    await page1.getByTestId('take-over-button').click()
    await expect(page1.getByTestId('readonly-tab-banner')).toHaveCount(0)
    await expect(page2.getByTestId('readonly-tab-banner')).toBeVisible()

    expect(errors).toEqual([])
  })
})
