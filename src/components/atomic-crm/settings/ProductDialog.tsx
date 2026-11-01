import { useTranslate } from "ra-core";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useConfigurationContext } from "../root/ConfigurationContext";
import type { Product } from "../types";

type ProductFormData = Pick<
  Product,
  "name" | "sku" | "category" | "unit_price" | "description"
>;

type ProductDialogProps = {
  open: boolean;
  title: string;
  product?: Product;
  onClose: () => void;
  onSubmit: (data: ProductFormData) => Promise<void>;
};

export function ProductDialog({
  open,
  title,
  product,
  onClose,
  onSubmit,
}: ProductDialogProps) {
  const translate = useTranslate();
  const { dealCategories } = useConfigurationContext();
  const [name, setName] = useState(product?.name ?? "");
  const [sku, setSku] = useState(product?.sku ?? "");
  const [category, setCategory] = useState(product?.category ?? "");
  const [unitPrice, setUnitPrice] = useState(
    product?.unit_price?.toString() ?? "",
  );
  const [description, setDescription] = useState(product?.description ?? "");
  const [submitting, setSubmitting] = useState(false);

  // Sync local state when the product prop changes (e.g. dialog reopened
  // for the same product after an external edit).
  useEffect(() => {
    setName(product?.name ?? "");
    setSku(product?.sku ?? "");
    setCategory(product?.category ?? "");
    setUnitPrice(product?.unit_price?.toString() ?? "");
    setDescription(product?.description ?? "");
  }, [product]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit({
        name,
        sku,
        category,
        unit_price: Math.max(0, parseFloat(unitPrice) || 0),
        description,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="product-name">
              {translate("resources.products.fields.name")}
            </Label>
            <Input
              id="product-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="product-unit-price">
              {translate("resources.products.fields.unit_price")}
            </Label>
            <Input
              id="product-unit-price"
              type="number"
              step="0.01"
              min="0"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="product-sku">
              {translate("resources.products.fields.sku")}
            </Label>
            <Input
              id="product-sku"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
            />
          </div>
          <div>
            <Label>{translate("resources.products.fields.category")}</Label>
            <Select
              value={category || undefined}
              onValueChange={(val) => setCategory(val ?? "")}
            >
              <SelectTrigger
                aria-label={translate("resources.products.fields.category")}
                className="w-full"
              >
                <SelectValue
                  placeholder={translate("resources.products.fields.category")}
                />
              </SelectTrigger>
              <SelectContent>
                {dealCategories.map((cat) => (
                  <SelectItem key={cat.value} value={cat.value}>
                    {cat.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="product-description">
              {translate("resources.products.fields.description")}
            </Label>
            <Input
              id="product-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {translate("ra.action.cancel")}
            </Button>
            <Button type="submit" disabled={submitting}>
              {translate("ra.action.save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
