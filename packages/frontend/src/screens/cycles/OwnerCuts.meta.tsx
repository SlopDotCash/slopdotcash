import { expect, screen } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { cuts } from "./fixtures.ts";
import type { OwnerCutsProps } from "./OwnerCuts.tsx";

export const meta: ComponentMeta<OwnerCutsProps> = {
  args: { cuts: { status: "Current", value: cuts } },
  examples: {
    Loading: { cuts: { status: "Loading", value: undefined } },
    Failed: { cuts: { status: "Failed", value: undefined, onRetry: () => undefined } },
    NoCuts: { cuts: { status: "Empty", value: [] } },
    Stale: { cuts: { status: "Stale", value: cuts, onRetry: () => undefined } },
  },
  play: {
    // spec/frontend/projections.md, "The cycle page lists public cuts with distinct loading, error, empty and list states"
    Default: async () => {
      await expect(screen.getByText("Reason: Duplicate of an earlier fix.")).toBeTruthy();
      await expect(screen.queryByText("No cuts.")).toBeNull();
    },
    // spec/frontend/projections.md, "The cycle page lists public cuts with distinct loading, error, empty and list states"
    Failed: async () => {
      await expect([screen.getByRole("button", { name: "Retry owner cuts" }), screen.queryByText("No cuts.")]).toEqual([expect.anything(), null]);
    },
    // spec/frontend/projections.md, "The cycle page lists public cuts with distinct loading, error, empty and list states"
    NoCuts: async () => {
      await expect(screen.getByText("No cuts.")).toBeTruthy();
    },
    // spec/frontend/projections.md, "The cycle page lists public cuts with distinct loading, error, empty and list states"
    Stale: async () => {
      await expect(screen.getByText("Reason: Duplicate of an earlier fix.")).toBeTruthy();
    },
  },
};
