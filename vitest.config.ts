import { defineConfig } from 'vitest/config';

// Unit tests for the pure modules (tests/*.test.ts). The browser tests in e2e/ run with Playwright.
export default defineConfig({
  test: { include: ['tests/**/*.test.ts'] },
});
