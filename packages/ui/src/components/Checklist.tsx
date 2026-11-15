import type { ComponentProps, ReactNode } from "react";
import type { SetupStatus } from "../../gen/frontend__presentation.ts";
import { setupPresentation } from "../../gen/ui__status.ts";
import { cn } from "../lib/cn.ts";
import { Status } from "./Status.tsx";

export interface ChecklistItem {
  /** A key that stays the same while the check does. */
  id: string;
  /** What is checked, in a few words. */
  label: string;
  status: SetupStatus;
  /** What the check found, such as an account or an address, shown exactly. */
  value?: ReactNode;
}

export type ChecklistProps = Omit<ComponentProps<"ul">, "children"> & {
  /** The checks, in the order a person resolves them. */
  items: readonly ChecklistItem[];
};

/**
 * Independent checks, each with what it found and whether it is ready.
 * @model spec/ui/status.md
 * @design design.md#design-system
 */
// spec/ui/status.md, "Setup checks never look ready unless they are"
export function Checklist({ items, className, ...props }: ChecklistProps) {
  return (
    <ul className={cn("flex flex-col gap-3", className)} {...props}>
      {items.map(({ id, label, status, value }) => (
        <li key={id} className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-sm font-medium text-foreground">{label}</span>
          {value != null && <span className="min-w-0 flex-1 font-mono text-sm break-all text-muted-foreground tabular-nums">{value}</span>}
          <Status presentation={setupPresentation(status)} className="ml-auto" />
        </li>
      ))}
    </ul>
  );
}
