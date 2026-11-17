import type { ComponentMeta } from "vibestack/stories";
import { current, failed, loading, totals } from "./fixtures.ts";
import type { HomeStandingsProps } from "./HomeStandings.tsx";

export const meta: ComponentMeta<HomeStandingsProps> = {
  args: { totals: current(totals) },
  examples: { Empty: { totals: current([]) }, Loading: { totals: loading() }, Failed: { totals: failed() } },
};
