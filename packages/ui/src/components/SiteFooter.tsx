import type { ComponentProps, ReactNode } from "react";
import { childFocusRing, childTarget, cn } from "../lib/cn.ts";
import { shell } from "./SiteHeader.tsx";

export type SiteFooterProps = ComponentProps<"footer"> & {
  /** The links of the community: repository, documentation, X and the like. */
  children?: ReactNode;
  /** The name of the links' navigation landmark. */
  label?: string;
  /** Shown before the links, usually a `Logo`. */
  brand?: ReactNode;
  /** One tight row on a card's surface, for a page that needs the room. */
  compact?: boolean;
};

/**
 * The page's closing row: the brand at the start and the community links in a right-aligned column, on the accent
 * as development's marketing footer, or on a card's surface when compact. On the accent the focus ring takes the
 * accent's text color, which the ring token would match.
 */
export function SiteFooter({ label = "Community", brand, compact = false, className, children, ...props }: SiteFooterProps) {
  return (
    <footer className={cn(compact ? "bg-card text-card-foreground" : "bg-primary text-primary-foreground", className)} {...props}>
      <div className={cn(shell, "flex flex-wrap justify-between", compact ? "items-center gap-4 py-6" : "items-end gap-8 py-12")}>
        {brand ? <div className="flex min-w-0 flex-col items-start gap-5">{brand}</div> : null}
        <nav
          aria-label={label}
          className={cn(
            childFocusRing,
            childTarget,
            "ml-auto flex min-w-0 max-w-full flex-col items-end gap-3 font-semibold *:w-fit *:min-w-11 *:max-w-full *:text-right *:rounded-sm *:wrap-anywhere *:underline-offset-4 *:hover:underline",
            compact ? "text-sm leading-page" : "text-base leading-page *:focus-visible:ring-primary-foreground",
          )}
        >
          {children}
        </nav>
      </div>
    </footer>
  );
}
