import { expect, userEvent, within } from "storybook/test";
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
  play: {
    // spec/ui/controls.md, "The keyboard reaches a row of links in the order shown, and one navigation tab at most is current"
    Default: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const canvas = within(canvasElement);
      const reached: (Element | null)[] = [];
      for (const back of [false, false, false, false, false, true]) {
        await userEvent.tab({ shift: back });
        reached.push(document.activeElement);
      }
      const [ada, grace, linus, margaret] = ["ada", "grace", "linus", "margaret"].map((login) => canvas.getByRole("link", { name: login }));
      await expect(reached).toEqual([canvas.getByRole("region", { name: "October standings" }), ada, grace, linus, margaret, linus]);
    },
  },
};
