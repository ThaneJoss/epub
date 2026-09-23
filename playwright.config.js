import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 45_000,
  use: {
    baseURL: 'http://127.0.0.1:8788', headless: true,
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {},
  },
  webServer: { command: 'node tests/server.mjs', url: 'http://127.0.0.1:8788', reuseExistingServer: !process.env.CI },
});
