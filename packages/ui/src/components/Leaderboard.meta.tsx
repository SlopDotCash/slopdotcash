import type { ComponentMeta } from "vibestack/stories";
import type { LeaderboardProps } from "./Leaderboard.tsx";

const actor = (login: string) => ({ login, href: `https://github.com/${login}` });

export const meta: ComponentMeta<LeaderboardProps> = {
  args: {
    label: "October standings",
    // Two equal totals share rank 2, and the next rank is 4 (spec/frontend/projections.md).
    rows: [
      { rank: 1, actor: actor("ada"), points: "1,240" },
      { rank: 2, actor: actor("grace"), points: "860" },
      { rank: 2, actor: actor("linus"), points: "860" },
      { rank: 4, actor: actor("margaret"), points: "410" },
    ],
  },
  examples: {
    Shares: {
      rows: [
        { rank: 1, actor: actor("ada"), points: "1,240", share: "$496.00", detail: "slop-cli" },
        { rank: 2, actor: actor("grace"), points: "860", share: "$344.00", detail: "escrow" },
      ],
    },
  },
};
