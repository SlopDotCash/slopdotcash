import type { ComponentProps } from "react";
import { cn, focusRing, inactive } from "../lib/cn.ts";

export type InputProps = Omit<ComponentProps<"input">, "children"> & {
  /** Marks the value as refused, visibly and through `aria-invalid`. */
  invalid?: boolean;
};

/** The look a text field shares with `Textarea` and `Select`: an `input` outline (3:1) that turns destructive when invalid. */
export const fieldClass = cn(
  focusRing,
  inactive,
  "w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive",
);

/**
 * A single-line text field. Name it with a `Field`, a `Label` or `aria-label`.
 */
export function Input({ invalid = false, className, ...props }: InputProps) {
  return <input aria-invalid={invalid || undefined} className={cn(fieldClass, "h-12", className)} {...props} />;
}
