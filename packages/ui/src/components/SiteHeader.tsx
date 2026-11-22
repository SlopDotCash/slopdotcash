import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn.ts";

/** The one content width of the header, the home page and the footer: development's `.shell`, 1180px within a 24px gutter, 14px under `md`. */
export const shell = "mx-auto w-[min(var(--breakpoint-shell),100%_-_3rem)] wrap-anywhere max-md:w-[min(100%_-_1.75rem,var(--breakpoint-shell))]";

export type SiteHeaderProps = Omit<ComponentProps<"header">, "children"> & {
  /** The home link, usually a `Logo` inside a link. */
  brand?: ReactNode;
  /** The site's navigation, such as a link drawn as a `Button`, at the end of the row before the account. */
  nav?: ReactNode;
  /** Sign-in, or the `AccountMenu` of the signed-in account. */
  account?: ReactNode;
};

/**
 * The page's banner, held at the top of the viewport over the blurred page while it scrolls. It adds no skip link.
 * spec/frontend/presentation.md, "The campaign keeps one stable accessible heading and respects reduced motion".
 */
export function SiteHeader({ brand, nav, account, className, ...props }: SiteHeaderProps) {
  return (
    <header className={cn("sticky top-0 z-header border-b border-foreground/10 bg-background/88 backdrop-blur-header", className)} {...props}>
      <div className={cn(shell, "flex min-h-22 flex-wrap items-center justify-between gap-3 py-3 max-md:min-h-18 max-md:flex-nowrap max-md:gap-2")}>
        {brand}
        {nav ? <div className="ml-auto flex min-w-0 items-center gap-3 max-md:gap-2">{nav}</div> : null}
        {account}
      </div>
    </header>
  );
}
