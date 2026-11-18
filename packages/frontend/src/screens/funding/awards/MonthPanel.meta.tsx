import { expect, fn, screen, userEvent } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { cutsClosed, frozen, frozenMonth, managing, proposedMonth, reading, reviewedCommitment, underfundedMonth, viewOnlyMonth } from "./fixtures.ts";
import type { MonthPanelProps } from "./MonthPanel.tsx";

const onSave = fn(() => Promise.resolve(true));
const onReserve = fn();
const reason = "The second pull request was reverted the next day.";

export const meta: ComponentMeta<MonthPanelProps> = {
  args: { view: proposedMonth, state: managing, onSave, onFinalize: fn(), onAutomaticChange: fn(), onReserve, manageHref: "/projects/slop/manage#vault-monthly-base-mainnet-0x5e1f0000000000000000000000000000000000aa" },
  examples: {
    CutsClosed: { state: cutsClosed },
    ViewOnly: { view: viewOnlyMonth, state: reading },
    Frozen: { view: frozenMonth, state: frozen },
    Reviewed: { view: frozenMonth, state: reviewedCommitment },
    PaymentsDisabled: { paymentsDisabled: true },
    Saved: { savedActor: "101" },
    Underfunded: { view: underfundedMonth, state: frozen },
  },
  play: {
    // spec/frontend/ownerMonthly.md, "A cut needs a 20 to 500 character public reason, and a save names the sequence it read"
    Default: async () => {
      onSave.mockClear();
      const amount = screen.getByRole("textbox", { name: "Award for octocat" });
      await userEvent.clear(amount);
      await userEvent.type(amount, "500");
      const save = screen.getByRole("button", { name: "Save octocat" });
      await expect(save).toBeDisabled();
      await userEvent.type(screen.getByRole("textbox", { name: "Reason (shown publicly and sent to the contributor)" }), reason);
      await userEvent.click(save);
      await expect(onSave).toHaveBeenCalledWith({ githubUserId: "101", grossBase: "500000000", cut: true, reason });
    },
    // spec/frontend/ownerMonthly.md, "Only a current manager edits, and the editor closes at the cutoff"
    CutsClosed: async () => {
      onSave.mockClear();
      const amount = screen.getByRole("textbox", { name: "Award for octocat" });
      await userEvent.clear(amount);
      await userEvent.type(amount, "500");
      await userEvent.type(screen.getByRole("textbox", { name: "Reason (shown publicly and sent to the contributor)" }), reason);
      await expect(screen.getByRole("button", { name: "Save octocat" })).toBeDisabled();
    },
    // spec/frontend/ownerMonthly.md, "Only a current manager edits, and the editor closes at the cutoff"
    ViewOnly: async () => {
      await expect([screen.queryByRole("textbox"), screen.queryByRole("button", { name: "Finalize awards" })]).toEqual([null, null]);
    },
    // spec/frontend/projections.md, "Award, funding and settlement status are independent facts"
    Frozen: async () => {
      onReserve.mockClear();
      await userEvent.click(screen.getByRole("button", { name: "Reserve award for octocat" }));
      await expect([onReserve.mock.calls, screen.queryByRole("button", { name: "Reserve award for hubot" })]).toEqual([[["101"]], null]);
    },
    // spec/frontend/ownerMonthly.md, "Commitment, automatic-payment setting and reserve release each keep one recoverable attempt"
    Reviewed: async () => {
      onReserve.mockClear();
      await userEvent.click(screen.getByRole("button", { name: "Reserve award for octocat" }));
      await expect(onReserve.mock.calls).toEqual([["101"]]);
    },
  },
};
