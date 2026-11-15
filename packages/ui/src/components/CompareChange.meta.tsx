import type { ComponentMeta } from "vibestack/stories";
import type { CompareChangeProps } from "./CompareChange.tsx";

export const meta: ComponentMeta<CompareChangeProps> = {
  args: {
    changes: [
      { label: "Monthly pool", current: "1,000.00 USDC", proposed: "2,500.00 USDC", exact: true },
      { label: "Refund address", current: "0x8ba1f109551bD432803012645Ac136ddd64DBA72", proposed: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F", exact: true },
      { label: "Closure", current: "Off", proposed: "On" },
    ],
  },
};
