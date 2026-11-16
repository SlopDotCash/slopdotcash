import type { ComponentProps, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import type { Announcement } from "../../gen/ui__status.ts";
import { cn } from "../lib/cn.ts";
import { announcer } from "../lib/live.ts";

const alertVariants = cva("flex items-center gap-4 rounded-md border-l-4 bg-card px-4 py-3 text-sm text-card-foreground", {
  variants: { variant: { neutral: "border-border", info: "border-info", ok: "border-ok", warn: "border-warn", destructive: "border-destructive" } },
  defaultVariants: { variant: "neutral" },
});

export type AlertProps = ComponentProps<"div"> &
  VariantProps<typeof alertVariants> & {
    /** How a screen reader hears it; by default `warn` and `destructive` interrupt and the others wait their turn. `Silent` when a live region around it announces it. */
    announcement?: Announcement;
    /** The one control that answers it, such as Retry, at its end. */
    action?: ReactNode;
  };

/**
 * A message about what just happened, announced as its owning spec decides.
 */
export function Alert({ variant, announcement = variant === "warn" || variant === "destructive" ? "Assertive" : "Polite", action, className, children, ...props }: AlertProps) {
  return (
    <div role={announcer[announcement]} className={cn(alertVariants({ variant }), className)} {...props}>
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}
