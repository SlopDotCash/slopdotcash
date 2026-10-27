import { type CycleIndex, loadCycleIndex } from "./cycle-index";
import {
  type PublicResourceState,
  usePublicResource,
} from "./use-public-resource";

export type CycleIndexState = PublicResourceState<{ cycleIndex: CycleIndex }>;

const load = async (signal: AbortSignal, attempt: number) => ({
  cycleIndex: await loadCycleIndex(signal, `attempt=${attempt}`),
});

/** Archive availability does not depend on the rolling leaderboard. */
export function useCycleIndex(enabled: boolean): [CycleIndexState, () => void] {
  return usePublicResource(enabled, load, "cycle index could not be read");
}
