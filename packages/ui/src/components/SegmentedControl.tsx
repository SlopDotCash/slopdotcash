import type { ComponentProps } from "react";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cn, focusRing } from "../lib/cn.ts";
import { controlState } from "../lib/control.ts";

/** One segment of a `SegmentedControl`. */
export interface Segment {
  value: string;
  label: string;
}

export type SegmentedControlProps = Omit<ComponentProps<typeof ToggleGroupPrimitive.Root>, "type" | "value" | "defaultValue" | "onValueChange" | "children"> & {
  options: Segment[];
  /** The chosen segment's `value`. */
  value: string;
  /** Called with a segment chosen in place of the current one; choosing the current one again calls nothing. */
  onValueChange: (value: string) => void;
  /** The name of what the segments choose, such as "Period". */
  "aria-label": string;
};

/**
 * One of a few views of the same content, such as a period: exactly one is always chosen.
 * @model spec/ui/controls.md
 */
export function SegmentedControl({ options, value, onValueChange, disabled = false, className, ...props }: SegmentedControlProps) {
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      value={value}
      // Radix offers "" when the chosen segment is pressed again; a segmented control keeps one chosen.
      onValueChange={(next) => next && onValueChange(next)}
      className={cn("inline-flex gap-1 rounded-md border border-input bg-background p-1", className)}
      {...props}
      {...controlState(disabled)}
    >
      {options.map((option) => (
        <ToggleGroupPrimitive.Item
          key={option.value}
          value={option.value}
          className={cn(
            focusRing,
            "h-10 rounded-sm px-3 text-sm text-muted-foreground transition-colors duration-fast hover:text-foreground disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-secondary data-[state=on]:font-semibold data-[state=on]:text-secondary-foreground motion-reduce:transition-none",
          )}
        >
          {option.label}
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  );
}
