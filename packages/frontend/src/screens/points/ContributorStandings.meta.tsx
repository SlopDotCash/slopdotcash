import { expect, screen } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { ContributorStandingsProps } from "./ContributorStandings.tsx";
import { current, failed, history, loading, nowMs, stale } from "./fixtures.ts";

export const meta: ComponentMeta<ContributorStandingsProps> = {
  args: { history: current(history), period: "month", query: "", page: 1, nowMs },
  examples: {
    Lifetime: { period: "lifetime" },
    NoMatch: { query: "zzz" },
    Compact: { compact: true, title: "Slop contributors" },
    Loading: { history: loading() },
    Failed: { history: failed() },
    Stale: { history: stale(history) },
  },
  play: {
    // spec/frontend/projections.md, "Monthly and lifetime standings sum the same accepted-work history"
    Default: async () => {
      await expect(screen.getAllByRole("row")).toHaveLength(3);
      await expect(screen.queryByText("bob")).toBeNull();
    },
    // spec/frontend/projections.md, "Monthly and lifetime standings sum the same accepted-work history"
    Lifetime: async () => {
      await expect(screen.getAllByRole("row")).toHaveLength(4);
      await expect(screen.getByText("carol")).toBeTruthy();
    },
    // spec/frontend/projections.md, "Monthly and lifetime standings sum the same accepted-work history"
    NoMatch: async () => {
      await expect(screen.getByText("No contributors match this view.")).toBeTruthy();
    },
    // spec/frontend/requests.md, "Only the current request may publish its validated result"
    Failed: async () => {
      await expect([screen.getByRole("button", { name: "Retry points" }), screen.queryByText("No contributors match this view.")]).toEqual([expect.anything(), null]);
    },
  },
};
