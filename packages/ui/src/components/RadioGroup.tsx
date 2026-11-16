import type { ComponentProps, ReactNode } from "react";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { cn, focusRing, inactive } from "../lib/cn.ts";
import { controlState } from "../lib/control.ts";
import { useDescription } from "./Field.tsx";
import { Label } from "./Label.tsx";

/** One choice of a `RadioGroup`. */
export interface RadioOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

export type RadioGroupProps = Omit<ComponentProps<typeof RadioGroupPrimitive.Root>, "children"> & {
  /** The question the choices answer. */
  legend: ReactNode;
  options: RadioOption[];
  /** What is wrong with the choice; its presence marks the group invalid. */
  error?: ReactNode;
  /** What to choose, when the legend cannot say it. */
  hint?: ReactNode;
};

/**
 * One choice among a few, all visible; arrow keys move between them.
 * @model spec/ui/controls.md
 */
export function RadioGroup({ legend, options, error, hint, disabled = false, className, ...props }: RadioGroupProps) {
  const { id, control, messages } = useDescription(error, hint);
  return (
    <fieldset className={cn("flex flex-col gap-3", className)}>
      <legend id={`${id}-legend`} className="mb-3 text-sm font-medium text-foreground">
        {legend}
      </legend>
      <RadioGroupPrimitive.Root aria-labelledby={`${id}-legend`} {...control} className="group flex flex-col gap-3" {...props} {...controlState(disabled)}>
        {options.map((option) => (
          <div key={option.value} className="flex items-center gap-2">
            <RadioGroupPrimitive.Item
              id={`${id}-${option.value}`}
              value={option.value}
              disabled={option.disabled}
              className={cn(
                focusRing,
                inactive,
                "peer inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-input bg-background group-aria-invalid:border-destructive data-[state=checked]:border-primary",
              )}
            >
              <RadioGroupPrimitive.Indicator className="size-2.5 rounded-full bg-primary" />
            </RadioGroupPrimitive.Item>
            <Label htmlFor={`${id}-${option.value}`}>{option.label}</Label>
          </div>
        ))}
      </RadioGroupPrimitive.Root>
      {messages}
    </fieldset>
  );
}
