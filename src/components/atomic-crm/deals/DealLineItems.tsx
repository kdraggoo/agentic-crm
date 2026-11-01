import { useGetList, useTranslate, type Identifier } from "ra-core";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";

import { useConfigurationContext } from "../root/ConfigurationContext";
import type { DealProduct, Product } from "../types";
import { computeLineTotal, computeLineItemsTotal } from "./lineItemsUtils";

interface DealLineItemsProps {
  dealId: Identifier;
}

export const DealLineItems = ({ dealId }: DealLineItemsProps) => {
  const translate = useTranslate();
  const { currency } = useConfigurationContext();

  const { data: lineItems } = useGetList<DealProduct>("deal_products", {
    filter: { deal_id: dealId },
    pagination: { page: 1, perPage: 1000 },
    sort: { field: "sort_order", order: "ASC" },
  });

  const { data: products } = useGetList<Product>("products", {
    pagination: { page: 1, perPage: 1000 },
    sort: { field: "name", order: "ASC" },
  });

  const productMap = useMemo(() => {
    if (!products) return new Map<string, Product>();
    return new Map(products.map((p) => [String(p.id), p]));
  }, [products]);

  const formatPrice = (price: number) =>
    price.toLocaleString("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    });

  if (!lineItems || lineItems.length === 0) return null;

  const items = lineItems.map((item) => {
    const product = productMap.get(String(item.product_id));
    return {
      ...item,
      productName: product?.name ?? String(item.product_id),
      productSku: product?.sku,
      isArchived: product?.is_archived ?? false,
      lineTotal: computeLineTotal(item.quantity, item.unit_price),
    };
  });

  const total = computeLineItemsTotal(lineItems);

  return (
    <div className="m-4 space-y-2">
      <span className="text-xs text-muted-foreground tracking-wide">
        {translate("resources.deal_products.section_title")}
      </span>
      <div className="text-sm space-y-1">
        {items.map((item) => (
          <div key={item.id} className="flex justify-between items-center">
            <span className="flex items-center gap-2">
              <span>{item.productName}</span>
              {item.productSku && (
                <span className="text-muted-foreground text-xs">
                  ({item.productSku})
                </span>
              )}
              {item.isArchived && (
                <Badge variant="outline" className="text-xs">
                  {translate("resources.products.fields.is_archived")}
                </Badge>
              )}
              <span className="text-muted-foreground">
                × {item.quantity} @ {formatPrice(item.unit_price)}
              </span>
            </span>
            <span className="font-medium">{formatPrice(item.lineTotal)}</span>
          </div>
        ))}
      </div>
      <div className="flex justify-between items-center text-sm font-semibold pt-1 border-t">
        <span>{translate("resources.deal_products.line_items_total")}</span>
        <span>{formatPrice(total)}</span>
      </div>
    </div>
  );
};
