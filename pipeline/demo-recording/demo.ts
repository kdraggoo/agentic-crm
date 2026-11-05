import { test as base, type Page } from "@playwright/test";

export { expect } from "@playwright/test";

/** Videos don't show the mouse, so draw one that follows it and marks each click. */
function showCursor(): void {
  const add = () => {
    const cursor = document.createElement("div");
    cursor.setAttribute("aria-hidden", "true");
    cursor.style.cssText =
      "position:fixed;top:-20px;left:-20px;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(220,38,38,.75);border:2px solid #fff;box-shadow:0 0 3px rgba(0,0,0,.6);z-index:2147483647;pointer-events:none;transition:transform .12s";
    document.documentElement.append(cursor);
    window.addEventListener(
      "mousemove",
      (event) => {
        cursor.style.left = `${event.clientX}px`;
        cursor.style.top = `${event.clientY}px`;
      },
      true,
    );
    window.addEventListener(
      "mousedown",
      () => (cursor.style.transform = "scale(1.8)"),
      true,
    );
    window.addEventListener(
      "mouseup",
      () => (cursor.style.transform = ""),
      true,
    );
  };
  if (document.documentElement) add();
  else document.addEventListener("DOMContentLoaded", add);
}

/** Use this `test`: its page shows the cursor in the video. */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(showCursor);
    await use(page);
  },
});

/** Holds on the current screen so a viewer can take it in. */
export async function pause(page: Page, ms = 1500): Promise<void> {
  await page.waitForTimeout(ms);
}

/** Shows a caption along the bottom of the video and holds long enough to read it. */
export async function caption(page: Page, text: string): Promise<void> {
  await page.evaluate((value) => {
    const id = "demo-caption";
    const element =
      document.getElementById(id) ?? document.createElement("div");
    element.id = id;
    element.setAttribute("aria-hidden", "true");
    element.textContent = value;
    element.style.cssText =
      "position:fixed;left:50%;bottom:16px;transform:translateX(-50%);max-width:80%;padding:8px 16px;border-radius:8px;background:rgba(0,0,0,.8);color:#fff;font:500 18px/1.3 system-ui,sans-serif;text-align:center;z-index:2147483646;pointer-events:none";
    document.documentElement.append(element);
  }, text);
  await pause(page, Math.max(2000, text.length * 60));
}
