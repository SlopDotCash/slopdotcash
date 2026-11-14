// The classes Dialog and ConfirmDialog share, so both modals look and stack alike above the sticky SiteHeader.

/** The dimmed page behind a modal. */
export const overlay = "fixed inset-0 z-50 bg-foreground/50";

/** The modal panel, centred over the overlay and inset from a phone's edges. */
export const panel =
  "fixed top-1/2 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-md -translate-1/2 flex-col gap-4 rounded-lg border border-border bg-popover p-6 text-popover-foreground shadow-panel outline-none";

/** A modal's heading. */
export const heading = "text-base leading-none font-semibold";

/** What a modal's heading leads to, read with it as its description. */
export const description = "text-sm text-muted-foreground";
