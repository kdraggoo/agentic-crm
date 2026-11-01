import { useQueryClient } from "@tanstack/react-query";
import {
  CreateBase,
  Form,
  useCreateContext,
  useDataProvider,
  useGetIdentity,
  useListContext,
  useNotify,
  useRedirect,
  type GetListResult,
} from "ra-core";
import { useRef } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

import { FormToolbar } from "../layout/FormToolbar";
import type { Deal } from "../types";
import { DealInputs } from "./DealInputs";
import { saveLineItems, type LineItemInput } from "./lineItemsUtils";

export const DealCreate = ({ open }: { open: boolean }) => {
  const redirect = useRedirect();
  const dataProvider = useDataProvider();
  const { data: allDeals } = useListContext<Deal>();

  const handleClose = () => {
    redirect("/deals");
  };

  const queryClient = useQueryClient();

  // Ref to capture line items from form before submission
  const lineItemsRef = useRef<LineItemInput[]>([]);

  const notify = useNotify();

  const onSuccess = async (deal: Deal) => {
    // Save line items captured from form state (not from server response)
    try {
      await saveLineItems(dataProvider, deal.id, lineItemsRef.current);
    } catch {
      notify("resources.deal_products.sync_error", { type: "error" });
    }

    if (!allDeals) {
      redirect("/deals");
      return;
    }
    // increase the index of all deals in the same stage as the new deal
    // first, get the list of deals in the same stage
    const deals = allDeals.filter(
      (d: Deal) => d.stage === deal.stage && d.id !== deal.id,
    );
    // update the actual deals in the database
    await Promise.all(
      deals.map(async (oldDeal) =>
        dataProvider.update("deals", {
          id: oldDeal.id,
          data: { index: oldDeal.index + 1 },
          previousData: oldDeal,
        }),
      ),
    );
    // refresh the list of deals in the cache as we used dataProvider.update(),
    // which does not update the cache
    const dealsById = deals.reduce(
      (acc, d) => ({
        ...acc,
        [d.id]: { ...d, index: d.index + 1 },
      }),
      {} as { [key: string]: Deal },
    );
    const now = Date.now();
    queryClient.setQueriesData<GetListResult | undefined>(
      { queryKey: ["deals", "getList"] },
      (res) => {
        if (!res) return res;
        return {
          ...res,
          data: res.data.map((d: Deal) => dealsById[d.id] || d),
        };
      },
      { updatedAt: now },
    );
    redirect("/deals");
  };

  const { identity } = useGetIdentity();

  return (
    <Dialog open={open} onOpenChange={() => handleClose()}>
      <DialogContent className="lg:max-w-4xl overflow-y-auto max-h-9/10 top-1/20 translate-y-0">
        <CreateBase
          resource="deals"
          mutationOptions={{ onSuccess }}
          transform={(data: Record<string, unknown>) => {
            // Capture line items before stripping them from the deal payload
            lineItemsRef.current =
              (data.line_items as LineItemInput[] | undefined) ?? [];
            const { line_items: _, ...dealData } = data;
            return dealData;
          }}
        >
          <CreateHeader />
          <Form
            defaultValues={{
              sales_id: identity?.id,
              contact_ids: [],
              index: 0,
            }}
          >
            <DealInputs />
            <FormToolbar />
          </Form>
        </CreateBase>
      </DialogContent>
    </Dialog>
  );
};

const CreateHeader = () => {
  const { defaultTitle } = useCreateContext();
  return (
    <DialogTitle className="text-xl font-semibold">{defaultTitle}</DialogTitle>
  );
};
