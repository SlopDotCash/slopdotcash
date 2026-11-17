import { expect, fn, screen, userEvent } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { generatedAt, workItems } from "./fixtures.ts";
import type { ProjectWorkProps } from "./ProjectWork.tsx";

const onRetry = fn();

export const meta: ComponentMeta<ProjectWorkProps> = {
  args: { work: { status: "ready", items: workItems, generatedAt, stale: false, refreshFailed: false }, onRetry },
  examples: {
    Loading: { work: { status: "loading" } },
    Failed: { work: { status: "failed" } },
    Empty: { work: { status: "ready", items: [], generatedAt, stale: false, refreshFailed: false } },
    Stale: { work: { status: "ready", items: workItems.slice(0, 3), generatedAt, stale: true, refreshFailed: false } },
    RefreshFailed: { work: { status: "ready", items: workItems.slice(0, 3), generatedAt, stale: false, refreshFailed: true } },
  },
  play: {
    // spec/frontend/rankedSnapshot.md, "A candidate check records score and payment results separately"
    Default: async () => {
      await expect(screen.getAllByRole("listitem")).toHaveLength(10);
      await userEvent.click(screen.getByRole("button", { name: "Show all 12" }));
      await expect(screen.getAllByRole("listitem")).toHaveLength(12);
    },
    // spec/frontend/rankedSnapshot.md, "A candidate check records score and payment results separately"
    Failed: async () => {
      onRetry.mockClear();
      await userEvent.click(screen.getByRole("button", { name: "Retry" }));
      await expect(onRetry).toHaveBeenCalledOnce();
    },
    // spec/frontend/snapshotCache.md, "A cached snapshot is fresh for 60 seconds, stale 8 hours after generation, and a failed read retries once after 400 ms unless aborted"
    RefreshFailed: async () => {
      await expect([screen.getByText(/^Points may be outdated · updated /u), screen.getAllByRole("listitem").length]).toEqual([expect.anything(), 3]);
    },
  },
};
