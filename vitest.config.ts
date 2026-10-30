import path from "node:path";
import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Two test projects (https://vitest.dev/guide/projects.html):
//   - "app":       React/DOM unit tests, run in a real browser (Playwright/Chromium).
//   - "functions": Supabase Edge Function tests. Written for Deno with JSR imports;
//                  Node-only here, with the jsr:/npm: specifiers aliased to their
//                  installed npm equivalents. Aliases are scoped to this project.
// Run everything with `npm run test:unit:app`, or only the functions suite with
// `npm run test:unit:functions` (it does not boot a browser).
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react(), tailwindcss()],
        optimizeDeps: {
          exclude: ["playwright", "playwright-core"],
        },
        resolve: {
          preserveSymlinks: true,
          dedupe: ["react-router", "react-router-dom"],
          alias: {
            "@": path.resolve(__dirname, "./src"),
          },
        },
        test: {
          name: "app",
          globals: true,
          setupFiles: ["./src/index.css"],
          // These are browser integration tests: a click can run a mutation, close a
          // sheet and wait for a toast. The 1s default budget of expect.poll (and of
          // expect.element, which is built on it) holds on an idle machine but not on
          // a loaded runner, where the same assertion was measured at 3.3s. This only
          // raises the ceiling before giving up, so a genuinely broken assertion still
          // fails, just later.
          expect: { poll: { timeout: 5000 } },
          browser: {
            headless: true,
            provider: playwright(),
            enabled: true,
            // Vitest defaults to 414px. Now that the stylesheet above is loaded,
            // Tailwind's responsive classes actually apply, so that default would
            // render the mobile branch of every desktop story. Mobile tests opt in
            // explicitly with `page.viewport(375, 667)`.
            viewport: { width: 1280, height: 800 },
            instances: [
              {
                browser: "chromium",
                ...(process.env.CI && {
                  launch: { channel: "chromium-headless-shell" },
                }),
              },
            ],
            commands: {
              // Uses Chrome DevTools Protocol to override the timezone at runtime,
              // since process.env.TZ has no effect in a real browser environment.
              async setTimezone({ context, page }, timezoneId: string) {
                const session = await context.newCDPSession(page);
                await session.send("Emulation.setTimezoneOverride", {
                  timezoneId,
                });
                await session.detach();
              },
            },
          },
          exclude: [
            "**/node_modules/**",
            "doc/**",
            "supabase/**",
            ".supabase-e2e/**",
            "e2e/**/*.spec.{ts,tsx}",
          ],
          server: {
            deps: {
              external: [/playwright/],
            },
          },
        },
      },
      {
        // Map the Deno imports to the installed npm packages so Vitest can run
        // these Deno-targeted tests in Node without a Deno runtime. These aliases
        // only apply to this project.
        resolve: {
          alias: {
            "jsr:@supabase/supabase-js@2": path.resolve(
              __dirname,
              "node_modules/@supabase/supabase-js",
            ),
            "npm:tldts": path.resolve(__dirname, "node_modules/tldts"),
            "npm:pgsql-ast-parser@^12": "pgsql-ast-parser",
          },
        },
        test: {
          name: "functions",
          globals: true,
          environment: "node",
          include: ["supabase/functions/**/*.test.ts"],
          exclude: ["**/node_modules/**", ".supabase-e2e/**"],
        },
      },
    ],
  },
});
