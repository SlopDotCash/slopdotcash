import type { ComponentMeta } from "vibestack/stories";
import type { BarChartProps } from "./BarChart.tsx";

// 35 days of a count, with quiet days among them.
const counts = [0, 2, 3, 0, 1, 5, 8, 2, 0, 0, 4, 6, 3, 1, 0, 2, 7, 9, 4, 0, 0, 1, 3, 2, 6, 5, 0, 0, 2, 4, 8, 3, 1, 0, 2];

export const meta: ComponentMeta<BarChartProps> = {
  args: { label: "Activity, last 35 days: 94", bars: counts.map((value, day) => ({ label: `Day ${day + 1}: ${value}`, value })) },
};
