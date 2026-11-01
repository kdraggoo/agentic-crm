import { describe, expect, it } from "vitest";

import { canAccess } from "./canAccess";

describe("canAccess", () => {
  it("allows admin full access to all resources", () => {
    expect(canAccess("admin", { action: "list", resource: "products" })).toBe(
      true,
    );
    expect(canAccess("admin", { action: "edit", resource: "products" })).toBe(
      true,
    );
    expect(canAccess("admin", { action: "delete", resource: "sales" })).toBe(
      true,
    );
  });

  it("blocks non-admin from sales resource", () => {
    expect(canAccess("user", { action: "list", resource: "sales" })).toBe(
      false,
    );
  });

  it("blocks non-admin from configuration resource", () => {
    expect(
      canAccess("user", { action: "list", resource: "configuration" }),
    ).toBe(false);
  });

  it("allows non-admin to read products", () => {
    expect(canAccess("user", { action: "list", resource: "products" })).toBe(
      true,
    );
    expect(canAccess("user", { action: "show", resource: "products" })).toBe(
      true,
    );
  });

  it("blocks non-admin from writing products", () => {
    expect(canAccess("user", { action: "edit", resource: "products" })).toBe(
      false,
    );
    expect(canAccess("user", { action: "create", resource: "products" })).toBe(
      false,
    );
    expect(canAccess("user", { action: "delete", resource: "products" })).toBe(
      false,
    );
  });

  it("allows non-admin to access deals and other resources", () => {
    expect(canAccess("user", { action: "list", resource: "deals" })).toBe(true);
    expect(canAccess("user", { action: "edit", resource: "deals" })).toBe(true);
    expect(canAccess("user", { action: "list", resource: "contacts" })).toBe(
      true,
    );
  });

  it("allows non-admin read access to deal_products", () => {
    expect(
      canAccess("user", { action: "list", resource: "deal_products" }),
    ).toBe(true);
  });
});
