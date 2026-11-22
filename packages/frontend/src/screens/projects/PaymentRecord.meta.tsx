import { expect, fn, screen, userEvent } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { names, vaultPayments } from "./fixtures.ts";
import type { VaultPaymentHistoryProps } from "./PaymentRecord.tsx";

const onRetry = fn();

export const meta: ComponentMeta<VaultPaymentHistoryProps> = {
  args: { payments: vaultPayments, nameOf: names },
  examples: {
    Empty: { payments: { status: "Empty", value: undefined } },
    Loading: { payments: { status: "Loading", value: undefined } },
    Failed: { payments: { status: "Failed", value: undefined, onRetry } },
  },
  play: {
    // spec/frontend/projections.md, "Ordinary public payment rows require finalized evidence and a public account"
    Default: async () => {
      await expect(screen.getAllByRole("listitem")).toHaveLength(5);
      await userEvent.click(screen.getByRole("button", { expanded: false }));
      await expect([screen.getAllByRole("listitem").length, screen.getAllByRole("link", { name: "View transaction" }).length]).toEqual([7, 7]);
    },
    // spec/frontend/projections.md, "Ordinary public payment rows require finalized evidence and a public account"
    Failed: async () => {
      onRetry.mockClear();
      await userEvent.click(screen.getByRole("button", { name: "Retry project payments" }));
      await expect(onRetry).toHaveBeenCalledOnce();
    },
    // spec/frontend/projections.md, "Ordinary public payment rows require finalized evidence and a public account"
    Empty: async () => {
      await expect(screen.queryByRole("listitem")).toBeNull();
    },
  },
};
