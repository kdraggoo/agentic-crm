import { describe, expect, it } from "vitest";

import { generateProducts } from "./products";
import type { Db } from "./types";

describe("generateProducts", () => {
  const emptyDb = {} as Db;

  it("generates products", () => {
    const products = generateProducts(emptyDb);
    expect(products.length).toBeGreaterThan(0);
  });

  it("all products have required fields", () => {
    const products = generateProducts(emptyDb);
    for (const product of products) {
      expect(product.name).toBeTruthy();
      expect(product.sku).toMatch(/^SKU-\d+$/);
      expect(typeof product.unit_price).toBe("number");
      expect(product.unit_price).toBeGreaterThan(0);
      expect(typeof product.is_archived).toBe("boolean");
      expect(product.created_at).toBeTruthy();
      expect(product.updated_at).toBeTruthy();
    }
  });

  it("guarantees at least one archived product", () => {
    // Run multiple times to verify the guarantee
    for (let i = 0; i < 10; i++) {
      const products = generateProducts(emptyDb);
      const archivedCount = products.filter((p) => p.is_archived).length;
      expect(archivedCount).toBeGreaterThanOrEqual(1);
    }
  });

  it("generates unique IDs", () => {
    const products = generateProducts(emptyDb);
    const ids = products.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("generates unique SKUs", () => {
    const products = generateProducts(emptyDb);
    const skus = products.map((p) => p.sku);
    expect(new Set(skus).size).toBe(skus.length);
  });
});
