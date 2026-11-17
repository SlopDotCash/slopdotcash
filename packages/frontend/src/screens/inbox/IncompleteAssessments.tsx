// spec/slopbot/assessmentInbox.md, "Only a matching accepted final outcome at or after the gap resolves it"; spec/slopbot/assessmentInbox.md, "A departed page or changed actor cannot display a late queue response"; spec/slopbot/assessmentInbox.md, "Denial clears the item and uncertain authority is retryable"
import type { IncompleteAssessments as Queue } from "@repo/slopbot/client";
import { Alert, Button, ListItem } from "@repo/ui";
import { useState } from "react";
import { formatDateTime } from "../../app/format.ts";
import { useMounted } from "../security/program/hooks.ts";
import { type InboxRuntime, assessmentPage } from "./runtime.vibe";

export type IncompleteAssessmentsProps = {
  /** The page shown, once read. */
  queue?: Queue;
  /** The page could not be read. */
  failed?: boolean;
  /** An earlier page exists. */
  hasEarlier?: boolean;
  onEarlier: () => void;
  onMore: (next: string) => void;
  onRetry: () => void;
};

function Progress({ item }: { item: Queue["items"][number] }) {
  if (item.running) return <>Retrying</>;
  if (item.retryAt) {
    return (
      <>
        Next retry <time dateTime={item.retryAt}>{formatDateTime(item.retryAt)}</time>
      </>
    );
  }
  return <>Awaiting assessment</>;
}

/** Pull requests of the maintainer's projects whose assessment has not finished, with when each is tried again. */
export function IncompleteAssessments({ queue, failed = false, hasEarlier = false, onEarlier, onMore, onRetry }: IncompleteAssessmentsProps) {
  if (!failed && (queue === undefined || (queue.items.length === 0 && !hasEarlier))) return null;
  const next = queue?.next ?? null;
  return (
    <section aria-labelledby="incomplete-assessments" className="flex flex-col gap-2">
      <h2 id="incomplete-assessments" className="text-xl font-semibold text-foreground">
        Incomplete assessments
      </h2>
      {failed ? (
        <Alert variant="destructive" action={<Button variant="outline" size="sm" onClick={onRetry}>Retry</Button>}>
          The assessment queue could not load.
        </Alert>
      ) : null}
      {queue ? (
        <>
          <ul>
            {queue.items.map((item) => (
              <ListItem
                key={`${item.projectId}:${item.repository}:${item.pullRequest}`}
                title={
                  <a href={`https://github.com/${item.repository}/pull/${item.pullRequest}`} aria-label={`${item.projectName}: ${item.repository} #${item.pullRequest}`} className="underline-offset-4 hover:underline">
                    {item.repository} #{item.pullRequest}
                  </a>
                }
                detail={<Progress item={item} />}
              />
            ))}
          </ul>
          {hasEarlier || next !== null ? (
            <nav aria-label="Incomplete assessment pages" className="flex gap-2">
              {hasEarlier ? (
                <Button variant="outline" size="sm" onClick={onEarlier}>
                  Back
                </Button>
              ) : null}
              {next !== null ? (
                <Button variant="outline" size="sm" onClick={() => onMore(next)}>
                  More
                </Button>
              ) : null}
            </nav>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

type PageProps = Omit<IncompleteAssessmentsProps, "queue" | "failed"> & { section: InboxRuntime; actor: string; cursor: string | null; asked: boolean };

function QueuePage({ section, actor, cursor, asked, ...controls }: PageProps) {
  const read = useMounted(section, () => assessmentPage(actor, cursor, asked));
  if (read.status === "running") return null;
  if (read.status === "failed") return <IncompleteAssessments failed {...controls} />;
  const shown = read.value;
  switch (shown.kind) {
    case "ready":
      return <IncompleteAssessments queue={shown.queue} {...controls} />;
    case "retry":
    case "refresh":
      return <IncompleteAssessments failed {...controls} />;
    case "suppressed":
      return null;
    default: {
      const _exhaustive: never = shown;
      return _exhaustive;
    }
  }
}

/** The assessment queue of `actor` from its first page, read page by page; a read that outlives its page or account shows nothing, and only a read the person asked for reloads the Inbox when refused. */
export function AssessmentQueue({ section, actor }: { section: InboxRuntime; actor: string }) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [earlier, setEarlier] = useState<ReadonlyArray<string | null>>([]);
  const [reads, setReads] = useState(0);
  return (
    <QueuePage
      key={reads}
      section={section}
      actor={actor}
      cursor={cursor}
      asked={reads > 0}
      hasEarlier={earlier.length > 0}
      onEarlier={() => {
        setCursor(earlier.at(-1) ?? null);
        setEarlier(earlier.slice(0, -1));
        setReads(reads + 1);
      }}
      onMore={(next) => {
        setEarlier([...earlier, cursor]);
        setCursor(next);
        setReads(reads + 1);
      }}
      onRetry={() => setReads(reads + 1)}
    />
  );
}
