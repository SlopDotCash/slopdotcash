import type { ComponentMeta } from "vibestack/stories";
import type { CommunityRowsProps } from "./CommunityRows.tsx";
import { manyCommunity, promised, unverified } from "./fixtures.ts";

export const meta: ComponentMeta<CommunityRowsProps> = {
  args: { projects: manyCommunity },
  examples: { OnePage: { projects: manyCommunity.slice(0, 4) }, Tagged: { projects: [promised, unverified] } },
};
