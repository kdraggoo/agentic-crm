import { commerce, datatype, lorem, random } from "faker/locale/en_US";

import { defaultDealCategories } from "../../../root/defaultConfiguration";
import type { Product } from "../../../types";
import type { Db } from "./types";
import { randomFloat } from "./utils";

const PRODUCT_COUNT = 15;
const ARCHIVED_FRACTION = 0.13;

export const generateProducts = (_db: Db): Product[] => {
  const products = Array.from(Array(PRODUCT_COUNT).keys()).map((id) => {
    const name = commerce.productName();
    const category = random.arrayElement(defaultDealCategories).value;
    const sku = `SKU-${String(id + 1).padStart(4, "0")}`;
    const unit_price = randomFloat(10, 5000);
    const is_archived =
      datatype.number({ min: 0, max: 100 }) < ARCHIVED_FRACTION * 100;
    const created_at = new Date(
      Date.now() - datatype.number({ min: 30, max: 365 }) * 86400000,
    ).toISOString();

    return {
      id,
      name,
      sku,
      category,
      unit_price,
      description: lorem.sentence(),
      is_archived,
      sales_id: _db.sales?.[0]?.id,
      created_at,
      updated_at: created_at,
    };
  });

  // Guarantee at least one archived product for demo data
  if (!products.some((p) => p.is_archived)) {
    products[products.length - 1] = {
      ...products[products.length - 1],
      is_archived: true,
    };
  }

  return products;
};
