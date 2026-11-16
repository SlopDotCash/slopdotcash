import type { ComponentProps } from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn, focusRing, inactive } from "../lib/cn.ts";
import { controlState } from "../lib/control.ts";
import { StatusIcon } from "./Status.tsx";

export type SwitchProps = Omit<ComponentProps<typeof SwitchPrimitive.Root>, "children"> & {
  /** Shows a spinner and refuses a change while the last one is saved; the switch keeps its focus. */
  loading?: boolean;
};

/**
 * A setting that is on or off and takes effect at once. Name it with a `Label` or `aria-label`.
 * @model spec/ui/controls.md
 */
export function Switch({ loading = false, disabled = false, className, ...props }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        focusRing,
        inactive,
        "peer inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-input bg-muted p-0.5 transition-colors duration-fast data-[state=checked]:border-primary data-[state=checked]:bg-primary motion-reduce:transition-none",
        className,
      )}
      {...props}
      {...controlState(disabled, loading)}
    >
      <SwitchPrimitive.Thumb className="flex size-4.5 items-center justify-center rounded-full bg-foreground text-background transition-transform duration-fast data-[state=checked]:translate-x-5 data-[state=checked]:bg-primary-foreground data-[state=checked]:text-primary motion-reduce:transition-none">
        {loading && <StatusIcon icon="Spinner" className="size-3" />}
      </SwitchPrimitive.Thumb>
    </SwitchPrimitive.Root>
  );
}
