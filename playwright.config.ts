import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', timeout: 180000, workers: 1,
  use: { browserName: 'chromium', channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL || 'chrome', headless: true,
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
    baseURL: 'http://127.0.0.1:43179/mmd-gltf/' },
  webServer: [
    { command: 'npm run dev -- --port 43179 --strictPort', url: 'http://127.0.0.1:43179/mmd-gltf/', reuseExistingServer: false },
    { command: 'npm run preview -- --port 43180 --strictPort', url: 'http://127.0.0.1:43180/mmd-gltf/', reuseExistingServer: false },
  ],
});
