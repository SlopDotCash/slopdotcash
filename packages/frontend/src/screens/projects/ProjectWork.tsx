// spec/frontend/rankedSnapshot.md, "A candidate check records score and payment results separately"; spec/frontend/snapshotCache.md, "A cached snapshot is fresh for 60 seconds, stale 8 hours after generation, and a failed read retries once after 400 ms unless aborted"; spec/frontend/views.md, "Suggested work lists the wanted issues first, unclaimed before taken, at most ten, and a failed wanted read leaves the suggestions as before"; spec/ui/status.md, "Read states show loading, emptiness, staleness and failure differently"
import type { WorkItem } from "@repo/points/client";
import { Alert, Button, DataState, ExternalLink, Status, sectionTitle } from "@repo/ui";
import { CircleDot, GitPullRequest, Star } from "lucide-react";
import { useState } from "react";
import { snapshotErrorShown, type WantedRead } from "../../../gen/frontend__views.ts";
import { formatDateTime } from "../../app/format.ts";
import { type ShownWanted, workShown } from "./summary.ts";

export type WorkShown =
  | { readonly status: "loading" }
  | { readonly status: "failed" }
  | { readonly status: "ready"; readonly items: ReadonlyArray<WorkItem>; readonly generatedAt: string; readonly stale: boolean; readonly refreshFailed: boolean };

export type ProjectWorkProps = {
  /** The suggested work from the public snapshot, without the wanted issues listed above it. */
  work: WorkShown;
  /** The project's wanted issues from the merge activity read, in the order they are listed. */
  wanted: { readonly read: WantedRead; readonly issues: ReadonlyArray<ShownWanted> };
  /** Reads the snapshot again. */
  onRetry: () => void;
};

type Row = { readonly id: string; readonly issue: boolean; readonly number: number; readonly title: string; readonly url: string; readonly note: "Wanted" | "Wanted · PR open" | null };

/** @throws {never} */
function rowsOf(wanted: ReadonlyArray<ShownWanted>, items: ReadonlyArray<WorkItem>): ReadonlyArray<Row> {
  return [
    ...wanted.map((issue) => ({ id: `wanted:${issue.url}`, issue: true, number: issue.number, title: issue.title, url: issue.url, note: issue.openPullRequests > 0 ? ("Wanted · PR open" as const) : ("Wanted" as const) })),
    ...items.map((item) => ({ id: item.id, issue: item.kind === "issue", number: item.number, title: item.title, url: item.url, note: null })),
  ];
}

function WorkLink({ row }: { row: Row }) {
  const kind = row.issue ? "Issue" : "PR";
  const Icon = row.note ? Star : row.issue ? CircleDot : GitPullRequest;
  return (
    <ExternalLink href={row.url} className="flex min-h-11 items-center gap-3 py-3 hover:bg-accent">
      <Icon aria-hidden className="size-4.5 shrink-0 text-primary-hover" />
      <span className="min-w-0 flex-1 break-words text-foreground underline underline-offset-4">{row.title}</span>
      <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
        {row.note ? `${row.note} · ` : ""}
        {kind} #{row.number}
      </span>
    </ExternalLink>
  );
}

function WorkList({ rows }: { rows: ReadonlyArray<Row> }) {
  const [expanded, setExpanded] = useState(false);
  if (!rows.length) return <p className="text-muted-foreground">Nothing open</p>;
  return (
    <>
      <ul className="flex flex-col">
        {(expanded ? rows : rows.slice(0, workShown)).map((row) => (
          <li key={row.id} className="border-t border-border">
            <WorkLink row={row} />
          </li>
        ))}
      </ul>
      {!expanded && rows.length > workShown ? (
        <Button variant="outline" className="self-start" onClick={() => setExpanded(true)}>
          Show all {rows.length}
        </Button>
      ) : null}
    </>
  );
}

/** Suggested work: the maintainers' wanted issues first, then the public snapshot's suggestions; GitHub stays the authority for taking it. */
export function ProjectWork({ work, wanted, onRetry }: ProjectWorkProps) {
  return (
    <section aria-label="Suggested work" className="flex flex-col gap-7">
      <h2 className={sectionTitle}>Suggested work</h2>
      {work.status === "loading" ? (
        <Status presentation={{ tone: "Neutral", icon: "Spinner", label: "Loading work…" }} />
      ) : work.status === "failed" ? (
        snapshotErrorShown(true, wanted.read) ? (
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
          <WorkList rows={rowsOf(wanted.issues, [])} />
        )
      ) : (
        <DataState
          status={work.stale || work.refreshFailed ? "Stale" : "Current"}
          updatedAt={<time dateTime={work.generatedAt}>{formatDateTime(work.generatedAt)}</time>}
          onRetry={work.refreshFailed ? onRetry : undefined}
        >
          <WorkList rows={rowsOf(wanted.issues, work.items)} />
        </DataState>
      )}
    </section>
  );
}
