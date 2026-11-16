import type { ComponentProps } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn, focusRing } from "../lib/cn.ts";

export type NavTabsProps = ComponentProps<"nav"> & {
  /** The name of the navigation landmark. */
  label: string;
};
export type NavTabProps = ComponentProps<"a"> & {
  /** Marks the link to the page being shown, with `aria-current="page"`. */
  current?: boolean;
  /** Renders the single child element, a router's link, with the tab's styles. */
  asChild?: boolean;
};

/**
 * Links between sibling pages, as a row of tabs; the current one is marked. Never the account's pages, which stay
 * separate menu destinations: spec/frontend/presentation.md, "Settings keeps wallet and email controls expanded without account navigation tabs".
 */
export function NavTabs({ label, className, ...props }: NavTabsProps) {
  return <nav aria-label={label} className={cn("flex items-center gap-1", className)} {...props} />;
}

/** One link of `NavTabs`. */
export function NavTab({ current = false, asChild = false, className, ...props }: NavTabProps) {
  const Comp = asChild ? Slot : "a";
  return (
    <Comp
      aria-current={current ? "page" : undefined}
      className={cn(
        focusRing,
        "rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap text-muted-foreground hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground motion-safe:transition-colors motion-safe:duration-fast",
        className,
      )}
      {...props}
    />
  );
}
