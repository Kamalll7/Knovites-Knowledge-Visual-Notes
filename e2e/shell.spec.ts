import { expect, test } from '@playwright/test'

test.describe('Shell, routing, theme switching, and screenshots [T0.4]', () => {
  test('switches routes and themes, shows toast, and captures dark/light screenshots', async ({
    page,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/#/')

    // Default theme is dark
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expect(page.getByRole('heading', { name: 'Knowledge Map' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Map', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: 'e2e/screenshots/map-dark.png', fullPage: true })

    // Navigate to Node page (dark)
    await page.getByRole('link', { name: 'Open sample node' }).click()
    await expect(page).toHaveURL(/#\/n\/demo-ret2win$/)
    await expect(page.getByRole('heading', { name: 'Node: demo-ret2win' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Sample Node' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await page.screenshot({ path: 'e2e/screenshots/node-dark.png', fullPage: true })

    // Navigate to Settings page (dark) and trigger toast
    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page).toHaveURL(/#\/settings$/)
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await page.getByRole('button', { name: 'Show sample toast' }).click()
    await expect(page.getByText('Workspace ready', { exact: true })).toBeVisible()
    await page.screenshot({ path: 'e2e/screenshots/settings-dark.png', fullPage: true })

    // Switch to light theme (toast remains visible and is also verified in light theme)
    await page.getByRole('radio', { name: 'Light' }).click()
    await expect(page.locator('html')).toHaveClass(/light/)
    await expect(page.getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true')
    await page.screenshot({ path: 'e2e/screenshots/settings-light.png', fullPage: true })

    // Dismiss toast cleanly
    await page.getByRole('button', { name: 'Dismiss notification' }).click()
    await expect(page.getByText('Workspace ready', { exact: true })).toHaveCount(0)

    // Navigate to Node page (light)
    await page.getByRole('link', { name: 'Sample Node' }).click()
    await expect(page).toHaveURL(/#\/n\/demo-ret2win$/)
    await expect(page.getByRole('heading', { name: 'Node: demo-ret2win' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Sample Node' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await page.screenshot({ path: 'e2e/screenshots/node-light.png', fullPage: true })

    // Navigate back to Map (light)
    await page.getByRole('link', { name: 'Map', exact: true }).click()
    await expect(page).toHaveURL(/#\/$/)
    await expect(page.getByRole('heading', { name: 'Knowledge Map' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Map', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await page.screenshot({ path: 'e2e/screenshots/map-light.png', fullPage: true })

    expect(errors).toEqual([])
  })
})
