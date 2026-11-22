import { expect, screen, userEvent } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { cycles, failedTransfers, noTransfers, transfers } from "./fixtures.ts";
import type { PaymentHistoryProps } from "./PaymentHistory.tsx";

const slop = { id: "slop", slug: "slop", name: "Slop", externalPrize: false };

const listed: PaymentHistoryProps["cycles"] = { status: "Current", value: cycles };

const noCycles: PaymentHistoryProps["cycles"] = { status: "Empty", value: [] };

export const meta: ComponentMeta<PaymentHistoryProps> = {
  args: { project: slop, cycles: listed, direct: transfers, nowMs: Date.parse("2026-11-17T12:00:00.000Z") },
  examples: {
    DirectFailed: { direct: failedTransfers },
    Prize: { project: { ...slop, externalPrize: true }, direct: noTransfers },
    Nothing: { cycles: noCycles, direct: noTransfers },
    CyclesFailed: { cycles: { status: "Unavailable", value: undefined, onRetry: () => undefined }, direct: noTransfers },
    DirectLoading: { cycles: noCycles, direct: { status: "Loading", value: undefined } },
  },
  play: {
    // spec/frontend/projections.md, "Ordinary public payment rows require finalized evidence and a public account"
    Default: async () => {
      await expect(screen.getByRole("link", { name: "Disclosure" }).getAttribute("href")).toBe("/api/v1/payments/projects/slop/direct-transfers");
      await expect(screen.getAllByRole("row")).toHaveLength(4);
      await userEvent.click(screen.getByRole("button", { expanded: false }));
      await expect(screen.getAllByRole("row")).toHaveLength(5);
    },
    // spec/frontend/paymentHistory.md, "Rows publish only after the final page, and every inconsistency is an error"
    DirectFailed: async () => {
      await expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    },
    // spec/frontend/projections.md, "Award, funding and settlement status are independent facts"
    Nothing: async () => {
      await expect(screen.queryByRole("heading", { name: "Payment history" })).toBeNull();
    },
    // spec/frontend/projections.md, "Award, funding and settlement status are independent facts"
    CyclesFailed: async () => {
      await expect([screen.getByRole("button", { name: "Retry" }), screen.queryByRole("table")]).toEqual([expect.anything(), null]);
    },
    // spec/frontend/paymentHistory.md, "Rows publish only after the final page, and every inconsistency is an error"
    DirectLoading: async () => {
      await expect([screen.getByRole("status"), screen.queryByRole("table")]).toEqual([expect.anything(), null]);
    },
  },
};
