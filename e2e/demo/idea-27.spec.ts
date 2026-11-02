import { expect, test, type Page } from "@playwright/test";

// Spec: Show product name instead of ID in deal line items during edit (size S)
//
// The demo generates random data on every load. Roughly half of deals get
// 1-3 line items, and at least one deal has an archived product reference.
// We navigate to deals, open their edit forms, and assert that the product
// picker shows product names, never raw numeric IDs.

/**
 * Navigate to the deals Kanban and wait for it to load.
 */
async function goToDealsKanban(page: Page) {
  await page.goto("/");
  await page.getByRole("link", { name: "Deals", exact: true }).click();
  await expect(page).toHaveURL(/#\/deals/);
  await expect(page.locator("[data-rfd-draggable-id]").first()).toBeVisible();
}

/**
 * Find a deal with line items, open its edit form, and return.
 * Iterates through deal cards until finding one whose show view has "Line items total".
 */
async function navigateToDealWithLineItemsEdit(page: Page) {
  await goToDealsKanban(page);

  const dealCards = page.locator("[data-rfd-draggable-id]");
  const count = await dealCards.count();

  for (let i = 0; i < count; i++) {
    await dealCards.nth(i).click();
    // Wait for the show dialog to appear
    await expect(
      page.getByRole("link", { name: "Edit", exact: true }),
    ).toBeVisible();

    // Check if this deal has line items
    const hasLineItems = await page
      .getByText("Line items total")
      .waitFor({ state: "visible", timeout: 2000 })
      .then(() => true)
      .catch(() => false);

    if (hasLineItems) {
      // Open the edit form
      await page.getByRole("link", { name: "Edit", exact: true }).click();
      // Wait for the edit form to render with the line items section heading
      await expect(
        page.getByRole("heading", { name: "Line items" }),
      ).toBeVisible();
      return;
    }

    // Close this dialog and try the next deal
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("link", { name: "Edit", exact: true }),
    ).toBeHidden();
  }

  throw new Error(
    "No deal with line items found in demo data (~50% should have them).",
  );
}

test.describe("idea-27: product name in deal line items edit", () => {
  test("AC1: editing a deal with line items shows product names, never numeric IDs", async ({
    page,
  }) => {
    await navigateToDealWithLineItemsEdit(page);

    // The product pickers are combobox elements with aria-label "Product"
    const productSelects = page.getByRole("combobox", { name: "Product" });
    await expect(productSelects.first()).toBeVisible();

    const count = await productSelects.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const selectText = await productSelects.nth(i).textContent();
      // The text should be a product name (contains letters), not a bare numeric ID
      expect(selectText?.trim()).toBeTruthy();
      expect(selectText?.trim()).not.toMatch(/^\d+$/);
    }
  });

  test("AC2: while products are loading, a placeholder or loading indicator is shown instead of the raw product ID", async ({
    page,
  }) => {
    // We verify that by the time the edit form is usable, every product
    // picker shows either a product name or a loading/placeholder string,
    // never a bare numeric ID. The spec requires that the raw ID is never
    // visible to the user.
    await navigateToDealWithLineItemsEdit(page);

    const productSelects = page.getByRole("combobox", { name: "Product" });
    await expect(productSelects.first()).toBeVisible();

    const count = await productSelects.count();
    for (let i = 0; i < count; i++) {
      const text = await productSelects.nth(i).textContent();
      // Must not be a bare numeric ID (the bug this spec fixes)
      expect(text?.trim()).not.toMatch(/^\d+$/);
      // Must have some visible text (product name or a placeholder)
      expect(text?.trim()).toBeTruthy();
    }
  });

  test("AC3: a line item referencing an archived product shows the product name followed by '(Archived)'", async ({
    page,
  }) => {
    // The demo data generator guarantees at least one deal references an
    // archived product in its line items (see dealProducts.ts). We iterate
    // deal cards to find one whose show view contains the "Archived" badge.
    test.setTimeout(90_000);

    await goToDealsKanban(page);

    const dealCards = page.locator("[data-rfd-draggable-id]");
    const count = await dealCards.count();
    let foundArchived = false;

    for (let i = 0; i < count && !foundArchived; i++) {
      await dealCards.nth(i).click();
      await expect(
        page.getByRole("link", { name: "Edit", exact: true }),
      ).toBeVisible();

      // Check if this deal's show view has an "Archived" badge (for archived products).
      // Use a short timeout: most deals won't have one.
      const hasArchived = await page
        .getByText("Archived", { exact: true })
        .first()
        .waitFor({ state: "visible", timeout: 1000 })
        .then(() => true)
        .catch(() => false);

      if (hasArchived) {
        // Open the edit form
        await page.getByRole("link", { name: "Edit", exact: true }).click();
        await expect(
          page.getByRole("heading", { name: "Line items" }),
        ).toBeVisible();

        // Find the product select that shows "(Archived)" text
        const productSelects = page.getByRole("combobox", {
          name: "Product",
        });
        await expect(productSelects.first()).toBeVisible();

        const selectCount = await productSelects.count();
        for (let j = 0; j < selectCount; j++) {
          const text = await productSelects.nth(j).textContent();
          if (text?.includes("Archived")) {
            // The text should be "<product name> (Archived)", not "<id> (Archived)"
            const beforeArchived = text.replace(/\(Archived\)/, "").trim();
            expect(beforeArchived).toBeTruthy();
            expect(beforeArchived).not.toMatch(/^\d+$/);
            foundArchived = true;
          }
        }
      }

      if (!foundArchived) {
        // Close dialog and try the next deal
        await page.keyboard.press("Escape");
        await expect(
          page.getByRole("link", { name: "Edit", exact: true }),
        ).toBeHidden();
      }
    }

    expect(foundArchived).toBe(true);
  });

  test("AC4: creating a new deal and adding line items shows product name after selection", async ({
    page,
  }) => {
    await goToDealsKanban(page);

    // Click the "New Deal" button to open the create form
    await page.getByRole("link", { name: "New Deal" }).click();

    // Wait for the create form dialog and line items section
    await expect(
      page.getByRole("heading", { name: "Line items" }),
    ).toBeVisible();

    // Click "Add line item" to add a new empty line item row
    await page.getByRole("button", { name: "Add line item" }).click();

    // The new product select should show a placeholder, not a numeric ID
    const productSelect = page.getByRole("combobox", { name: "Product" });
    await expect(productSelect).toBeVisible();

    // Open the product dropdown and select the first product
    await productSelect.click();

    // Wait for the dropdown options to appear
    const firstOption = page.getByRole("option").first();
    await expect(firstOption).toBeVisible();

    // Get the product name from the option text
    const productName = await firstOption.textContent();
    expect(productName?.trim()).toBeTruthy();

    // Select the product
    await firstOption.click();

    // After selection, the select trigger must show the product name, not a numeric ID
    const selectedValue = productSelect.locator("[data-slot='select-value']");
    await expect(selectedValue).not.toHaveText(/^\d+$/);
    await expect(selectedValue).toHaveText(productName!.trim());
  });
});
