import type { ComponentProps, ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "../lib/cn.ts";
import { exactValue } from "../lib/exact.ts";

export interface CompareChangeRow {
  /** What changes. */
  label: string;
  /** The value now, already formatted. */
  current: ReactNode;
  /** The value proposed, already formatted. */
  proposed: ReactNode;
  /** An exact amount, address or hash: monospaced, and scrolled rather than cut short. */
  exact?: boolean;
}

export type CompareChangeProps = Omit<ComponentProps<"dl">, "children"> & {
  /** One row per value that changes. */
  changes: CompareChangeRow[];
  currentLabel?: string;
  proposedLabel?: string;
};

/** What a change replaces: each value now beside the value proposed. */
export function CompareChange({ changes, currentLabel = "Current", proposedLabel = "Proposed", className, ...props }: CompareChangeProps) {
  const value = (exact: boolean | undefined) => (exact ? { tabIndex: 0, className: exactValue } : { className: "min-w-0" });
  return (
    <dl className={cn("grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] items-baseline gap-x-4 gap-y-2 text-sm", className)} {...props}>
      {changes.map(({ label, current, proposed, exact }) => (
        <div key={label} className="col-span-3 grid grid-cols-subgrid items-baseline">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="flex min-w-0 text-muted-foreground">
            <span {...value(exact)}>
              <span className="sr-only">{currentLabel}: </span>
              {current}
            </span>
          </dd>
          <dd className="flex min-w-0 items-center gap-3 font-medium text-foreground">
            <ArrowRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span {...value(exact)}>
              <span className="sr-only">{proposedLabel}: </span>
              {proposed}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
