import type { ComponentProps } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../lib/cn.ts";
import { fieldClass } from "./Input.tsx";

export type SelectProps = ComponentProps<"select"> & {
  /** Marks the choice as refused, visibly and through `aria-invalid`. */
  invalid?: boolean;
};

/**
 * A choice from a list, as the browser's own `select` of `option`s. Name it with a `Field`, a `Label` or `aria-label`.
 * @model spec/ui/controls.md
 */
export function Select({ invalid = false, className, ...props }: SelectProps) {
  return (
    <div className={cn("relative", className)}>
      <select aria-invalid={invalid || undefined} className={cn(fieldClass, "h-12 appearance-none pr-10")} {...props} />
      <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}
