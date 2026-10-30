import { Draggable } from "@hello-pangea/dnd";
import { useRedirect, RecordContextProvider } from "ra-core";
import { ReferenceField } from "@/components/admin/reference-field";
import { NumberField } from "@/components/admin/number-field";
import { Card, CardContent } from "@/components/ui/card";

import { CompanyAvatar } from "../companies/CompanyAvatar";
import { useConfigurationContext } from "../root/ConfigurationContext";
import type { Deal } from "../types";
import { formatDealCategories } from "./dealUtils";
import { DealPropensityBadge } from "./DealPropensityBadge";

export const DealCard = ({ deal, index }: { deal: Deal; index: number }) => {
  if (!deal) return null;

  return (
    <Draggable draggableId={String(deal.id)} index={index}>
      {(provided, snapshot) => (
        <DealCardContent provided={provided} snapshot={snapshot} deal={deal} />
      )}
    </Draggable>
  );
};

export const DealCardContent = ({
  provided,
  snapshot,
  deal,
}: {
  provided?: any;
  snapshot?: any;
  deal: Deal;
}) => {
  const { dealCategories, currency } = useConfigurationContext();
  const redirect = useRedirect();
  const handleClick = () => {
    redirect(`/deals/${deal.id}/show`, undefined, undefined, undefined, {
      _scrollToTop: false,
    });
  };

  return (
    <div
      className="cursor-pointer"
      {...provided?.draggableProps}
      {...provided?.dragHandleProps}
      ref={provided?.innerRef}
      onClick={handleClick}
      // Override the role="button" accessible-name computation that would
      // otherwise concatenate every child text (and bring in random lorem
      // substrings from the deal name): a deterministic label keeps the
      // page's role=button landscape unambiguous for screen readers and tests.
      aria-label={`Deal ${deal.id}`}
    >
      <RecordContextProvider value={deal}>
        <Card
          className={`py-3 transition-all duration-200 ${
            snapshot?.isDragging
              ? "opacity-90 transform rotate-1 shadow-lg"
              : "shadow-sm hover:shadow-md"
          }`}
        >
          <CardContent className="px-3 flex flex-col gap-2">
            <div className="flex-1 flex items-start gap-2">
              <p className="flex-1 text-sm font-medium">
                <ReferenceField
                  source="company_id"
                  reference="companies"
                  link={false}
                />
                {" - "}
                {deal.name}
              </p>
              <ReferenceField
                source="company_id"
                reference="companies"
                link={false}
              >
                <CompanyAvatar width={20} height={20} />
              </ReferenceField>
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                <NumberField
                  source="amount"
                  options={{
                    notation: "compact",
                    style: "currency",
                    currency,
                    currencyDisplay: "narrowSymbol",
                    minimumSignificantDigits: 3,
                  }}
                />
                {deal.categories?.length ? ", " : ""}
                {formatDealCategories(dealCategories, deal.categories)}
              </p>
              <DealPropensityBadge deal={deal} />
            </div>
          </CardContent>
        </Card>
      </RecordContextProvider>
    </div>
  );
};
