import { Filter } from "lucide-react";
import { useGetList, useTranslate } from "ra-core";
import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router";

import { Card } from "@/components/ui/card";

import { useConfigurationContext } from "../root/ConfigurationContext";
import type { Deal } from "../types";
import {
  buildSalesFunnelRows,
  maxFunnelCount,
  type SalesFunnelRow,
} from "./salesFunnelAggregation";

const DEFAULT_LOCALE = "en-US";

const SALES_FUNNEL_PAGE_SIZE = 500;

const formatAmount = (amount: number, currency: string, locale: string) =>
  amount.toLocaleString(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  });

interface SalesFunnelBarProps {
  count: number;
  max: number;
  label: string;
}

const SalesFunnelBar = ({ count, max, label }: SalesFunnelBarProps) => {
  const width = max > 0 ? (count / max) * 100 : 0;
  return (
    <div
      className="h-2 w-full rounded-full bg-muted overflow-hidden"
      role="presentation"
      aria-hidden="true"
      data-testid={`sales-funnel-bar-${label}`}
    >
      <div
        className="h-full bg-primary rounded-full"
        style={{ width: `${width}%` }}
      />
    </div>
  );
};

interface SalesFunnelRowViewProps {
  row: SalesFunnelRow;
  max: number;
  currency: string;
  locale: string;
  onClick: (stageValue: string) => void;
  ariaLabel: string;
}

const SalesFunnelRowView = ({
  row,
  max,
  currency,
  locale,
  onClick,
  ariaLabel,
}: SalesFunnelRowViewProps) => {
  return (
    <li
      className="flex flex-col gap-1 cursor-pointer"
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onClick={() => onClick(row.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(row.value);
        }
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{row.label}</span>
        <span className="flex items-baseline gap-3 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{row.count}</span>
          <span>{formatAmount(row.amount, currency, locale)}</span>
        </span>
      </div>
      <SalesFunnelBar count={row.count} max={max} label={row.value} />
    </li>
  );
};

export const SalesFunnel = () => {
  const translate = useTranslate();
  const navigate = useNavigate();
  const { dealStages, dealPipelineStatuses, currency } =
    useConfigurationContext();

  const locale =
    typeof navigator !== "undefined"
      ? (navigator.languages?.[0] ?? navigator.language ?? DEFAULT_LOCALE)
      : DEFAULT_LOCALE;

  const { data, isPending } = useGetList<Deal>("deals", {
    pagination: { page: 1, perPage: SALES_FUNNEL_PAGE_SIZE },
    filter: { "archived_at@is": null },
  });

  const rows = useMemo(
    () => buildSalesFunnelRows(data, dealStages, dealPipelineStatuses),
    [data, dealStages, dealPipelineStatuses],
  );

  const max = useMemo(() => maxFunnelCount(rows), [rows]);

  const handleStageClick = useCallback(
    (stageValue: string) => {
      navigate(`/deals?scrollToStage=${encodeURIComponent(stageValue)}`);
    },
    [navigate],
  );

  if (isPending) {
    return null;
  }

  const isEmpty = rows.length === 0 || max === 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center">
        <div className="mr-3 flex">
          <Filter className="text-muted-foreground w-6 h-6" />
        </div>
        <h2 className="text-xl font-semibold text-muted-foreground">
          {translate("crm.dashboard.sales_funnel")}
        </h2>
      </div>
      <Card className="p-4">
        {isEmpty ? (
          <p className="text-sm text-muted-foreground">
            {translate("crm.dashboard.sales_funnel_empty")}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((row) => (
              <SalesFunnelRowView
                key={row.value}
                row={row}
                max={max}
                currency={currency}
                locale={locale}
                onClick={handleStageClick}
                ariaLabel={translate("crm.dashboard.view_deals_in_stage", {
                  stage: row.label,
                })}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
};
