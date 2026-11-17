import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn.ts";

export type SiteHeaderProps = Omit<ComponentProps<"header">, "children"> & {
  /** The home link, usually a `Logo` inside a link. */
  brand?: ReactNode;
  /** The site's navigation, such as `NavTabs`. */
  nav?: ReactNode;
  /** Sign-in, or the `AccountMenu` of the signed-in account. */
  account?: ReactNode;
};

/**
 * The page's banner, held at the top of the viewport while the page scrolls. It adds no skip link.
 * spec/frontend/presentation.md, "The campaign keeps one stable accessible heading and respects reduced motion".
 */
export function SiteHeader({ brand, nav, account, className, ...props }: SiteHeaderProps) {
  return (
    <header className={cn("sticky top-0 z-header border-b border-border bg-background", className)} {...props}>
      <div className="mx-auto flex h-14 max-w-(--breakpoint-lg) items-center gap-4 px-4">
        {brand}
        {/* Room inside the scroller for the focus ring and each link's 44px hit area, which it would otherwise clip. */}
        <div className="min-w-0 flex-1 overflow-x-auto px-1 py-2">{nav}</div>
        {account}
      </div>
    </header>
  );
}
