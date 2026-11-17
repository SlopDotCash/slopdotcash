import { expect, fn, screen, userEvent } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { queue } from "./fixtures.ts";
import type { IncompleteAssessmentsProps } from "./IncompleteAssessments.tsx";

const onEarlier = fn();
const onMore = fn();
const onRetry = fn();

export const meta: ComponentMeta<IncompleteAssessmentsProps> = {
  args: { queue, onEarlier, onMore, onRetry },
  examples: {
    LaterPage: { queue: { ...queue, next: null }, hasEarlier: true },
    Unavailable: { queue: undefined, failed: true },
  },
  play: {
    // spec/slopbot/assessmentInbox.md, "A departed page or changed actor cannot display a late queue response"
    Default: async () => {
      onMore.mockClear();
      await expect(screen.getByRole("link", { name: "Acme Vault: acme/vault #42" }).getAttribute("href")).toBe("https://github.com/acme/vault/pull/42");
      await userEvent.click(screen.getByRole("button", { name: "More" }));
      await expect(onMore).toHaveBeenCalledWith(queue.next);
    },
    // spec/slopbot/assessmentInbox.md, "Denial clears the item and uncertain authority is retryable"
    Unavailable: async () => {
      onRetry.mockClear();
      await userEvent.click(screen.getByRole("button", { name: "Retry" }));
      await expect(onRetry).toHaveBeenCalledTimes(1);
    },
  },
};
