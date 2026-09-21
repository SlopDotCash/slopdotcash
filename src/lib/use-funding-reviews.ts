import { useCallback, useEffect, useState } from "react";
import { readBoundedJson } from "./browser-json";
import {
  assertFundingReviewIndex,
  type FundingReviewIndex,
} from "./funding-review-data";

export type FundingReviewsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; index: FundingReviewIndex };

/** Frozen preparations outlive the rolling leaderboard window. */
export function useFundingReviews(
  enabled: boolean,
): [FundingReviewsState, () => void] {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<FundingReviewsState>({
    status: "loading",
  });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let active = true;
    setState({ status: "loading" });
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    async function load() {
      try {
        const response = await fetch(
          `/data/funding-reviews.json?attempt=${attempt}`,
          {
            cache: "no-store",
            headers: { Accept: "application/json" },
            signal: controller.signal,
          },
        );
        if (!response.ok)
          throw new Error(`funding reviews returned ${response.status}`);
        const index = assertFundingReviewIndex(
          await readBoundedJson(response, 4 * 1024 * 1024, "funding reviews"),
        );
        if (active) setState({ status: "ready", index });
      } catch (error) {
        // error-policy:J1 Preparation errors remain visible without inventing an empty record.
        if (active)
          setState({
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "funding reviews could not be read",
          });
      } finally {
        window.clearTimeout(timeout);
      }
    }
    void load();
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [enabled, attempt]);
  return [state, useCallback(() => setAttempt((value) => value + 1), [])];
}
