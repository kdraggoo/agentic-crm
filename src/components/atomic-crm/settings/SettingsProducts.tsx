import { Archive, ArchiveRestore, Pencil, Plus, Trash2 } from "lucide-react";
import {
  useCreate,
  useDelete,
  useGetList,
  useNotify,
  useTranslate,
  useUpdate,
} from "ra-core";
import { useState, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import { useConfigurationContext } from "../root/ConfigurationContext";
import type { DealProduct, Product } from "../types";
import { ProductDialog } from "./ProductDialog";

type ProductFormData = Pick<
  Product,
  "name" | "sku" | "category" | "unit_price" | "description"
>;

export const SettingsProducts = () => {
  const translate = useTranslate();
  const { currency } = useConfigurationContext();
  const notify = useNotify();
  const { data: products } = useGetList<Product>("products", {
    pagination: { page: 1, perPage: 1000 },
    sort: { field: "name", order: "ASC" },
  });
  const { data: allDealProducts, total: dealProductsTotal } =
    useGetList<DealProduct>("deal_products", {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: "id", order: "ASC" },
    });
  const [update] = useUpdate<Product>();
  const [create] = useCreate<Product>();
  const [deleteOne] = useDelete<Product>();
  const [search, setSearch] = useState("");
  const [dialogState, setDialogState] = useState<
    { mode: "closed" } | { mode: "create" } | { mode: "edit"; product: Product }
  >({ mode: "closed" });

  // When the total exceeds what was fetched (PostgREST caps at 1000),
  // reference counts are unreliable, so we disable delete for all products.
  const isTruncated =
    dealProductsTotal != null &&
    allDealProducts != null &&
    dealProductsTotal > allDealProducts.length;

  const referenceCountMap = useMemo(() => {
    const map = new Map<string, number>();
    if (allDealProducts) {
      for (const dp of allDealProducts) {
        const key = String(dp.product_id);
        map.set(key, (map.get(key) ?? 0) + 1);
      }
    }
    return map;
  }, [allDealProducts]);

  const filteredProducts = useMemo(() => {
    if (!products) return [];
    if (!search) return products;
    const lower = search.toLowerCase();
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(lower) ||
        (p.sku ?? "").toLowerCase().includes(lower) ||
        (p.category ?? "").toLowerCase().includes(lower),
    );
  }, [products, search]);

  const activeProducts = useMemo(
    () => filteredProducts.filter((p) => !p.is_archived),
    [filteredProducts],
  );
  const archivedProducts = useMemo(
    () => filteredProducts.filter((p) => p.is_archived),
    [filteredProducts],
  );

  const handleArchive = useCallback(
    async (product: Product) => {
      await update("products", {
        id: product.id,
        data: { is_archived: true },
        previousData: product,
      });
    },
    [update],
  );

  const handleUnarchive = useCallback(
    async (product: Product) => {
      await update("products", {
        id: product.id,
        data: { is_archived: false },
        previousData: product,
      });
    },
    [update],
  );

  const handleDelete = useCallback(
    async (product: Product) => {
      try {
        await deleteOne("products", {
          id: product.id,
          previousData: product,
        });
      } catch {
        notify("resources.products.delete_error", { type: "error" });
      }
    },
    [deleteOne, notify],
  );

  const handleCreate = useCallback(
    async (data: ProductFormData) => {
      await create("products", {
        data: {
          ...data,
          is_archived: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      });
      setDialogState({ mode: "closed" });
    },
    [create],
  );

  const handleEdit = useCallback(
    async (data: ProductFormData) => {
      if (dialogState.mode !== "edit") return;
      await update("products", {
        id: dialogState.product.id,
        data: { ...data, updated_at: new Date().toISOString() },
        previousData: dialogState.product,
      });
      setDialogState({ mode: "closed" });
    },
    [dialogState, update],
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

  return (
    <Card id="products">
      <CardContent className="space-y-4">
        <h2 className="text-xl font-semibold text-muted-foreground">
          {translate("resources.products.name", { smart_count: 2 })}
        </h2>

        <div className="flex items-center gap-2">
          <Input
            type="search"
            placeholder={translate("resources.products.search_placeholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setDialogState({ mode: "create" })}
          >
            <Plus className="h-4 w-4 mr-1" />
            {translate("resources.products.action.create")}
          </Button>
        </div>

        {products?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {translate("resources.products.empty")}
          </p>
        )}

        {/* Column headers */}
        {(activeProducts.length > 0 || archivedProducts.length > 0) && (
          <div className="grid grid-cols-[1fr_80px_100px_100px_104px] gap-2 text-xs text-muted-foreground font-medium">
            <span>{translate("resources.products.fields.name")}</span>
            <span>{translate("resources.products.fields.sku")}</span>
            <span>{translate("resources.products.fields.category")}</span>
            <span>{translate("resources.products.fields.unit_price")}</span>
            <span />
          </div>
        )}

        {/* Active products */}
        {activeProducts.map((product) => {
          const refCount = referenceCountMap.get(String(product.id)) ?? 0;
          return (
            <div
              key={product.id}
              className="grid grid-cols-[1fr_80px_100px_100px_104px] gap-2 items-center text-sm"
            >
              <span className="font-medium truncate">{product.name}</span>
              <span className="text-muted-foreground truncate">
                {product.sku}
              </span>
              <span className="text-muted-foreground truncate">
                {product.category}
              </span>
              <span>{formatPrice(product.unit_price)}</span>
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  aria-label={translate("resources.products.action.edit")}
                  onClick={() => setDialogState({ mode: "edit", product })}
                >
                  <Pencil className="h-3 w-3" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  aria-label={translate("resources.products.action.archive")}
                  onClick={() => handleArchive(product)}
                >
                  <Archive className="h-3 w-3" />
                </Button>
                {!isTruncated && refCount === 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    aria-label={translate("ra.action.delete")}
                    onClick={() => handleDelete(product)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
          );
        })}

        {/* Archived section */}
        {archivedProducts.length > 0 && (
          <>
            <h3 className="text-lg font-semibold text-muted-foreground pt-2">
              {translate("resources.products.archived_section")}
            </h3>
            {archivedProducts.map((product) => {
              const refCount = referenceCountMap.get(String(product.id)) ?? 0;
              return (
                <div
                  key={product.id}
                  className="grid grid-cols-[1fr_80px_100px_100px_104px] gap-2 items-center text-sm opacity-60"
                >
                  <span className="font-medium truncate">{product.name}</span>
                  <span className="text-muted-foreground truncate">
                    {product.sku}
                  </span>
                  <span className="text-muted-foreground truncate">
                    {product.category}
                  </span>
                  <span>{formatPrice(product.unit_price)}</span>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={translate("resources.products.action.edit")}
                      onClick={() => setDialogState({ mode: "edit", product })}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={translate(
                        "resources.products.action.unarchive",
                      )}
                      onClick={() => handleUnarchive(product)}
                    >
                      <ArchiveRestore className="h-3 w-3" />
                    </Button>
                    {!isTruncated && refCount === 0 && (
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        aria-label={translate("ra.action.delete")}
                        onClick={() => handleDelete(product)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}

        {/* Create / Edit dialog */}
        {dialogState.mode !== "closed" && (
          <ProductDialog
            key={
              dialogState.mode === "edit"
                ? `edit-${dialogState.product.id}`
                : "create"
            }
            open
            title={
              dialogState.mode === "create"
                ? translate("resources.products.action.create")
                : translate("resources.products.action.edit")
            }
            product={
              dialogState.mode === "edit" ? dialogState.product : undefined
            }
            onClose={() => setDialogState({ mode: "closed" })}
            onSubmit={dialogState.mode === "create" ? handleCreate : handleEdit}
          />
        )}
      </CardContent>
    </Card>
  );
};
