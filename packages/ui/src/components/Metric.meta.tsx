import { Wallet } from "lucide-react";
import type { ComponentMeta } from "vibestack/stories";
import { MetricGrid, type MetricProps } from "./Metric.tsx";

export const meta: ComponentMeta<MetricProps> = {
  args: { label: "Vault balance", value: "12,500.00 USDC", icon: <Wallet /> },
  examples: { Detail: { detail: "Observed 14 Nov, 09:00 UTC" } },
  // A `dt` and `dd` belong in a `dl`.
  decorator: (story) => <MetricGrid>{story()}</MetricGrid>,
};
