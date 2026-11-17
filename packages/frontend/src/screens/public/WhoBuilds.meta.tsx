import type { ComponentMeta } from "vibestack/stories";
import { current, failed } from "../home/fixtures.ts";
import { live, whoBuilds } from "./fixtures.ts";
import type { WhoBuildsProps } from "./WhoBuilds.tsx";

export const meta: ComponentMeta<WhoBuildsProps> = {
  args: { snapshot: whoBuilds, live: current(live), branch: "main" },
  examples: { LiveFailed: { live: failed() } },
};
