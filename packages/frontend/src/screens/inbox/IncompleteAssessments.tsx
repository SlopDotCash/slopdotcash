// spec/slopbot/assessmentInbox.md, "Only a matching accepted final outcome at or after the gap resolves it"; spec/slopbot/assessmentInbox.md, "A read captures its actor, exact registry binding and response route"; spec/slopbot/assessmentInbox.md, "A departed page or changed actor cannot display a late queue response"; spec/slopbot/assessmentInbox.md, "Denial clears the item and uncertain authority is retryable"
import type { IncompleteAssessments as Queue } from "@repo/slopbot/client";
import { Alert, Button, ListItem, Status } from "@repo/ui";
import { Clock, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { formatDateTime } from "../../app/format.ts";
import { useMounted } from "../security/program/hooks.ts";
import { type InboxRuntime, assessmentPage } from "./runtime.vibe";

export type IncompleteAssessmentsProps = {
  /** The page shown, once read. */
  queue?: Queue;
  /** When the page was read, in milliseconds since the epoch; retry times are told relative to it. */
  now: number;
  /** The page could not be read. */
  failed?: boolean;
  /** An earlier page exists. */
  hasEarlier?: boolean;
  onEarlier: () => void;
  onMore: (next: string) => void;
  onRetry: () => void;
};

function untilRetry(retryAt: string, now: number): string {
  const minutes = Math.round((Date.parse(retryAt) - now) / 60_000);
  if (minutes <= 0) return "due";
  if (minutes < 60) return `in ${minutes}m`;
  if (minutes < 1440) return `in ${Math.round(minutes / 60)}h`;
  return `in ${Math.round(minutes / 1440)}d`;
}

function Progress({ item, now }: { item: Queue["items"][number]; now: number }) {
  if (item.running) {
    return (
      <span role="img" aria-label="Retrying" title="Retrying" className="inline-flex">
        <LoaderCircle aria-hidden className="size-3.5 motion-safe:animate-spin" />
      </span>
    );
  }
  if (item.retryAt) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span role="img" aria-label="Next retry" title="Next retry" className="inline-flex">
          <Clock aria-hidden className="size-3.5" />
        </span>
        <time dateTime={item.retryAt} title={formatDateTime(item.retryAt)}>
          {untilRetry(item.retryAt, now)}
        </time>
      </span>
    );
  }
  return <Status presentation={{ tone: "Neutral", icon: "Dot", label: "Queued" }} />;
}

/** Pull requests of the maintainer's projects whose assessment has not finished, with when each is tried again. */
export function IncompleteAssessments({ queue, now, failed = false, hasEarlier = false, onEarlier, onMore, onRetry }: IncompleteAssessmentsProps) {
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
                detail={<Progress item={item} now={now} />}
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

type Controls = Omit<IncompleteAssessmentsProps, "queue" | "failed" | "now">;

type DirectProps = Controls & { section: InboxRuntime; actor: string; cursor: string | null };

function DirectPage({ section, actor, cursor, ...controls }: DirectProps) {
  const read = useMounted(section, () => assessmentPage(actor, cursor));
  if (read.status === "running") return null;
  if (read.status === "failed") return <IncompleteAssessments failed now={0} {...controls} />;
  const shown = read.value;
  switch (shown.kind) {
    case "ready":
      return <IncompleteAssessments queue={shown.queue} now={shown.at} {...controls} />;
    case "retry":
    case "refresh":
      return <IncompleteAssessments failed now={0} {...controls} />;
    case "suppressed":
      return null;
    default: {
      const _exhaustive: never = shown;
      return _exhaustive;
    }
  }
}

export type AssessmentQueueProps = {
  section: InboxRuntime;
  actor: string;
  /** The first page as the Inbox read bundled it; `null` when the queue was unavailable to that read. */
  initial: Queue | null;
  /** When the Inbox read that bundled `initial`, in milliseconds since the epoch. */
  loadedAt: number;
};

/** The assessment queue of `actor`: the first page from the Inbox read, later pages and retries from the queue's own route; a read that outlives its page or account shows nothing and reloads the Inbox. */
export function AssessmentQueue({ section, actor, initial, loadedAt }: AssessmentQueueProps) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [earlier, setEarlier] = useState<ReadonlyArray<string | null>>([]);
  const [retries, setRetries] = useState(0);
  const [reads, setReads] = useState(0);
  const controls: Controls = {
    hasEarlier: earlier.length > 0,
    onEarlier: () => {
      setCursor(earlier.at(-1) ?? null);
      setEarlier(earlier.slice(0, -1));
      setReads(reads + 1);
    },
    onMore: (next) => {
      setEarlier([...earlier, cursor]);
      setCursor(next);
      setReads(reads + 1);
    },
    onRetry: () => {
      setRetries(retries + 1);
      setReads(reads + 1);
    },
  };
  if (retries === 0 && cursor === null) return <IncompleteAssessments queue={initial ?? undefined} failed={initial === null} now={loadedAt} {...controls} />;
  return <DirectPage key={reads} section={section} actor={actor} cursor={cursor} {...controls} />;
}
