import { useQuery } from "@tanstack/react-query";
import { useDataProvider, type Identifier, type RaRecord } from "ra-core";

/** IDs per request: keeps the `@in` filter well under URL length limits. */
const IDS_PER_BATCH = 25;
/** Rows per page while walking a batch; most batches fit in one page. */
const ROWS_PER_PAGE = 500;

interface LatestActivityOptions {
  /** Resource holding the activity rows, e.g. "deal_notes". */
  resource: string;
  /** Field linking a row to the ids below, e.g. "deal_id". */
  keyField: string;
  /** Date field of a row, e.g. "date" or "created_at". */
  dateField: string;
  ids: readonly Identifier[];
}

/**
 * Latest `dateField` per `keyField` value, over every row of `resource` linked
 * to `ids`. All rows are read (batched, then paged), so a key never loses its
 * latest date because other keys have more activity. The query key starts
 * with the resource, so ra-core's invalidation after a create or update on
 * that resource refreshes it.
 */
export const useLatestActivityDates = ({
  resource,
  keyField,
  dateField,
  ids,
}: LatestActivityOptions): Map<Identifier, string> => {
  const dataProvider = useDataProvider();
  const sortedIds = [...new Set(ids)].sort();

  const { data } = useQuery({
    queryKey: [resource, "latestActivityDates", keyField, dateField, sortedIds],
    enabled: sortedIds.length > 0,
    queryFn: async () => {
      const batches = chunk(sortedIds, IDS_PER_BATCH);
      const rows = (
        await Promise.all(
          batches.map((batch) =>
            fetchAll(dataProvider, resource, {
              [`${keyField}@in`]: `(${batch.join(",")})`,
            }),
          ),
        )
      ).flat();
      return latestByKey(rows, keyField, dateField);
    },
  });

  return data ?? EMPTY;
};

const EMPTY = new Map<Identifier, string>();

const fetchAll = async (
  dataProvider: ReturnType<typeof useDataProvider>,
  resource: string,
  filter: Record<string, string>,
): Promise<RaRecord[]> => {
  const rows: RaRecord[] = [];
  for (let page = 1; ; page++) {
    const { data, total } = await dataProvider.getList(resource, {
      pagination: { page, perPage: ROWS_PER_PAGE },
      sort: { field: "id", order: "ASC" },
      filter,
    });
    rows.push(...data);
    const isLastPage =
      data.length < ROWS_PER_PAGE || (total != null && rows.length >= total);
    if (isLastPage) return rows;
  }
};

const latestByKey = (
  rows: readonly RaRecord[],
  keyField: string,
  dateField: string,
): Map<Identifier, string> => {
  const latest = new Map<Identifier, string>();
  for (const row of rows) {
    const key = row[keyField] as Identifier | undefined;
    const date = row[dateField] as string | null | undefined;
    if (key == null || !date) continue;
    const current = latest.get(key);
    if (!current || current < date) latest.set(key, date);
  }
  return latest;
};

const chunk = <T>(items: readonly T[], size: number): T[][] => {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
};
