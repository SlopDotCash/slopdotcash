import type { ComponentProps } from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { cn, focusRing, inactive, target } from "../lib/cn.ts";

export type CheckboxProps = Omit<ComponentProps<typeof CheckboxPrimitive.Root>, "children"> & {
  /** Marks the choice as refused, visibly and through `aria-invalid`. */
  invalid?: boolean;
};

/** A yes-or-no choice. Name it with a `Label` or `aria-label`. */
export function Checkbox({ invalid = false, className, ...props }: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      aria-invalid={invalid || undefined}
      className={cn(
        focusRing,
        inactive,
        target,
        "peer inline-flex size-4 shrink-0 items-center justify-center rounded-sm border border-input bg-background aria-invalid:border-destructive data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        <Check aria-hidden className="size-3" strokeWidth={2.5} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
