import type { ComponentMeta } from "vibestack/stories";
import type { BountyIntroductionProps } from "./BountyIntroduction.tsx";
import { bountyProject } from "./fixtures.ts";

export const meta: ComponentMeta<BountyIntroductionProps> = {
  args: { project: bountyProject, header: <h1>Vault Guard security bounty</h1>, origin: "https://slop.example", onCopy: () => Promise.resolve() },
};
