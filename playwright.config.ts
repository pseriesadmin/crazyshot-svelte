import { defineConfig, devices } from '@playwright/test'

/**
 * 편집기 실제 브라우저 자동 검증 — Chrome(Chromium)·Safari(WebKit).
 * 실행: npm run test:e2e   (개발 서버가 이미 떠 있으면 재사용, 없으면 자동 기동)
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    viewport: { width: 1200, height: 900 },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chrome', use: { ...devices['Desktop Chrome'] } },
    { name: 'safari', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'npm run dev -- --port 5173',
    url: 'http://localhost:5173/dev-e2e/editors',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
