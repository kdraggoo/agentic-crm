import type { Deal, PropensityBucket } from "../types";
import { isDealActive } from "../providers/commons/propensityScoring";
import type { PropensityResult } from "../providers/commons/propensityScoring";

/**
 * The source name used in the filter bar for the propensity client-side filter.
 * This key is stripped from the API request by the data provider's beforeGetList
 * callback and applied as a post-filter in DealListContent.
 */
export const PROPENSITY_FILTER_SOURCE = "propensity_bucket";

/**
 * Choices for the propensity bucket multi-select filter.
 * Labels match the existing crm.propensity.buckets translation keys so the
 * dropdown options read "Low", "Medium", "High" in the current locale.
 */
export const PROPENSITY_BUCKET_CHOICES = [
  { id: "low", name: "crm.propensity.buckets.low" },
  { id: "medium", name: "crm.propensity.buckets.medium" },
  { id: "high", name: "crm.propensity.buckets.high" },
];

/**
 * Returns the effective propensity bucket for a deal, considering manual
 * overrides. Returns null when the deal has no propensity (not scorable,
 * no computed result and no override).
 */
const getEffectiveBucket = (
  deal: Deal,
  computed: PropensityResult | undefined,
): PropensityBucket | null => {
  if (isValidBucket(deal.propensity_override)) {
    return deal.propensity_override;
  }
  return computed?.bucket ?? null;
};

const isValidBucket = (
  value: string | null | undefined,
): value is PropensityBucket =>
  value === "low" || value === "medium" || value === "high";

/**
 * Filters deals by propensity bucket. This is the core client-side post-filter
 * applied after propensity scores are computed by DealPropensityContext.
 *
 * When no buckets are selected (empty array or undefined), all deals are returned.
 * When buckets are selected:
 * - Deals in non-scorable stages (in dealPipelineStatuses) are hidden
 * - Deals whose effective bucket does not match any selected bucket are hidden
 */
export const filterDealsByPropensity = (
  deals: Deal[],
  selectedBuckets: PropensityBucket[] | undefined,
  dealPipelineStatuses: readonly string[],
  propensityByDealId: Map<string | number, PropensityResult>,
): Deal[] => {
  if (!selectedBuckets?.length) return deals;

  return deals.filter((deal) => {
    // Deals in non-scorable stages are hidden when any propensity filter is active
    if (!isDealActive(deal, dealPipelineStatuses)) return false;

    const effectiveBucket = getEffectiveBucket(
      deal,
      propensityByDealId.get(deal.id),
    );
    if (!effectiveBucket) return false;

    return selectedBuckets.includes(effectiveBucket);
  });
};

/**
 * Removes the propensity_bucket key from a filter object so it is not sent
 * to the API. The propensity filter is applied client-side.
 */
export const stripPropensityFilter = <T extends Record<string, unknown>>(
  filter: T,
): Omit<T, typeof PROPENSITY_FILTER_SOURCE> => {
  if (!(PROPENSITY_FILTER_SOURCE in filter)) return filter;
  const { [PROPENSITY_FILTER_SOURCE]: _, ...rest } = filter;
  return rest as Omit<T, typeof PROPENSITY_FILTER_SOURCE>;
};
