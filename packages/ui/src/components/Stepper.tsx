import type { ComponentProps } from "react";
import { cn } from "../lib/cn.ts";
import { StatusIcon } from "./Status.tsx";

export type StepperProps = Omit<ComponentProps<"ol">, "children"> & {
  /** The steps' names, in order. */
  steps: string[];
  /** The index of the step in progress: those before it are done. Leave it out to show the steps as a lifecycle. */
  current?: number;
  /** The word that marks a step done, for assistive technology. */
  doneLabel?: string;
};

/** Ordered steps, such as setup's or a payment's lifecycle, with the one in progress marked. */
export function Stepper({ steps, current, doneLabel = "Done", className, ...props }: StepperProps) {
  return (
    <ol className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 text-sm", className)} {...props}>
      {steps.map((name, index) => {
        const done = current !== undefined && index < current;
        const now = index === current;
        return (
          <li key={name} aria-current={now ? "step" : undefined} className={cn("flex items-center gap-2", now ? "font-medium text-foreground" : "text-muted-foreground")}>
            <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-xs tabular-nums", now ? "border-primary bg-primary text-primary-foreground" : "border-input")}>
              {done ? <StatusIcon icon="Check" role="img" aria-label={doneLabel} className="size-3.5" /> : index + 1}
            </span>
            {name}
          </li>
        );
      })}
    </ol>
  );
}
