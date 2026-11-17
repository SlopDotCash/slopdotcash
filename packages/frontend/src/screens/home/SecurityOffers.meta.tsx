import type { ComponentMeta } from "vibestack/stories";
import { current, failed, listed, loading, pool } from "./fixtures.ts";
import type { SecurityOffersProps } from "./SecurityOffers.tsx";

export const meta: ComponentMeta<SecurityOffersProps> = {
  args: { projects: current(listed) },
  examples: { NoneOpen: { projects: current([pool]) }, Loading: { projects: loading() }, Failed: { projects: failed() } },
};
