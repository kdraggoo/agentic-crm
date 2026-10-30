import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useGetList } from "ra-core";

import { useConfigurationContext } from "../root/ConfigurationContext";
import type { ContactNote, Deal, DealNote, Task } from "../types";
import {
  isDealActive,
  medianAmount,
  scoreDeal,
  type PropensityResult,
} from "../providers/commons/propensityScoring";

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

  // Fetch the latest 250 of each signal source for the active deals. Using
  // `enabled` so we don't fire pointless requests before deals are loaded.
  const { data: dealNotes = [] } = useGetList<DealNote>(
    "deal_notes",
    {
      pagination: { page: 1, perPage: 250 },
      sort: { field: "date", order: "DESC" },
      filter: dealIds.length ? { "deal_id@in": `(${dealIds.join(",")})` } : {},
    },
    { enabled: dealIds.length > 0 },
  );

  const { data: contactNotes = [] } = useGetList<ContactNote>(
    "contact_notes",
    {
      pagination: { page: 1, perPage: 250 },
      sort: { field: "date", order: "DESC" },
      filter: contactIds.length
        ? { "contact_id@in": `(${contactIds.join(",")})` }
        : {},
    },
    { enabled: contactIds.length > 0 },
  );

  const { data: tasks = [] } = useGetList<Task>(
    "tasks",
    {
      pagination: { page: 1, perPage: 250 },
      sort: { field: "created_at", order: "DESC" },
      filter: contactIds.length
        ? { "contact_id@in": `(${contactIds.join(",")})` }
        : {},
    },
    { enabled: contactIds.length > 0 },
  );

  const value = useMemo<DealPropensityContextValue>(() => {
    const median = medianAmount(activeDeals.map((deal) => deal.amount));

    // Pre-index the latest date per deal and per contact so scoring is O(n).
    const latestByDealNote = latestDateByKey(dealNotes, (note) => note.deal_id);
    const latestByContactNote = latestDateByKey(
      contactNotes,
      (note) => note.contact_id,
    );
    const latestByTask = latestDateByKey(
      tasks,
      (task) => task.contact_id,
      (task) =>
        // tasks use `created_at` as their activity date; `done_date` isn't an
        // event the way adding a task is
        task.created_at ?? null,
    );

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
    contactNotes,
    dealNotes,
    dealPipelineStatuses,
    dealStages,
    tasks,
  ]);

  return (
    <DealPropensityContext.Provider value={value}>
      {children}
    </DealPropensityContext.Provider>
  );
};

const latestDateByKey = <T,>(
  items: readonly T[],
  key: (item: T) => string | number | undefined,
  dateOf: (item: T) => string | null | undefined = (item) =>
    (item as { date?: string | null }).date ?? null,
): Map<string | number, string> => {
  const map = new Map<string | number, string>();
  for (const item of items) {
    const k = key(item);
    const date = dateOf(item);
    if (k == null || !date) continue;
    const existing = map.get(k);
    if (!existing || existing < date) {
      map.set(k, date);
    }
  }
  return map;
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
