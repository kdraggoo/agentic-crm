import { createContext, useContext, useMemo, type ReactNode } from "react";

import { useConfigurationContext } from "../root/ConfigurationContext";
import type { Deal } from "../types";
import {
  isDealActive,
  medianAmount,
  scoreDeal,
  type PropensityResult,
} from "../providers/commons/propensityScoring";
import { useLatestActivityDates } from "./useLatestActivityDates";

/**
 * Data a DealCard needs to render its propensity badge. Computed once from
 * the Kanban board's deal list (plus the related notes and tasks) and shared
 * through context so each card can look up its result in O(1).
 */
interface DealPropensityContextValue {
  byDealId: Map<string | number, PropensityResult>;
}

const DealPropensityContext = createContext<DealPropensityContextValue>({
  byDealId: new Map(),
});

// eslint-disable-next-line react-refresh/only-export-components
export const useDealPropensity = (
  dealId: string | number,
): PropensityResult | undefined => {
  return useContext(DealPropensityContext).byDealId.get(dealId);
};

/**
 * Fetches the per-deal signals (latest deal note, latest contact note on a
 * linked contact, latest task on a linked contact) in bulk and computes the
 * score for every active deal. Child DealCards read the result from context.
 */
export const DealPropensityProvider = ({
  deals,
  children,
}: {
  deals: Deal[];
  children: ReactNode;
}) => {
  const { dealPipelineStatuses, dealStages } = useConfigurationContext();

  // Only consider active deals (not archived, not in a won/closed stage) for
  // the median and for scoring at all.
  const activeDeals = useMemo(
    () => deals.filter((deal) => isDealActive(deal, dealPipelineStatuses)),
    [deals, dealPipelineStatuses],
  );

  const dealIds = useMemo(
    () => activeDeals.map((deal) => deal.id),
    [activeDeals],
  );
  const contactIds = useMemo(() => {
    const ids = new Set<number | string>();
    for (const deal of activeDeals) {
      for (const id of deal.contact_ids ?? []) {
        ids.add(id);
      }
    }
    return Array.from(ids);
  }, [activeDeals]);

  const latestByDealNote = useLatestActivityDates({
    resource: "deal_notes",
    keyField: "deal_id",
    dateField: "date",
    ids: dealIds,
  });
  const latestByContactNote = useLatestActivityDates({
    resource: "contact_notes",
    keyField: "contact_id",
    dateField: "date",
    ids: contactIds,
  });
  // Tasks use `created_at` as their activity date; `done_date` isn't an event
  // the way adding a task is.
  const latestByTask = useLatestActivityDates({
    resource: "tasks",
    keyField: "contact_id",
    dateField: "created_at",
    ids: contactIds,
  });

  const value = useMemo<DealPropensityContextValue>(() => {
    const median = medianAmount(activeDeals.map((deal) => deal.amount));

    const byDealId = new Map<string | number, PropensityResult>();
    for (const deal of activeDeals) {
      const latestDealNote = latestByDealNote.get(deal.id) ?? null;
      const latestLinkedContactNote = latestFromIds(
        latestByContactNote,
        deal.contact_ids,
      );
      const latestLinkedTask = latestFromIds(latestByTask, deal.contact_ids);
      const latestActivity = latestOf([
        latestDealNote,
        latestLinkedContactNote,
        latestLinkedTask,
      ]);

      byDealId.set(
        deal.id,
        scoreDeal(deal, {
          dealStages,
          closedStages: dealPipelineStatuses,
          medianActiveAmount: median,
          latestActivityDate: latestActivity,
          latestDealNoteDate: latestDealNote,
        }),
      );
    }
    return { byDealId };
  }, [
    activeDeals,
    dealPipelineStatuses,
    dealStages,
    latestByContactNote,
    latestByDealNote,
    latestByTask,
  ]);

  return (
    <DealPropensityContext.Provider value={value}>
      {children}
    </DealPropensityContext.Provider>
  );
};

const latestFromIds = (
  map: Map<string | number, string>,
  ids: readonly (string | number)[] | undefined,
): string | null => {
  if (!ids?.length) return null;
  let latest: string | null = null;
  for (const id of ids) {
    const value = map.get(id);
    if (value && (!latest || latest < value)) latest = value;
  }
  return latest;
};

const latestOf = (
  dates: readonly (string | null | undefined)[],
): string | null => {
  let latest: string | null = null;
  for (const date of dates) {
    if (date && (!latest || latest < date)) latest = date;
  }
  return latest;
};
