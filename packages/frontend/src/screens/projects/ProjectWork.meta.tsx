import { expect, fn, screen, userEvent } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { generatedAt, noWanted, wanted, workItems } from "./fixtures.ts";
import type { ProjectWorkProps } from "./ProjectWork.tsx";

const onRetry = fn();

export const meta: ComponentMeta<ProjectWorkProps> = {
  args: { work: { status: "ready", items: workItems, generatedAt, stale: false, refreshFailed: false }, wanted: noWanted, onRetry },
  examples: {
    Loading: { work: { status: "loading" } },
    Failed: { work: { status: "failed" } },
    Empty: { work: { status: "ready", items: [], generatedAt, stale: false, refreshFailed: false } },
    Stale: { work: { status: "ready", items: workItems.slice(0, 3), generatedAt, stale: true, refreshFailed: false } },
    RefreshFailed: { work: { status: "ready", items: workItems.slice(0, 3), generatedAt, stale: false, refreshFailed: true } },
    Wanted: { work: { status: "ready", items: workItems.slice(0, 3), generatedAt, stale: false, refreshFailed: false }, wanted },
    WantedWithoutSnapshot: { work: { status: "failed" }, wanted },
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
      onRetry.mockClear();
      await userEvent.click(screen.getByRole("button", { name: "Retry" }));
      await expect([onRetry.mock.calls.length, screen.getAllByRole("listitem").length]).toEqual([1, 3]);
    },
    // spec/frontend/views.md, "Suggested work lists the wanted issues first, unclaimed before taken, at most ten, and a failed wanted read leaves the suggestions as before"
    Wanted: async () => {
      const links = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
      await expect(links.slice(0, 2)).toEqual(["https://github.com/slopdotcash/slop/issues/9", "https://github.com/slopdotcash/slop/issues/7"]);
      await expect(links).toHaveLength(5);
    },
    // spec/frontend/views.md, "Suggested work lists the wanted issues first, unclaimed before taken, at most ten, and a failed wanted read leaves the suggestions as before"
    WantedWithoutSnapshot: async () => {
      await expect([screen.queryByRole("button", { name: "Retry" }), screen.getAllByRole("listitem").length]).toEqual([null, 2]);
    },
  },
};
