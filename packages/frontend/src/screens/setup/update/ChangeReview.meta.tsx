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
      await expect(screen.getByText(/Contribution changes need a new security scan\. The project pauses/)).toBeTruthy();
      await expect(screen.queryByText("Presentation and cleared contribution changes publish now.")).toBeNull();
    },
    // spec/backend/projects.md, "Owner revisions publish at once against the expected revision"
    ClearedRoutineEdit: async () => {
      await expect(screen.getByText("Presentation and cleared contribution changes publish now.")).toBeTruthy();
      await expect(screen.getByText("Financial changes apply from 2026-12 (UTC). Funded awards keep their terms.")).toBeTruthy();
      await expect(screen.queryByText(/need a new security scan/)).toBeNull();
    },
  },
};
