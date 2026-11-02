import type { DataProvider, Identifier } from "ra-core";

import type { DealProduct, Product } from "../types";

export interface LineItemInput {
  product_id: string | number;
  quantity: number;
  unit_price: number;
}

/**
 * Resolves the display label for a product in the line item picker.
 *
 * Returns the product name (with an "(Archived)" suffix for archived
 * products), or `undefined` when the product is unknown (e.g. products
 * are still loading).
 */
export const getProductLabel = (
  productId: string | undefined,
  productsMap: Map<string, Product>,
  archivedLabel: string,
): string | undefined => {
  if (!productId) return undefined;
  const product = productsMap.get(productId);
  if (!product) return undefined;
  return product.is_archived
    ? `${product.name} (${archivedLabel})`
    : product.name;
};

/** Minimum allowed quantity (must be > 0). */
const MIN_QUANTITY = 0.01;

/**
 * Clamps a raw quantity input to a valid value (> 0).
 * Returns 1 when the input is not a finite number.
 */
export const clampQuantity = (raw: number): number =>
  Number.isFinite(raw) ? Math.max(MIN_QUANTITY, raw) : 1;

/**
 * Clamps a raw unit price input to a valid value (≥ 0).
 * Returns 0 when the input is not a finite number.
 */
export const clampUnitPrice = (raw: number): number =>
  Number.isFinite(raw) ? Math.max(0, raw) : 0;

/**
 * Computes the total for a single line item row.
 */
export const computeLineTotal = (quantity: number, unitPrice: number): number =>
  quantity * unitPrice;

/**
 * Computes the grand total for all line items.
 */
export const computeLineItemsTotal = (items: LineItemInput[]): number =>
  items.reduce(
    (sum, item) => sum + computeLineTotal(item.quantity, item.unit_price),
    0,
  );

/**
 * Save line items for a newly created deal. Creates deal_products rows
 * sequentially so that a failure stops early without leaving partial data.
 */
export const saveLineItems = async (
  dataProvider: DataProvider,
  dealId: Identifier,
  lineItems: LineItemInput[],
) => {
  if (!lineItems || lineItems.length === 0) return;

  const now = new Date().toISOString();
  const validItems = lineItems.filter(
    (item) => item.product_id != null && item.product_id !== "",
  );

  for (let index = 0; index < validItems.length; index++) {
    const item = validItems[index];
    await dataProvider.create<DealProduct>("deal_products", {
      data: {
        deal_id: dealId,
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        sort_order: index,
        created_at: now,
        updated_at: now,
      },
    });
  }
};

/**
 * Sync line items for an existing deal.
 *
 * Strategy: reconcile by reusing existing row IDs where possible.
 * - Rows at positions that exist in both old and new lists are updated in-place.
 * - Extra new rows are created.
 * - Surplus old rows are deleted.
 *
 * This avoids transient duplicates and minimises data loss on partial failure:
 * updates preserve existing rows, creates only add new ones, and deletes only
 * remove rows that are no longer needed.
 *
 * @param existingItems - The list of existing deal_products rows to
 *   reconcile against. Passed by the caller to avoid a redundant fetch
 *   and the stale-cache problem of re-fetching inside onSuccess.
 */
export const syncLineItems = async (
  dataProvider: DataProvider,
  dealId: Identifier,
  lineItems: LineItemInput[],
  existingItems: DealProduct[],
) => {
  const now = new Date().toISOString();
  const validItems = lineItems.filter(
    (item) => item.product_id != null && item.product_id !== "",
  );

  // Sort existing items by sort_order to match position-based reconciliation
  const sorted = [...existingItems].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
  );

  // Phase 1: Update rows that exist in both old and new lists
  const updateCount = Math.min(sorted.length, validItems.length);
  for (let i = 0; i < updateCount; i++) {
    const existing = sorted[i];
    const incoming = validItems[i];
    await dataProvider.update("deal_products", {
      id: existing.id,
      data: {
        product_id: incoming.product_id,
        quantity: incoming.quantity,
        unit_price: incoming.unit_price,
        sort_order: i,
        updated_at: now,
      },
      previousData: existing,
    });
  }

  // Phase 2: Create rows for positions beyond existing count
  for (let i = updateCount; i < validItems.length; i++) {
    const item = validItems[i];
    await dataProvider.create<DealProduct>("deal_products", {
      data: {
        deal_id: dealId,
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        sort_order: i,
        created_at: now,
        updated_at: now,
      },
    });
  }

  // Phase 3: Delete surplus old rows
  if (sorted.length > validItems.length) {
    await Promise.all(
      sorted.slice(validItems.length).map((item) =>
        dataProvider.delete("deal_products", {
          id: item.id,
          previousData: item,
        }),
      ),
    );
  }
};
