import { expect, fn, screen, userEvent } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { awards, dispute } from "./fixtures.ts";
import type { PointsDisputesProps } from "./PointsDisputes.tsx";

const onRetry = fn();
const onOlder = fn();
const onReview = fn();
const onBack = fn();
const onFile = fn();
const onDecide = fn();
const onRetryTriage = fn();

const [unreviewed] = awards.awards;

export const meta: ComponentMeta<PointsDisputesProps> = {
  args: { shown: { kind: "list", list: awards }, onRetry, onOlder, onReview, onBack, onFile, onDecide, onRetryTriage },
  examples: {
    Filing: { shown: unreviewed ? { kind: "filing", item: unreviewed } : { kind: "none" } },
    ModeratorReview: { shown: { kind: "detail", dispute } },
    TriageStalled: { shown: { kind: "detail", dispute: { ...dispute, draft: null, state: "triage", escalatedAt: null, mayDecide: false } } },
    Resolved: { shown: { kind: "detail", dispute: { ...dispute, state: "resolved", resolution: "denied", resolutionReason: "The award follows the published rule.", mayDecide: false } } },
    AccountChanged: { shown: { kind: "none" }, error: "The account changed. Reload Inbox." },
  },
  play: {
    // spec/points/disputes.md, "Only the recipient of the current revision files, and a repeated filing returns the first"
    Default: async () => {
      onReview.mockClear();
      await userEvent.click(screen.getByRole("button", { name: "Review" }));
      await expect(onReview).toHaveBeenCalledWith(unreviewed);
    },
    // spec/points/disputes.md, "Only the recipient of the current revision files, and a repeated filing returns the first"
    Filing: async () => {
      onFile.mockClear();
      await userEvent.type(screen.getByRole("textbox", { name: "Reason" }), "Counted twice.");
      await userEvent.click(screen.getByRole("button", { name: "Request review" }));
      await expect(onFile).toHaveBeenCalledWith("Counted twice.");
    },
    // spec/points/disputes.md, "Only a moderator other than the recipient reads and decides an escalated dispute, once, with a reason"
    ModeratorReview: async () => {
      onDecide.mockClear();
      await expect(screen.getByRole("button", { name: "Deny dispute" })).toHaveProperty("disabled", true);
      await userEvent.type(screen.getByRole("textbox", { name: "Decision reason" }), "Reverted the next day.");
      await userEvent.click(screen.getByRole("button", { name: "Uphold dispute" }));
      await expect(onDecide).toHaveBeenCalledWith("uphold", "Reverted the next day.");
    },
    // spec/points/disputes.md, "Triage runs under an expiring lease, a saved draft is reused, and every outcome escalates"
    TriageStalled: async () => {
      onRetryTriage.mockClear();
      await userEvent.click(screen.getByRole("button", { name: "Retry review" }));
      await expect(onRetryTriage).toHaveBeenCalledTimes(1);
    },
    // spec/frontend/navigation.md, "A private read belongs to the current account and navigation lifetime"
    AccountChanged: async () => {
      onRetry.mockClear();
      await userEvent.click(screen.getByRole("button", { name: "Retry loading" }));
      await expect(onRetry).toHaveBeenCalledTimes(1);
    },
  },
};
