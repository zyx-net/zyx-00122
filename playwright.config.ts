/**
 * Playwright 配置：浏览器级导出链路回归测试
 * 运行方式：
 *   1. npm install --save-dev @playwright/test
 *   2. npx playwright install chromium
 *   3. npm run dev  (确保 Vite 开发服务器在 5173 端口)
 *   4. npx playwright test tests/export-round4.spec.ts
 */
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: '**/export-round4.spec.ts',
  fullyParallel: false,
  retries: 0,
  reporter: 'line',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // ⭐ 不用 chrome-headless-shell（Windows 下 ICU 文件描述符问题），强制完整浏览器
    headless: false,
    launchOptions: {
      args: ['--disable-search-engine-choice-screen', '--disable-infobars'],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
