import { type ComponentProps, useReducer } from "react";
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
};

/** The pages of a list and the one way to change them: the generated pagination machine, held by its list. */
export const usePagination = (start: Pages = initial) => useReducer(step, start);

/**
 * Moves through the pages of a list. Back and forward work only where there is a page to go to, and nothing shows
 * for a list of one page.
 * @model spec/ui/pagination.md
 */
export function Pagination({ state, onSend, label = "Pagination", backLabel = "Previous page", forwardLabel = "Next page", className, ...props }: PaginationProps) {
  if (state.pages === 1) return null;
  const move = (event: PageEvent) => {
    if (enabled(state, event)) onSend(event);
  };
  return (
    <nav aria-label={label} className={cn("flex items-center justify-center gap-2", className)} {...props}>
      <Button variant="ghost" size="icon" aria-label={backLabel} disabled={!enabled(state, { type: "back" })} onClick={() => move({ type: "back" })}>
        <ChevronLeft aria-hidden className="size-4" />
      </Button>
      <span aria-live="polite" className="font-mono text-sm tabular-nums">
        <span className="sr-only">Page </span>
        {state.page}
        <span aria-hidden> / </span>
        <span className="sr-only"> of </span>
        {state.pages}
      </span>
      <Button variant="ghost" size="icon" aria-label={forwardLabel} disabled={!enabled(state, { type: "forward" })} onClick={() => move({ type: "forward" })}>
        <ChevronRight aria-hidden className="size-4" />
      </Button>
    </nav>
  );
}
