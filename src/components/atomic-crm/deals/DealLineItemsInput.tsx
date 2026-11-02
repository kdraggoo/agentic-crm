import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useGetList, useTranslate } from "ra-core";
import { useCallback, useMemo, useRef } from "react";
import { useFieldArray, useFormContext, useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";

import { useConfigurationContext } from "../root/ConfigurationContext";
import type { Product } from "../types";
import {
  clampQuantity,
  clampUnitPrice,
  computeLineTotal,
  computeLineItemsTotal,
  getProductLabel,
  type LineItemInput,
} from "./lineItemsUtils";

/**
 * Displays the product name (or a placeholder / loading label) inside the
 * Select trigger. Uses the same `data-slot="select-value"` attribute that
 * Base UI's SelectValue renders, so existing selectors continue to work.
 *
 * This replaces SelectValue to avoid the raw numeric product ID being
 * briefly shown before products finish loading. Base UI's SelectValue can
 * only resolve labels from mounted SelectItem components, which aren't
 * available until the popup opens for the first time.
 */
function ProductSelectLabel({
  productId,
  allProductsMap,
  isLoading,
  archivedLabel,
  loadingLabel,
  placeholderLabel,
  unknownLabel,
}: {
  productId: string | undefined;
  allProductsMap: Map<string, Product>;
  isLoading: boolean;
  archivedLabel: string;
  loadingLabel: string;
  placeholderLabel: string;
  unknownLabel: string;
}) {
  let text: string;
  if (!productId) {
    text = isLoading ? loadingLabel : placeholderLabel;
  } else if (isLoading) {
    text = loadingLabel;
  } else {
    text =
      getProductLabel(productId, allProductsMap, archivedLabel) ?? unknownLabel;
  }

  const isPlaceholder = !productId || isLoading;
  return (
    <span
      data-slot="select-value"
      className={`flex flex-1 text-left ${isPlaceholder ? "text-muted-foreground" : ""}`}
    >
      {text}
    </span>
  );
}

export const DealLineItemsInput = () => {
  const translate = useTranslate();
  const { currency } = useConfigurationContext();
  const { control, setValue } = useFormContext();
  const { fields, append, remove, swap } = useFieldArray({
    control,
    name: "line_items",
  });

  const EMPTY_LINE_ITEMS: LineItemInput[] = useRef<LineItemInput[]>([]).current;
  const lineItems: LineItemInput[] =
    useWatch({ control, name: "line_items" }) ?? EMPTY_LINE_ITEMS;

  // Fetch all products (including archived) so pre-filled rows can show their product
  const { data: allProducts, isLoading: isLoadingProducts } =
    useGetList<Product>("products", {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: "name", order: "ASC" },
    });

  const activeProducts = useMemo(
    () => allProducts?.filter((p) => !p.is_archived) ?? [],
    [allProducts],
  );

  // Build a map of all products for lookup (including archived)
  const allProductsMap = useMemo(() => {
    if (!allProducts) return new Map<string, Product>();
    return new Map(allProducts.map((p) => [String(p.id), p]));
  }, [allProducts]);

  const handleAddItem = useCallback(() => {
    append({ product_id: "", quantity: 1, unit_price: 0 });
  }, [append]);

  const handleProductChange = useCallback(
    (index: number, productId: string | number | null) => {
      const id = productId != null ? String(productId) : "";
      const product = allProductsMap.get(id);
      setValue(`line_items.${index}.product_id`, id);
      if (product) {
        setValue(`line_items.${index}.unit_price`, product.unit_price);
      }
    },
    [allProductsMap, setValue],
  );

  const formatPrice = useCallback(
    (price: number) =>
      price.toLocaleString("en-US", {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
      }),
    [currency],
  );

  const archivedLabel = translate("resources.products.fields.is_archived");
  const loadingLabel = translate(
    "resources.deal_products.fields.product_loading",
  );
  const unknownLabel = translate(
    "resources.deal_products.fields.product_unknown",
  );

  const total = useMemo(() => computeLineItemsTotal(lineItems), [lineItems]);
  const hasItems = lineItems.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h6 className="text-lg font-semibold">
          {translate("resources.deal_products.section_title")}
        </h6>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleAddItem}
        >
          <Plus className="h-4 w-4 mr-1" />
          {translate("resources.deal_products.add")}
        </Button>
      </div>

      {fields.map((field, index) => {
        const item = lineItems[index];
        const lineTotal = item
          ? computeLineTotal(item.quantity, item.unit_price)
          : 0;
        const currentProductId =
          item?.product_id != null && item.product_id !== ""
            ? String(item.product_id)
            : undefined;

        return (
          <div key={field.id} className="flex items-end gap-3">
            <div className="flex-1">
              <Label>
                {translate("resources.deal_products.fields.product_id")}
              </Label>
              <Select
                value={currentProductId}
                onValueChange={(val) =>
                  handleProductChange(index, val as string)
                }
              >
                <SelectTrigger
                  aria-label={translate(
                    "resources.deal_products.fields.product_id",
                  )}
                  className="w-full"
                >
                  <ProductSelectLabel
                    productId={currentProductId}
                    allProductsMap={allProductsMap}
                    isLoading={isLoadingProducts}
                    archivedLabel={archivedLabel}
                    loadingLabel={loadingLabel}
                    unknownLabel={unknownLabel}
                    placeholderLabel={translate(
                      "resources.deal_products.fields.product_id",
                    )}
                  />
                </SelectTrigger>
                <SelectContent>
                  {activeProducts.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}
                    </SelectItem>
                  ))}
                  {currentProductId &&
                    allProductsMap.get(currentProductId)?.is_archived && (
                      <SelectItem
                        key={currentProductId}
                        value={currentProductId}
                        disabled
                      >
                        {`${allProductsMap.get(currentProductId)?.name} (${archivedLabel})`}
                      </SelectItem>
                    )}
                </SelectContent>
              </Select>
            </div>
            <div className="w-24">
              <Label htmlFor={`line-qty-${index}`}>
                {translate("resources.deal_products.fields.quantity")}
              </Label>
              <Input
                id={`line-qty-${index}`}
                type="number"
                min="0.01"
                step="0.01"
                value={item?.quantity ?? 1}
                onChange={(e) =>
                  setValue(
                    `line_items.${index}.quantity`,
                    clampQuantity(parseFloat(e.target.value)),
                  )
                }
                aria-label={translate(
                  "resources.deal_products.fields.quantity",
                )}
              />
            </div>
            <div className="w-28">
              <Label htmlFor={`line-price-${index}`}>
                {translate("resources.deal_products.fields.unit_price")}
              </Label>
              <Input
                id={`line-price-${index}`}
                type="number"
                step="0.01"
                min="0"
                value={item?.unit_price ?? 0}
                onChange={(e) =>
                  setValue(
                    `line_items.${index}.unit_price`,
                    clampUnitPrice(parseFloat(e.target.value)),
                  )
                }
                aria-label={translate(
                  "resources.deal_products.fields.unit_price",
                )}
              />
            </div>
            <div className="w-24 text-right text-sm font-medium self-center pb-1">
              {formatPrice(lineTotal)}
            </div>
            <div className="flex flex-col gap-0.5">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                disabled={index === 0}
                onClick={() => swap(index, index - 1)}
                aria-label="Move up"
              >
                <ArrowUp className="h-3 w-3" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                disabled={index === fields.length - 1}
                onClick={() => swap(index, index + 1)}
                aria-label="Move down"
              >
                <ArrowDown className="h-3 w-3" />
              </Button>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => remove(index)}
              aria-label={translate("resources.deal_products.remove")}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        );
      })}

      {hasItems && (
        <div className="flex justify-end items-center gap-2 text-sm font-semibold pt-2 border-t">
          <span>{translate("resources.deal_products.line_items_total")}</span>
          <span>{formatPrice(total)}</span>
        </div>
      )}
    </div>
  );
};
