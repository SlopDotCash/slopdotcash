import { expect, screen } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { ChangeReviewProps } from "./ChangeReview.tsx";
import { appended, branchRows, mixed, rows, settingsRows } from "./fixtures.ts";

export const meta: ComponentMeta<ChangeReviewProps> = {
  args: { changes: appended, rows, addedRepositories: 1, scanCleared: true, active: true, nextCycle: "2026-12" },
  examples: {
    ClearedRoutineEdit: { changes: mixed, addedRepositories: 0 },
    PausedProject: { changes: mixed, addedRepositories: 0, scanCleared: false, active: false },
    ContributionSettings: { changes: { presentation: ["security", "slopbot"], executable: [], financial: ["reward"], restricted: [] }, rows: settingsRows, addedRepositories: 0, scanCleared: false },
    IntegrationBranch: { changes: { presentation: [], executable: [], financial: [], restricted: [] }, rows: branchRows, addedRepositories: 0, scanCleared: false },
  },
  play: {
    // spec/backend/projects.md, "Appending a repository pauses the project and its work counts from next month"
    Default: async () => {
      await expect([screen.getAllByText("Rescan · pauses").length, screen.getAllByText("From 2026-12").length, screen.queryByText("Live now")]).toEqual([1, 1, null]);
    },
    // spec/backend/projects.md, "Owner revisions publish at once against the expected revision"
    ClearedRoutineEdit: async () => {
      await expect([screen.getAllByText("Live now").length, screen.getAllByText("From 2026-12").length, screen.queryByText(/^Rescan/)]).toEqual([1, 1, null]);
    },
    // spec/backend/projects.md, "Appending a repository pauses the project and its work counts from next month"
    PausedProject: async () => {
      await expect([screen.getAllByText("Rescan").length, screen.getAllByText("Live now").length, screen.queryByText("Rescan · pauses")]).toEqual([1, 1, null]);
    },
  },
};
