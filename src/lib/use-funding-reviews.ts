import { fetchWithDeadline, readBoundedJson } from "./browser-json";
import {
  assertFundingReviewIndex,
  type FundingReviewIndex,
} from "./funding-review-data";
import {
  type PublicResourceState,
  usePublicResource,
} from "./use-public-resource";

export type FundingReviewsState = PublicResourceState<{
  index: FundingReviewIndex;
}>;

async function loadFundingReviews(signal: AbortSignal, attempt: number) {
  const response = await fetchWithDeadline(
    `/data/funding-reviews.json?attempt=${attempt}`,
    {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal,
    },
  );
  if (!response.ok)
    throw new Error(`funding reviews returned ${response.status}`);
  return {
    index: assertFundingReviewIndex(
      await readBoundedJson(response, 4 * 1024 * 1024, "funding reviews"),
    ),
  };
}

/** Frozen preparations outlive the rolling leaderboard window. */
export function useFundingReviews(
  enabled: boolean,
): [FundingReviewsState, () => void] {
  return usePublicResource(
    enabled,
    loadFundingReviews,
    "funding reviews could not be read",
  );
}
