import type { ComponentMeta } from "vibestack/stories";
import type { MeterProps } from "./Meter.tsx";

export const meta: ComponentMeta<MeterProps> = {
  args: {
    label: "Pull request outcomes",
    segments: [
      { label: "Merged", value: 12, tone: "Positive" },
      { label: "Open", value: 5, tone: "Neutral" },
      { label: "Closed", value: 3, tone: "Negative" },
    ],
  },
};
