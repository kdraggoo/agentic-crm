import { describe, expect, it } from "vitest";

import {
  clampQuantity,
  clampUnitPrice,
  computeLineTotal,
  computeLineItemsTotal,
} from "./lineItemsUtils";

describe("clampQuantity", () => {
  it("returns the value when it is a valid positive number", () => {
    expect(clampQuantity(5)).toBe(5);
  });

  it("clamps negative values to the minimum (0.01)", () => {
    expect(clampQuantity(-5)).toBe(0.01);
  });

  it("clamps zero to the minimum (0.01)", () => {
    expect(clampQuantity(0)).toBe(0.01);
  });

  it("returns 1 when input is NaN", () => {
    expect(clampQuantity(NaN)).toBe(1);
  });

  it("returns 1 when input is Infinity", () => {
    expect(clampQuantity(Infinity)).toBe(1);
  });

  it("preserves fractional quantities like 0.5", () => {
    expect(clampQuantity(0.5)).toBe(0.5);
  });
});

describe("clampUnitPrice", () => {
  it("returns the value when it is a valid non-negative number", () => {
    expect(clampUnitPrice(10)).toBe(10);
  });

  it("allows zero", () => {
    expect(clampUnitPrice(0)).toBe(0);
  });

  it("clamps negative values to zero", () => {
    expect(clampUnitPrice(-3.5)).toBe(0);
  });

  it("returns 0 when input is NaN", () => {
    expect(clampUnitPrice(NaN)).toBe(0);
  });

  it("returns 0 when input is Infinity", () => {
    expect(clampUnitPrice(Infinity)).toBe(0);
  });

  it("preserves fractional prices", () => {
    expect(clampUnitPrice(9.99)).toBe(9.99);
  });
});

describe("computeLineTotal", () => {
  it("multiplies quantity by unit price", () => {
    expect(computeLineTotal(3, 10)).toBe(30);
  });

  it("returns 0 when quantity is 0", () => {
    expect(computeLineTotal(0, 50)).toBe(0);
  });

  it("handles fractional prices", () => {
    expect(computeLineTotal(2, 9.99)).toBeCloseTo(19.98);
  });
});

describe("computeLineItemsTotal", () => {
  it("sums all line totals", () => {
    const items = [
      { product_id: "1", quantity: 2, unit_price: 10 },
      { product_id: "2", quantity: 3, unit_price: 5 },
    ];
    expect(computeLineItemsTotal(items)).toBe(35);
  });

  it("returns 0 for empty array", () => {
    expect(computeLineItemsTotal([])).toBe(0);
  });

  it("handles single item", () => {
    const items = [{ product_id: "1", quantity: 5, unit_price: 12.5 }];
    expect(computeLineItemsTotal(items)).toBeCloseTo(62.5);
  });

  it("handles items with zero quantity or price", () => {
    const items = [
      { product_id: "1", quantity: 0, unit_price: 100 },
      { product_id: "2", quantity: 5, unit_price: 0 },
      { product_id: "3", quantity: 2, unit_price: 25 },
    ];
    expect(computeLineItemsTotal(items)).toBe(50);
  });

  it("order of items does not affect total", () => {
    const items1 = [
      { product_id: "1", quantity: 1, unit_price: 100 },
      { product_id: "2", quantity: 2, unit_price: 50 },
    ];
    const items2 = [
      { product_id: "2", quantity: 2, unit_price: 50 },
      { product_id: "1", quantity: 1, unit_price: 100 },
    ];
    expect(computeLineItemsTotal(items1)).toBe(computeLineItemsTotal(items2));
  });
});
