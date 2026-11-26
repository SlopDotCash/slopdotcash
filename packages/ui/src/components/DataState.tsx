import type { ComponentProps, ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import type { ReadStatus } from "../../gen/frontend__requests.ts";
import { readAnnouncement, readOffersRetry, readPresentation, readShowsRows } from "../../gen/ui__status.ts";
import { cn } from "../lib/cn.ts";
import { politeness } from "../lib/live.ts";
import { tones } from "../lib/tone.ts";
import { Alert } from "./Alert.tsx";
import { Button } from "./Button.tsx";
import { EmptyState } from "./EmptyState.tsx";
import { Skeleton } from "./Skeleton.tsx";
import { Status, StatusIcon } from "./Status.tsx";

export type DataStateProps = ComponentProps<"div"> & {
  /** Where the read is, as its request machine decided it. */
  status: ReadStatus;
  /** The rows, shown while the read is current and, beside the notice, while it is stale. */
  children?: ReactNode;
  /** Asks again; offered only where the status allows a retry. */
  onRetry?: () => void;
  /** The accessible name of the retry control. */
  retryLabel?: string;
  /** The shape of the rows while they load; three lines by default. */
  skeleton?: ReactNode;
  /** The one control that fills an empty read, such as a `Button` that creates the first row. */
  emptyAction?: ReactNode;
  /** When the retained rows were read, already formatted, such as a `<time>`: shown beside the stale notice. */
  updatedAt?: ReactNode;
};

/**
 * A read's rows, or the state that stands in for them: loading, empty, stale beside the retained rows, or why it
 * failed, announced as politely as the state requires.
 * @model spec/frontend/requests.md
 * @design design.md#design-system
 */
// spec/ui/status.md, "Read states show loading, emptiness, staleness and failure differently"
export function DataState({ status, children, onRetry, retryLabel = "Retry", skeleton, emptyAction, updatedAt, className, ...props }: DataStateProps) {
  const presentation = readPresentation(status);
  const stale = status === "Stale";
  const retry = onRetry && readOffersRetry(status)
    ? stale
      ? <Button variant="ghost" size="icon" aria-label={retryLabel} title={retryLabel} onClick={onRetry} className="size-8 [&_svg]:size-4"><RotateCcw aria-hidden /></Button>
      : <Button variant="outline" size="sm" onClick={onRetry}>{retryLabel}</Button>
    : null;
  const notice =
    status === "Current" ? null : status === "Loading" ? (
      <Status presentation={presentation} />
    ) : status === "Empty" ? (
      <EmptyState title={presentation.label} icon={<StatusIcon icon={presentation.icon} className="size-6" />}>{emptyAction}</EmptyState>
    ) : stale ? (
      <p className="inline-flex flex-wrap items-center gap-2 text-ui font-semibold text-muted-foreground">
        <StatusIcon icon={presentation.icon} className={cn("size-3.5", tones[presentation.tone].text)} />
        {presentation.label}
        {updatedAt ? <> · {updatedAt}</> : null}
        {retry}
      </p>
    ) : (
      <Alert variant={tones[presentation.tone].alert} announcement="Silent" action={retry}>
        <Status presentation={presentation} />
      </Alert>
    );
  // No `aria-busy` around the live region: a screen reader may hold back what changes under it, and "Loading" with it.
  return (
    <div className={cn("flex flex-col gap-4", className)} {...props}>
      <div aria-live={politeness[readAnnouncement(status)]}>{notice}</div>
      {status === "Loading" && (skeleton ?? [0, 1, 2].map((line) => <Skeleton key={line} />))}
      {readShowsRows(status) && children}
    </div>
  );
}
