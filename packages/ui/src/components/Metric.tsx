import type { ComponentProps, ReactNode } from "react";
import type { Tone } from "../../gen/designSystem.ts";
import { cn } from "../lib/cn.ts";
import { tones } from "../lib/tone.ts";

export type MetricProps = Omit<ComponentProps<"div">, "children"> & {
  /** What the value counts. */
  label: string;
  /** The value, already formatted. */
  value: ReactNode;
  /** The tone of a value that is a state; it colors the icon, which says the same thing. */
  tone?: Tone;
  /** A picture of what the value counts; decorative. */
  icon?: ReactNode;
  /** One fact under the value. */
  detail?: ReactNode;
};
export type MetricGridProps = ComponentProps<"dl">;

/**
 * A number that matters, large, with what it counts. Place it in a `MetricGrid`.
 * @design design.md#design-system
 */
export function Metric({ label, value, tone = "Neutral", icon, detail, className, ...props }: MetricProps) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)} {...props}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-2 text-2xl font-semibold tabular-nums">
        {icon ? <span aria-hidden className={cn("[&_svg]:size-5", tones[tone].text)}>{icon}</span> : null}
        {value}
      </dd>
      {detail ? <dd className="text-xs text-muted-foreground">{detail}</dd> : null}
    </div>
  );
}

/** A row of `Metric`s that wraps on a narrow screen. */
export function MetricGrid({ className, ...props }: MetricGridProps) {
  return <dl className={cn("grid grid-cols-2 gap-6 md:grid-cols-4", className)} {...props} />;
}
