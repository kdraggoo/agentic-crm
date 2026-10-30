import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke tests for the FakeRest demo build (`npm run build:demo`).
 *
 * Kept apart from `playwright.config.ts`, which runs the Supabase-backed suite:
 * these specs need no backend, only the static `dist/` output of the demo build.
 * Run with `npm run build:demo && npx playwright test --config playwright.demo.config.ts`.
 */
const PORT = 5176;

export default defineConfig({
  testDir: "./e2e/demo",
  /* The demo keeps its data in memory per page load, so specs are independent. */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    actionTimeout: 5000,
  },
  /* Serve the built demo statically, as the idea preview sites do. */
  webServer: {
    command: `npx vite preview --config vite.demo.config.ts --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(process.env.CI && { channel: "chromium-headless-shell" }),
      },
    },
  ],
});
