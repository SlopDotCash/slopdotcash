import { expect, screen, userEvent } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { cycles, failedTransfers, noTransfers, transfers } from "./fixtures.ts";
import type { PaymentHistoryProps } from "./PaymentHistory.tsx";

const slop = { id: "slop", slug: "slop", name: "Slop", externalPrize: false };

export const meta: ComponentMeta<PaymentHistoryProps> = {
  args: { project: slop, cycles, direct: transfers, nowMs: Date.parse("2026-11-17T12:00:00.000Z") },
  examples: {
    DirectFailed: { direct: failedTransfers },
    Prize: { project: { ...slop, externalPrize: true }, direct: noTransfers },
    Nothing: { cycles: [], direct: noTransfers },
    DirectLoading: { cycles: [], direct: { status: "Loading", value: undefined } },
  },
  play: {
    // spec/frontend/projections.md, "Ordinary public payment rows require finalized evidence and a public account"
    Default: async () => {
      await expect(screen.getByText("$200.5 paid directly")).toBeTruthy();
      await expect(screen.getAllByRole("row")).toHaveLength(4);
      await userEvent.click(screen.getByRole("button", { name: "Show complete payment history" }));
      await expect(screen.getAllByRole("row")).toHaveLength(5);
    },
    // spec/frontend/paymentHistory.md, "Rows publish only after the final page, and every inconsistency is an error"
    DirectFailed: async () => {
      await expect(screen.getByRole("button", { name: "Retry direct payments" })).toBeTruthy();
    },
    // spec/frontend/projections.md, "Award, funding and settlement status are independent facts"
    Nothing: async () => {
      await expect(screen.queryByRole("heading", { name: "Payment history" })).toBeNull();
    },
    // spec/frontend/paymentHistory.md, "Rows publish only after the final page, and every inconsistency is an error"
    DirectLoading: async () => {
      await expect([screen.getByText("Loading direct payments…"), screen.queryByText("No cycles have closed yet.")]).toEqual([expect.anything(), null]);
    },
  },
};
