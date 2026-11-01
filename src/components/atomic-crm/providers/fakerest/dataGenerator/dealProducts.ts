import { datatype, random } from "faker/locale/en_US";

import type { DealProduct } from "../../../types";
import type { Db } from "./types";

/**
 * Roughly half of deals get 1-3 line items, so the demo shows both
 * deals with and without line items.
 */
const LINE_ITEM_PROBABILITY = 0.5;

export const generateDealProducts = (db: Db): DealProduct[] => {
  const activeProducts = db.products.filter((p) => !p.is_archived);
  const archivedProducts = db.products.filter((p) => p.is_archived);
  if (activeProducts.length === 0) return [];

  const items: DealProduct[] = [];
  let nextId = 0;

  for (const deal of db.deals) {
    if (datatype.float({ min: 0, max: 1 }) > LINE_ITEM_PROBABILITY) {
      continue;
    }

    const lineCount = datatype.number({ min: 1, max: 3 });
    for (let i = 0; i < lineCount; i++) {
      const product = random.arrayElement(activeProducts);
      const priceVariation = datatype.number({ min: -10, max: 10 }) / 100 + 1;
      items.push({
        id: nextId++,
        deal_id: deal.id,
        product_id: product.id,
        quantity: datatype.number({ min: 1, max: 10 }),
        unit_price: parseFloat(
          (product.unit_price * priceVariation).toFixed(2),
        ),
        sort_order: i,
        created_at: deal.created_at,
        updated_at: deal.created_at,
      });
    }
  }

  // Guarantee at least one deal references an archived product (the loop
  // above only picks from activeProducts, so an explicit append is needed)
  if (archivedProducts.length > 0 && items.length > 0) {
    const archivedProduct = archivedProducts[0];
    // Find a deal that already has items and add an archived product reference
    const existingDealId = items[0].deal_id;
    const maxSortOrder = items
      .filter((i) => String(i.deal_id) === String(existingDealId))
      .reduce((max, i) => Math.max(max, i.sort_order), -1);
    items.push({
      id: nextId++,
      deal_id: existingDealId,
      product_id: archivedProduct.id,
      quantity: 2,
      unit_price: archivedProduct.unit_price,
      sort_order: maxSortOrder + 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  return items;
};
