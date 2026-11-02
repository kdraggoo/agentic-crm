import { describe, expect, it } from "vitest";

import type { Product } from "../types";

import {
  clampQuantity,
  clampUnitPrice,
  computeLineItemsTotal,
  computeLineTotal,
  getProductLabel,
} from "./lineItemsUtils";

const makeProduct = (
  overrides: { id: number; name: string } & Record<string, unknown>,
): Product =>
  ({
    unit_price: 10,
    sku: null,
    description: "",
    is_archived: false,
    category: "hardware",
    created_at: "2024-01-01",
    updated_at: "2024-01-01",
    ...overrides,
  }) as Product;

describe("getProductLabel", () => {
  const productsMap = new Map<string, Product>([
    ["1", makeProduct({ id: 1, name: "Widget" })],
    ["2", makeProduct({ id: 2, name: "Gadget", is_archived: true })],
  ]);

  it("returns the product name for an active product", () => {
    expect(getProductLabel("1", productsMap, "Archived")).toBe("Widget");
  });

  it("appends the archived label for archived products", () => {
    expect(getProductLabel("2", productsMap, "Archived")).toBe(
      "Gadget (Archived)",
    );
  });

  it("returns undefined when productId is undefined", () => {
    expect(getProductLabel(undefined, productsMap, "Archived")).toBeUndefined();
  });

  it("returns undefined when productId is empty string", () => {
    expect(getProductLabel("", productsMap, "Archived")).toBeUndefined();
  });

  it("returns undefined when product is not in the map", () => {
    expect(getProductLabel("999", productsMap, "Archived")).toBeUndefined();
  });

  it("returns undefined when the map is empty", () => {
    expect(
      getProductLabel("1", new Map<string, Product>(), "Archived"),
    ).toBeUndefined();
  });
});

describe("clampQuantity", () => {
  it("returns 1 for NaN", () => {
    expect(clampQuantity(NaN)).toBe(1);
  });

  it("returns 1 for Infinity", () => {
    expect(clampQuantity(Infinity)).toBe(1);
  });

  it("clamps zero to the minimum", () => {
    expect(clampQuantity(0)).toBe(0.01);
  });

  it("clamps negative values to the minimum", () => {
    expect(clampQuantity(-5)).toBe(0.01);
  });

  it("preserves valid quantities", () => {
    expect(clampQuantity(3)).toBe(3);
    expect(clampQuantity(0.5)).toBe(0.5);
  });
});

describe("clampUnitPrice", () => {
  it("returns 0 for NaN", () => {
    expect(clampUnitPrice(NaN)).toBe(0);
  });

  it("returns 0 for Infinity", () => {
    expect(clampUnitPrice(Infinity)).toBe(0);
  });

  it("clamps negative values to 0", () => {
    expect(clampUnitPrice(-10)).toBe(0);
  });

  it("allows zero", () => {
    expect(clampUnitPrice(0)).toBe(0);
  });

  it("preserves valid prices", () => {
    expect(clampUnitPrice(25.5)).toBe(25.5);
  });
});

describe("computeLineTotal", () => {
  it("multiplies quantity by unit price", () => {
    expect(computeLineTotal(3, 10)).toBe(30);
  });

  it("handles fractional values", () => {
    expect(computeLineTotal(1.5, 20)).toBe(30);
  });

  it("returns 0 when either is zero", () => {
    expect(computeLineTotal(0, 100)).toBe(0);
    expect(computeLineTotal(5, 0)).toBe(0);
  });
});

describe("computeLineItemsTotal", () => {
  it("sums all line item totals", () => {
    const items = [
      { product_id: "1", quantity: 2, unit_price: 10 },
      { product_id: "2", quantity: 3, unit_price: 5 },
    ];
    expect(computeLineItemsTotal(items)).toBe(35);
  });

  it("returns 0 for empty array", () => {
    expect(computeLineItemsTotal([])).toBe(0);
  });

  it("handles a single item", () => {
    expect(
      computeLineItemsTotal([
        { product_id: "1", quantity: 4, unit_price: 7.5 },
      ]),
    ).toBe(30);
  });
});
