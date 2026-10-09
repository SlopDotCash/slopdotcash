import { fetchWithDeadline, readBoundedJson } from "./browser-json";
import { assertCycleIndex, type CycleIndex } from "./cycle-index";
import {
  type PublicResourceState,
  usePublicResource,
} from "./use-public-resource";

export type CycleIndexState = PublicResourceState<{ cycleIndex: CycleIndex }>;

async function loadCycleIndex(signal: AbortSignal, attempt: number) {
  const response = await fetchWithDeadline(
    `/data/cycles/index.json?attempt=${attempt}`,
    {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal,
    },
  );
  if (!response.ok) throw new Error(`cycle index returned ${response.status}`);
  const cycleIndex = await readBoundedJson(
    response,
    8 * 1024 * 1024,
    "cycle index",
  );
  assertCycleIndex(cycleIndex);
  return { cycleIndex };
}

/** Archive availability does not depend on the rolling leaderboard. */
export function useCycleIndex(enabled: boolean): [CycleIndexState, () => void] {
  return usePublicResource(
    enabled,
    loadCycleIndex,
    "cycle index could not be read",
  );
}
