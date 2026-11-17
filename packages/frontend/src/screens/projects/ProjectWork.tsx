// spec/frontend/rankedSnapshot.md, "A candidate check records score and payment results separately"; spec/frontend/snapshotCache.md, "A cached snapshot is fresh for 60 seconds, stale 8 hours after generation, and a failed read retries once after 400 ms unless aborted"
import type { WorkItem } from "@repo/points/client";
import { Alert, Button, ExternalLink, Status } from "@repo/ui";
import { CircleDot, GitPullRequest } from "lucide-react";
import { useState } from "react";
import { formatDateTime } from "../../app/format.ts";
import { workShown } from "./summary.ts";

export type WorkShown =
  | { readonly status: "loading" }
  | { readonly status: "failed" }
  | { readonly status: "ready"; readonly items: ReadonlyArray<WorkItem>; readonly generatedAt: string; readonly stale: boolean; readonly refreshFailed: boolean };

export type ProjectWorkProps = {
  /** The suggested work from the public snapshot. */
  work: WorkShown;
  /** Reads the snapshot again. */
  onRetry: () => void;
};

function Outdated({ generatedAt, onRetry }: { generatedAt: string; onRetry?: () => void }) {
  return (
    <Alert
      variant="warn"
      announcement="Polite"
      action={
        onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        ) : null
      }
    >
      Points may be outdated · updated {formatDateTime(generatedAt)}.
    </Alert>
  );
}

function WorkLink({ item }: { item: WorkItem }) {
  const label = item.kind === "issue" ? "Issue" : "PR";
  const Icon = item.kind === "issue" ? CircleDot : GitPullRequest;
  return (
    <ExternalLink href={item.url} label={`${label} #${item.number}: ${item.title}`} className="flex min-h-11 items-center gap-3 px-2 py-2 hover:bg-accent">
      <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 break-words text-foreground">{item.title}</span>
      <span className="shrink-0 text-sm text-muted-foreground">
        {label} #{item.number}
      </span>
    </ExternalLink>
  );
}

/** Suggested work from the public snapshot; GitHub stays the authority for taking it. */
export function ProjectWork({ work, onRetry }: ProjectWorkProps) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section aria-label="Suggested work" className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold text-foreground">Suggested work</h2>
      {work.status === "loading" ? (
        <Status presentation={{ tone: "Neutral", icon: "Spinner", label: "Loading work…" }} />
      ) : work.status === "failed" ? (
        <Alert
          variant="destructive"
          action={
            <Button variant="outline" size="sm" onClick={onRetry}>
              Retry
            </Button>
          }
        >
          Work unavailable.
        </Alert>
      ) : (
        <>
          {work.refreshFailed ? <Outdated generatedAt={work.generatedAt} onRetry={onRetry} /> : work.stale ? <Outdated generatedAt={work.generatedAt} /> : null}
          {work.items.length ? (
            <ul className="flex flex-col divide-y divide-border">
              {(expanded ? work.items : work.items.slice(0, workShown)).map((item) => (
                <li key={item.id}>
                  <WorkLink item={item} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">No suggested work right now.</p>
          )}
          {!expanded && work.items.length > workShown ? (
            <Button variant="outline" className="self-start" onClick={() => setExpanded(true)}>
              Show all {work.items.length}
            </Button>
          ) : null}
        </>
      )}
    </section>
  );
}
