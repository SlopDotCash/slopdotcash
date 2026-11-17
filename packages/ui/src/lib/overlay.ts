import { cn } from "./cn.ts";

// What Dialog, ConfirmDialog and AccountMenu share, so what floats looks alike and stacks above the sticky SiteHeader.

/** The raised surface of a modal or a menu. */
export const popover = "z-modal rounded-md border border-border bg-popover text-popover-foreground shadow-panel";

/** The dimmed page behind a modal. */
export const overlay = "fixed inset-0 z-modal bg-foreground/50";

/** The modal panel, centred over the overlay and inset from a phone's edges. */
export const panel = cn(popover, "fixed top-1/2 left-1/2 flex w-[calc(100%-2rem)] max-w-md -translate-1/2 flex-col gap-4 rounded-lg p-6 outline-none");

/** A modal's heading. */
export const heading = "text-base leading-none font-semibold";

/** What a modal's heading leads to, read with it as its description. */
export const description = "text-sm text-muted-foreground";
