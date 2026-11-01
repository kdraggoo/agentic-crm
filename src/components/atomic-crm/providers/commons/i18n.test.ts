import { describe, expect, it } from "vitest";

import { englishCrmMessages } from "./englishCrmMessages";
import { frenchCrmMessages } from "./frenchCrmMessages";

/**
 * Recursively collect all leaf key paths from a nested object.
 */
function collectKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      keys.push(...collectKeys(value as Record<string, unknown>, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

describe("i18n product and deal_products keys", () => {
  const enKeys = collectKeys(englishCrmMessages);
  const frKeys = collectKeys(frenchCrmMessages);

  it("English has products i18n keys", () => {
    const productKeys = enKeys.filter((k) =>
      k.startsWith("resources.products."),
    );
    expect(productKeys.length).toBeGreaterThan(0);
    expect(productKeys).toContain("resources.products.name");
    expect(productKeys).toContain("resources.products.fields.name");
    expect(productKeys).toContain("resources.products.fields.unit_price");
    expect(productKeys).toContain("resources.products.fields.sku");
    expect(productKeys).toContain("resources.products.fields.category");
    expect(productKeys).toContain("resources.products.action.create");
    expect(productKeys).toContain("resources.products.action.archive");
    expect(productKeys).toContain("resources.products.action.unarchive");
    expect(productKeys).toContain("resources.products.search_placeholder");
  });

  it("English has deal_products i18n keys", () => {
    const dpKeys = enKeys.filter((k) =>
      k.startsWith("resources.deal_products."),
    );
    expect(dpKeys.length).toBeGreaterThan(0);
    expect(dpKeys).toContain("resources.deal_products.section_title");
    expect(dpKeys).toContain("resources.deal_products.add");
    expect(dpKeys).toContain("resources.deal_products.remove");
    expect(dpKeys).toContain("resources.deal_products.line_items_total");
    expect(dpKeys).toContain("resources.deal_products.fields.product_id");
    expect(dpKeys).toContain("resources.deal_products.fields.quantity");
    expect(dpKeys).toContain("resources.deal_products.fields.unit_price");
  });

  it("French has matching keys for every English product key", () => {
    const enProductKeys = enKeys.filter(
      (k) =>
        k.startsWith("resources.products.") ||
        k.startsWith("resources.deal_products."),
    );
    for (const key of enProductKeys) {
      expect(frKeys).toContain(key);
    }
  });
});
