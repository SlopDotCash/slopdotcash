import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn.ts";

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

/** The page's closing row of community links. */
export function SiteFooter({ label = "Community", brand, compact = false, className, children, ...props }: SiteFooterProps) {
  return (
    <footer className={cn("border-t border-border text-sm text-muted-foreground", className)} {...props}>
      <div className={cn("mx-auto flex max-w-(--breakpoint-lg) flex-wrap items-center gap-x-6 gap-y-3 px-4", compact ? "py-3" : "py-8")}>
        {brand}
        <nav aria-label={label} className="flex flex-wrap gap-x-4 gap-y-2 *:rounded-sm *:outline-none *:hover:text-foreground *:focus-visible:ring-2 *:focus-visible:ring-ring">
          {children}
        </nav>
      </div>
    </footer>
  );
}
