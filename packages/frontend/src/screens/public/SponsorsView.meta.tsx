import type { ComponentMeta } from "vibestack/stories";
import { current, failed, listed, mergeLine } from "../home/fixtures.ts";
import { live, whoBuilds } from "./fixtures.ts";
import type { SponsorsViewProps } from "./SponsorsPage.tsx";

export const meta: ComponentMeta<SponsorsViewProps> = {
  args: { projects: current(listed), mergeLine, networkPays: () => true, whoBuilds, live: current(live), branch: "main" },
  examples: { RegistryFailed: { projects: failed() } },
};
