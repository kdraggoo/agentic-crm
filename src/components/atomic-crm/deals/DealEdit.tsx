import {
  EditBase,
  Form,
  useDataProvider,
  useEditContext,
  useGetList,
  useNotify,
  useRecordContext,
  useRedirect,
  useTranslate,
} from "ra-core";
import { type MutableRefObject, useMemo, useRef } from "react";
import { Link } from "react-router";
import { DeleteButton } from "@/components/admin/delete-button";
import { ReferenceField } from "@/components/admin/reference-field";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

import { FormToolbar } from "../layout/FormToolbar";
import { CompanyAvatar } from "../companies/CompanyAvatar";
import type { Deal, DealProduct } from "../types";
import { DealInputs } from "./DealInputs";
import { syncLineItems, type LineItemInput } from "./lineItemsUtils";

export const DealEdit = ({ open, id }: { open: boolean; id?: string }) => {
  const redirect = useRedirect();
  const notify = useNotify();
  const dataProvider = useDataProvider();

  // Refs to capture line items from form before submission
  const lineItemsRef = useRef<LineItemInput[]>([]);
  const existingItemsRef = useRef<DealProduct[]>([]);

  const handleClose = () => {
    redirect("/deals", undefined, undefined, undefined, {
      _scrollToTop: false,
    });
  };

  return (
    <Dialog open={open} onOpenChange={() => handleClose()}>
      <DialogContent className="lg:max-w-4xl overflow-y-auto max-h-9/10 top-1/20 translate-y-0">
        {id ? (
          <EditBase
            id={id}
            mutationMode="pessimistic"
            transform={(data: Record<string, unknown>) => {
              // Capture line items before stripping from deal payload
              lineItemsRef.current =
                (data.line_items as LineItemInput[] | undefined) ?? [];
              const { line_items: _, ...dealData } = data;
              return dealData;
            }}
            mutationOptions={{
              onSuccess: async (_deal: Deal) => {
                let syncFailed = false;
                try {
                  await syncLineItems(
                    dataProvider,
                    id,
                    lineItemsRef.current,
                    existingItemsRef.current,
                  );
                } catch {
                  syncFailed = true;
                  notify("resources.deal_products.sync_error", {
                    type: "error",
                  });
                }
                if (!syncFailed) {
                  notify("resources.deals.updated", {});
                }
                redirect(`/deals/${id}/show`, undefined, undefined, undefined, {
                  _scrollToTop: false,
                });
              },
            }}
          >
            <EditHeader />
            <DealEditForm dealId={id} existingItemsRef={existingItemsRef} />
          </EditBase>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};

const DealEditForm = ({
  dealId,
  existingItemsRef,
}: {
  dealId: string;
  existingItemsRef: MutableRefObject<DealProduct[]>;
}) => {
  const { data: existingLineItems, isLoading } = useGetList<DealProduct>(
    "deal_products",
    {
      filter: { deal_id: dealId },
      pagination: { page: 1, perPage: 1000 },
      sort: { field: "sort_order", order: "ASC" },
    },
  );

  const defaultLineItems = useMemo(() => {
    const items = existingLineItems ?? [];
    // Store the fetched rows so onSuccess can pass them to syncLineItems
    // without an additional fetch (avoids stale-cache problems).
    existingItemsRef.current = items;
    return items.map((item) => ({
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price: item.unit_price,
    }));
  }, [existingLineItems, existingItemsRef]);

  // Wait for deal_products to load before rendering the form so that
  // defaultValues includes any existing line items. Without this gate,
  // the form could mount with an empty line_items array and a save
  // would silently delete all existing line items.
  if (isLoading) {
    return null;
  }

  return (
    <Form defaultValues={{ line_items: defaultLineItems }}>
      <DealInputs />
      <FormToolbar />
    </Form>
  );
};

function EditHeader() {
  const translate = useTranslate();
  const { defaultTitle } = useEditContext<Deal>();
  const deal = useRecordContext<Deal>();
  if (!deal) {
    return null;
  }

  return (
    <DialogTitle className="pb-0">
      <div className="flex justify-between items-start">
        <div className="flex items-center gap-4">
          <ReferenceField source="company_id" reference="companies" link="show">
            <CompanyAvatar />
          </ReferenceField>
          <h2 className="text-xl font-semibold">{defaultTitle}</h2>
        </div>
        <div className="flex gap-2 pr-12">
          <DeleteButton />
          <Link
            to={`/deals/${deal.id}/show`}
            className={cn(buttonVariants({ variant: "outline" }), "h-9")}
          >
            {translate("resources.deals.action.back_to_deal")}
          </Link>
        </div>
      </div>
    </DialogTitle>
  );
}
