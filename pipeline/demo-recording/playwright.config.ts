import { defineConfig, devices } from "@playwright/test";

/**
 * Records the demo agent's walkthrough of a feature. The pipeline copies this folder
 * into the idea's worktree, runs it from the worktree's root and then deletes it.
 */
const PORT = 5177;
const SIZE = { width: 1280, height: 720 };

export default defineConfig({
  testDir: ".",
  testMatch: "walkthrough.spec.ts",
  outputDir: "results",
  timeout: 120_000,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://localhost:${PORT}`,
    viewport: SIZE,
    video: { mode: "on", size: SIZE },
    actionTimeout: 10_000,
    launchOptions: { slowMo: 150 },
  },
  webServer: {
    command: `npx vite preview --config vite.demo.config.ts --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    cwd: process.cwd(),
    reuseExistingServer: false,
  },
});
