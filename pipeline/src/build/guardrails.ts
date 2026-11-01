import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { restorePaths } from "./git.js";
import { runOrThrow } from "./run.js";

/**
 * Files that set how the demo the tests run against behaves. The demo adds network
 * latency on purpose, so tests and app code are exercised at a realistic pace; a
 * build that only passes without it has a timing bug, not a passing build.
 */
const DEMO_CONFIG_FILES = [
  "demo/App.tsx",
  "demo/main.tsx",
  "playwright.config.ts",
  "playwright.demo.config.ts",
  "vite.demo.config.ts",
];

const FAKEREST_PROVIDER =
  "src/components/atomic-crm/providers/fakerest/dataProvider.ts";
const LATENCY_DEFAULT = /^(\s*latency = )(\d+)(,)$/m;

/**
 * Puts back any change the build agent made to the demo's configuration or to the
 * FakeRest default latency. Returns what was restored, empty when nothing was.
 */
export async function restoreDemoConfig(
  dir: string,
  baseCommit: string,
  changed: string[],
): Promise<string[]> {
  const restored = DEMO_CONFIG_FILES.filter((file) => changed.includes(file));
  if (restored.length > 0) await restorePaths(dir, baseCommit, restored);

  if (changed.includes(FAKEREST_PROVIDER)) {
    const original = (
      await runOrThrow("git", ["show", `${baseCommit}:${FAKEREST_PROVIDER}`], {
        cwd: dir,
      })
    ).match(LATENCY_DEFAULT)?.[2];
    const file = path.join(dir, FAKEREST_PROVIDER);
    const current = await readFile(file, "utf8");
    if (original && current.match(LATENCY_DEFAULT)?.[2] !== original) {
      // Only the default value is put back; the rest of the agent's changes stay.
      await writeFile(
        file,
        current.replace(LATENCY_DEFAULT, `$1${original}$3`),
      );
      restored.push(`${FAKEREST_PROVIDER} (default latency)`);
    }
  }
  return restored;
}
