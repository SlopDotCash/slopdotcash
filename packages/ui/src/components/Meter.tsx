import type { ComponentProps } from "react";
import type { Tone } from "../../gen/designSystem.ts";
import { cn } from "../lib/cn.ts";
import { tones } from "../lib/tone.ts";

export interface MeterSegment {
  /** What the segment counts, in a word or two. */
  label: string;
  /** Its share of the bar, as a count; zero leaves it out of the bar but keeps it in the legend. */
  value: number;
  tone: Tone;
}

export type MeterProps = Omit<ComponentProps<"figure">, "children"> & {
  /** What the whole bar shows, its accessible name. */
  label: string;
  /** The parts of the whole, in the order they stack from the left. */
  segments: readonly MeterSegment[];
  /** Shows the legend; hidden, it is still read by assistive technology. */
  legend?: boolean;
};

/**
 * Parts of a whole stacked in one bar, with a legend of each part's count. The bar is decorative: the legend
 * carries every number.
 * @design design.md#design-system
 */
// spec/designSystem/index.md, "Each tone is a role that is readable as text"
export function Meter({ label, segments, legend = true, className, ...props }: MeterProps) {
  return (
    <figure aria-label={label} className={cn("flex flex-col gap-2", className)} {...props}>
      <div aria-hidden className="flex h-2 w-full gap-px overflow-hidden rounded-lg bg-secondary">
        {segments.map(({ label: part, value, tone }) => value > 0 && <div key={part} className={tones[tone].fill} style={{ flexGrow: value }} />)}
      </div>
      <ul className={cn("flex flex-wrap gap-x-4 gap-y-1 text-sm", !legend && "sr-only")}>
        {segments.map(({ label: part, value, tone }) => (
          <li key={part} className="flex items-center gap-1.5 text-muted-foreground">
            <span aria-hidden className={cn("size-2 rounded-sm", tones[tone].fill)} />
            {part}
            <span className="font-mono text-foreground tabular-nums">{value}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
