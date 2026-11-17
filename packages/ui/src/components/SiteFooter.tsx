import type { ComponentProps, ReactNode } from "react";
import { childFocusRing, childTarget, cn } from "../lib/cn.ts";

export type SiteFooterProps = ComponentProps<"footer"> & {
  /** The links of the community: repository, documentation, X and the like. */
  children?: ReactNode;
  /** The name of the links' navigation landmark. */
  label?: string;
  /** Shown before the links, usually a small `Logo`. */
  brand?: ReactNode;
  /** One tight row, for a page that needs the room. */
  compact?: boolean;
};

/**
 * The page's closing row of community links: on the accent, as development's marketing footer, or on a card's surface
 * when compact. On the accent the focus ring takes the accent's text color, which the ring token would match.
 */
export function SiteFooter({ label = "Community", brand, compact = false, className, children, ...props }: SiteFooterProps) {
  return (
    <footer className={cn("text-sm", compact ? "border-t border-border bg-card text-card-foreground" : "bg-primary text-primary-foreground", className)} {...props}>
      <div className={cn("mx-auto flex max-w-(--breakpoint-lg) flex-wrap items-center gap-x-6 gap-y-3 px-4", compact ? "py-3" : "py-12")}>
        {brand}
        <nav
          aria-label={label}
          className={cn(childFocusRing, childTarget, "flex flex-wrap gap-x-4 gap-y-2 *:rounded-sm *:underline-offset-4 *:hover:underline", !compact && "*:focus-visible:ring-primary-foreground")}
        >
          {children}
        </nav>
      </div>
    </footer>
  );
}
