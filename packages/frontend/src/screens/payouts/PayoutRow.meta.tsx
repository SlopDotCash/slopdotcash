import type { ComponentMeta } from "vibestack/stories";
import { reservedPayment } from "./fixtures.ts";
import { netAmountProps } from "./PayoutAmount.tsx";
import type { PayoutRowProps } from "./PayoutRow.tsx";
import { awardStatus, paymentStatus } from "./status.ts";

export const meta: ComponentMeta<PayoutRowProps> = {
  args: { network: reservedPayment.network, projectId: reservedPayment.projectId, amount: netAmountProps(reservedPayment), status: paymentStatus(reservedPayment) },
  decorator: (story) => <ul>{story()}</ul>,
  examples: {
    Paid: { status: paymentStatus({ deliveryState: "paid", state: "paid", transactionId: "0x7a1d" }), explorerUrl: "https://basescan.org/tx/0x7a1d" },
    PaidWithoutFinality: { status: paymentStatus({ deliveryState: "paid", state: "reserved", transactionId: null }) },
    Underfunded: { status: awardStatus({ state: "underfunded" }).presentation, statusTitle: awardStatus({ state: "underfunded" }).title, note: "October 2026" },
  },
};
