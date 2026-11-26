import type { ComponentMeta } from "vibestack/stories";
import type { PaymentRecordProps } from "./PaymentRecord.tsx";

export const meta: ComponentMeta<PaymentRecordProps> = {
  args: { name: "Acme", detail: "Base · October 2026", amount: "$100 USDC" },
  decorator: (story) => <ul>{story()}</ul>,
};
