import { expect, screen } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { transactionUrl } from "../../../kernels/explorers.ts";
import type { DepositLineViewProps } from "./DepositLine.tsx";

const payPath = "/fee/report/sc_0123456789abcdef";

export const meta: ComponentMeta<DepositLineViewProps> = {
  args: { status: { state: "needed", amountText: "395 SLOP", payPath }, end: { status: "settled", href: null } },
  examples: {
    Recorded: { status: { state: "paid", amountText: "395 SLOP", payPath } },
    RefundDue: { status: { state: "refund_due", amountText: "395 SLOP", payPath } },
    KeptDue: { status: { state: "kept_due", amountText: "395 SLOP", payPath } },
    Reading: { status: { state: "refunded", amountText: "395 SLOP", payPath }, end: { status: "loading" } },
    Refunded: { status: { state: "refunded", amountText: "395 SLOP", payPath }, end: { status: "settled", href: transactionUrl("robinhood-mainnet", "0x01") ?? null } },
    Kept: { status: { state: "kept", amountText: "395 SLOP", payPath }, end: { status: "settled", href: transactionUrl("robinhood-mainnet", "0x02") ?? null } },
    RecordOnly: { status: { state: "kept", amountText: "395 SLOP", payPath }, end: { status: "settled", href: null } },
  },
  play: {
    // spec/security/reportDeposit.md, "A report that waits for its deposit belongs to its reporter alone"
    Default: async () => {
      await expect(screen.getByRole("link").getAttribute("href")).toBe(payPath);
    },
    // spec/security/reportDeposit.md, "A paid deposit is sent back on a first response and kept only after a keeping close stood seven days"
    Reading: async () => {
      await expect(screen.queryByRole("link")).toBeNull();
    },
    // spec/security/reportDeposit.md, "A paid deposit is sent back on a first response and kept only after a keeping close stood seven days"
    RecordOnly: async () => {
      await expect(screen.getByRole("link").getAttribute("href")).toBe(payPath);
    },
  },
};
