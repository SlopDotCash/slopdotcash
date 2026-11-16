import type { ComponentProps } from "react";
import { cn } from "../lib/cn.ts";

export interface ChartBar {
  /** The bar's period and value in words, shown on hover; unique among the bars. */
  label: string;
  /** Its height, as a count of zero or more. */
  value: number;
}

export type BarChartProps = Omit<ComponentProps<"figure">, "children"> & {
  /** What the chart shows and its total, its accessible name. */
  label: string;
  /** One column per period, oldest first. */
  bars: readonly ChartBar[];
};

/**
 * Columns of a count per period, such as a day's activity. The columns are decorative; `label` says what they add up to.
 * @design design.md#design-system
 */
export function BarChart({ label, bars, className, ...props }: BarChartProps) {
  const highest = Math.max(1, ...bars.map((bar) => bar.value));
  return (
    <figure role="img" aria-label={label} className={cn("flex h-24 w-full items-end gap-px", className)} {...props}>
      {bars.map((bar) => (
        <div
          key={bar.label}
          title={bar.label}
          className={cn("min-h-px flex-1 rounded-sm transition-colors duration-fast motion-reduce:transition-none", bar.value > 0 ? "bg-muted-foreground hover:bg-foreground" : "bg-border")}
          style={{ height: `${(bar.value / highest) * 100}%` }}
        />
      ))}
    </figure>
  );
}
