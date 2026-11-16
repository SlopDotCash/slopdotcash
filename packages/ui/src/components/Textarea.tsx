import type { ComponentProps } from "react";
import { cn } from "../lib/cn.ts";
import { fieldClass } from "./Input.tsx";

export type TextareaProps = Omit<ComponentProps<"textarea">, "children"> & {
  /** Marks the value as refused, visibly and through `aria-invalid`. */
  invalid?: boolean;
};

/**
 * A text field of several lines. Name it with a `Field`, a `Label` or `aria-label`.
 */
export function Textarea({ invalid = false, className, ...props }: TextareaProps) {
  return <textarea aria-invalid={invalid || undefined} className={cn(fieldClass, "min-h-24 resize-y py-3", className)} {...props} />;
}
