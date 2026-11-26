import { type ComponentProps, type RefObject, useReducer, useRef } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
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
  const pendingFocusRef = useRef<"back" | "forward" | null>(null);
  if (state.pages === 1) return null;
  const move = (event: PageEvent, target: "back" | "forward", other: RefObject<HTMLButtonElement | null>) => {
    if (!enabled(state, event)) return;
    if (!enabled(step(state, event), event)) {
      other.current?.focus();
      if (document.activeElement !== other.current) pendingFocusRef.current = target;
    }
    onSend(event);
  };
  const attachBack = (node: HTMLButtonElement | null) => {
    backRef.current = node;
    if (node !== null && !node.disabled && pendingFocusRef.current === "back") {
      pendingFocusRef.current = null;
      node.focus();
    }
  };
  const attachForward = (node: HTMLButtonElement | null) => {
    forwardRef.current = node;
    if (node !== null && !node.disabled && pendingFocusRef.current === "forward") {
      pendingFocusRef.current = null;
      node.focus();
    }
  };
  return (
    <nav aria-label={label} className={cn("flex items-center justify-center gap-4", className)} {...props}>
      <Button variant="outline" size="icon" aria-label={backLabel} ref={attachBack} disabled={!enabled(state, { type: "back" })} onClick={() => move({ type: "back" }, "forward", forwardRef)}>
        <ArrowLeft aria-hidden />
      </Button>
      <span role="status" className="font-mono text-sm text-muted-foreground tabular-nums">
        <span className="sr-only">{pageLabel(state.page, state.pages)}</span>
        <span aria-hidden>
          {state.page} / {state.pages}
        </span>
      </span>
      <Button variant="outline" size="icon" aria-label={forwardLabel} ref={attachForward} disabled={!enabled(state, { type: "forward" })} onClick={() => move({ type: "forward" }, "back", backRef)}>
        <ArrowRight aria-hidden />
      </Button>
    </nav>
  );
}
