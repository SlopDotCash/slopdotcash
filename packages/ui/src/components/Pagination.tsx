import { type ComponentProps, type RefObject, useEffect, useReducer, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { type Event, type Pages, enabled, initial, step } from "../../gen/ui__pagination.ts";
import { cn } from "../lib/cn.ts";
import { Button } from "./Button.tsx";

export type { Pages };
export type PageEvent = Event;

export type PaginationProps = Omit<ComponentProps<"nav">, "children"> & {
  /** The page shown and how many there are, from `usePagination`. */
  state: Pages;
  /** Receives each move the rules allow; the owner applies it and reads that page. */
  onSend: (event: PageEvent) => void;
  /** The name of the navigation landmark. */
  label?: string;
  backLabel?: string;
  forwardLabel?: string;
  /** What the page status reads, such as "Page 2 of 5"; the page and count are shown as `2 / 5`. */
  pageLabel?: (page: number, pages: number) => string;
};

/** The pages of a list and the one way to change them: the generated pagination machine, held by its list. */
export const usePagination = (start: Pages = initial) => useReducer(step, start);

/**
 * Moves through the pages of a list. Back and forward work only where there is a page to go to, and nothing shows
 * for a list of one page.
 * @model spec/ui/pagination.md
 */
export function Pagination({
  state,
  onSend,
  label = "Pagination",
  backLabel = "Previous page",
  forwardLabel = "Next page",
  pageLabel = (page, pages) => `Page ${page} of ${pages}`,
  className,
  ...props
}: PaginationProps) {
  const backRef = useRef<HTMLButtonElement>(null);
  const forwardRef = useRef<HTMLButtonElement>(null);
  const refocusRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    refocusRef.current?.focus();
    refocusRef.current = null;
  });
  if (state.pages === 1) return null;
  // A move to the first or last page disables its own button (spec/ui/controls.md), so focus goes to the other one,
  // which can always move back, and the person stays in the list. Of two pages, the other is still disabled until the
  // owner applies the move, so focus follows once it renders.
  const move = (event: PageEvent, other: RefObject<HTMLButtonElement | null>) => {
    if (!enabled(state, event)) return;
    if (!enabled(step(state, event), event)) {
      other.current?.focus();
      if (document.activeElement !== other.current) refocusRef.current = other.current;
    }
    onSend(event);
  };
  return (
    <nav aria-label={label} className={cn("flex items-center justify-center gap-2", className)} {...props}>
      <Button variant="ghost" size="icon" aria-label={backLabel} ref={backRef} disabled={!enabled(state, { type: "back" })} onClick={() => move({ type: "back" }, forwardRef)}>
        <ChevronLeft aria-hidden className="size-4" />
      </Button>
      <span role="status" className="font-mono text-sm tabular-nums">
        <span className="sr-only">{pageLabel(state.page, state.pages)}</span>
        <span aria-hidden>
          {state.page} / {state.pages}
        </span>
      </span>
      <Button variant="ghost" size="icon" aria-label={forwardLabel} ref={forwardRef} disabled={!enabled(state, { type: "forward" })} onClick={() => move({ type: "forward" }, backRef)}>
        <ChevronRight aria-hidden className="size-4" />
      </Button>
    </nav>
  );
}
