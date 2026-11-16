import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn.ts";
import { StatusIcon, type StatusIconProps } from "./Status.tsx";

const spinnerVariants = cva("", {
  variants: { size: { sm: "size-4", md: "size-6", lg: "size-8" } },
  defaultVariants: { size: "md" },
});

export type SpinnerProps = Omit<StatusIconProps, "icon"> &
  VariantProps<typeof spinnerVariants> & {
    /** What is loading, for assistive technology. */
    label?: string;
  };

/** The status icon's spinner on its own, named, for work whose length is unknown; it stands still under reduced motion. */
export function Spinner({ size, label = "Loading", className, ...props }: SpinnerProps) {
  return <StatusIcon icon="Spinner" role="status" aria-label={label} className={cn(spinnerVariants({ size }), className)} {...props} />;
}
