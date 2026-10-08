import { defineConfig } from '@playwright/test';

// Browser tests (e2e/*.spec.ts) against the built game (`npm run test:e2e` builds it first), in
// Chromium with phone emulation. WebGL 2 comes from SwiftShader, so frames are slow: the tests drive
// the game's clock themselves (see e2e/game.ts) and run one at a time.
export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173/',
    launchOptions: { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/',
    reuseExistingServer: !process.env.CI,
  },
});
