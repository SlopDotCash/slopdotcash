import { expect, screen, userEvent } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { names, vaultPayments } from "./fixtures.ts";
import type { VaultPaymentHistoryProps } from "./PaymentRecord.tsx";

export const meta: ComponentMeta<VaultPaymentHistoryProps> = {
  args: { payments: vaultPayments, nameOf: names },
  examples: {
    Empty: { payments: { status: "Empty", value: undefined } },
    Failed: { payments: { status: "Failed", value: undefined, onRetry: () => undefined } },
  },
  play: {
    // spec/frontend/projections.md, "Ordinary public payment rows require finalized evidence and a public account"
    Default: async () => {
      await expect(screen.getAllByRole("listitem")).toHaveLength(5);
      await userEvent.click(screen.getByRole("button", { name: "Show all 7 payments" }));
      await expect(screen.getByText(/Work month: Not recorded/u)).toBeTruthy();
    },
  },
};
