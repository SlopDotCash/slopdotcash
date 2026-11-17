// spec/points/disputes.md, "Only the recipient of the current revision files, and a repeated filing returns the first"; spec/points/disputes.md, "Triage runs under an expiring lease, a saved draft is reused, and every outcome escalates"; spec/points/disputes.md, "Only a moderator other than the recipient reads and decides an escalated dispute, once, with a reason"; spec/frontend/navigation.md, "A private read belongs to the current account and navigation lifetime"
import { Alert, Button, Field, ListItem, Textarea } from "@repo/ui";
import { type FormEvent, useState } from "react";
import { formatDateTime } from "../../app/format.ts";
import { disputeStateLabel } from "../../flows/account/disputes.vibe";
import { run, useMounted } from "../security/program/hooks.ts";
import type { AwardList, Dispute } from "./fixtures.ts";
import { type InboxRuntime, answerReview, pointsReview, requestReview } from "./runtime.vibe";

export type DisputedAward = AwardList["awards"][number];

export type ReviewShown =
  | { readonly kind: "none" }
  | { readonly kind: "list"; readonly list: AwardList }
  | { readonly kind: "filing"; readonly item: DisputedAward }
  | { readonly kind: "detail"; readonly dispute: Dispute };

export type PointsDisputesProps = {
  shown: ReviewShown;
  /** While a read or a write is in flight. */
  busy?: boolean;
  error?: string;
  onRetry: () => void;
  onOlder: (before: string) => void;
  onReview: (item: DisputedAward) => void;
  onBack: () => void;
  onFile: (reason: string) => void;
  onDecide: (action: "uphold" | "deny", reason: string) => void;
  onRetryTriage: () => void;
};

const reasonLimit = 4000;

const points = (amount: number) => `${amount.toLocaleString()} points`;

function OriginalWork({ href }: { href: string }) {
  return (
    <a href={href} className="text-primary underline underline-offset-4">
      Original work
    </a>
  );
}

function FilingForm({ item, busy, onBack, onFile }: { item: DisputedAward; busy: boolean; onBack: () => void; onFile: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onFile(reason);
  };
  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <p>
        <strong>{points(item.award.amount)}</strong> · {item.award.projectId} · {formatDateTime(item.award.occurredAt)} · <OriginalWork href={item.award.sourceUrl} />
      </p>
      <Field label="Reason">
        <Textarea disabled={busy} value={reason} maxLength={reasonLimit} required onChange={(event) => setReason(event.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Button variant="outline" disabled={busy} onClick={onBack}>
          Back
        </Button>
        <Button type="submit" disabled={busy || !reason.trim()}>
          Request review
        </Button>
      </div>
    </form>
  );
}

function DecisionForm({ busy, onDecide }: { busy: boolean; onDecide: (action: "uphold" | "deny", reason: string) => void }) {
  const [decision, setDecision] = useState("");
  const blocked = busy || !decision.trim();
  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => event.preventDefault()}>
      <Field label="Decision reason">
        <Textarea disabled={busy} value={decision} maxLength={reasonLimit} required onChange={(event) => setDecision(event.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Button variant="outline" disabled={blocked} onClick={() => onDecide("uphold", decision)}>
          Uphold dispute
        </Button>
        <Button variant="outline" disabled={blocked} onClick={() => onDecide("deny", decision)}>
          Deny dispute
        </Button>
      </div>
    </form>
  );
}

function DisputeDetailView({ dispute, busy, onDecide, onRetryTriage }: { dispute: Dispute; busy: boolean } & Pick<PointsDisputesProps, "onDecide" | "onRetryTriage">) {
  const award = dispute.revision.award;
  return (
    <div className="flex flex-col gap-3">
      <p>
        <strong>{points(award.amount)}</strong> · @{award.actor.login} · {award.projectId} · {formatDateTime(award.occurredAt)} · <OriginalWork href={award.sourceUrl} />
      </p>
      <p>{dispute.reason}</p>
      <p role="status">{disputeStateLabel(dispute)}</p>
      {dispute.draft ? <p>Slopbot: {dispute.draft === "uphold" ? "Review the award" : "Keep the award"}</p> : null}
      {dispute.resolutionReason ? <p>{dispute.resolutionReason}</p> : null}
      {dispute.mayDecide ? <DecisionForm key={`${dispute.id}:${dispute.state}`} busy={busy} onDecide={onDecide} /> : null}
      <div className="flex gap-2">
        {!dispute.draft && dispute.state !== "resolved" ? (
          <Button variant="outline" disabled={busy} onClick={onRetryTriage}>
            Retry Slopbot review
          </Button>
        ) : null}
        <Button asChild variant="outline">
          <a href="/inbox?points">Points history</a>
        </Button>
      </div>
    </div>
  );
}

function AwardRows({ list, busy, onOlder, onReview }: { list: AwardList; busy: boolean } & Pick<PointsDisputesProps, "onOlder" | "onReview">) {
  const next = list.next;
  return (
    <>
      {list.awards.length === 0 ? (
        <p className="text-muted-foreground">No Points records.</p>
      ) : (
        <ul>
          {list.awards.map((item) => (
            <ListItem
              key={item.revisionId}
              title={
                <a href={item.award.sourceUrl} className="underline-offset-4 hover:underline">
                  {item.award.projectId} · {formatDateTime(item.award.occurredAt)}
                </a>
              }
              trailing={<strong>{points(item.award.amount)}</strong>}
              actions={
                item.disputeId ? (
                  <Button asChild size="sm" variant="ghost">
                    <a href={`/inbox?pointsDispute=${encodeURIComponent(item.disputeId)}`}>Open review</a>
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => onReview(item)}>
                    Review
                  </Button>
                )
              }
            />
          ))}
        </ul>
      )}
      {next !== null ? (
        <Button variant="outline" className="self-start" disabled={busy} onClick={() => onOlder(next)}>
          Older records
        </Button>
      ) : null}
    </>
  );
}

/** The recipient's Points records with their reviews: request one with a reason, follow it, and, as a moderator, decide it. */
export function PointsDisputes({ shown, busy = false, error, onRetry, onOlder, onReview, onBack, onFile, onDecide, onRetryTriage }: PointsDisputesProps) {
  return (
    <section aria-labelledby="points-review" className="flex flex-col gap-4">
      <h2 id="points-review" className="text-xl font-semibold text-foreground">
        Review Points
      </h2>
      {error ? (
        <Alert variant="destructive" action={<Button variant="outline" size="sm" onClick={onRetry}>Retry</Button>}>
          {error}
        </Alert>
      ) : null}
      {busy ? <p role="status">Loading…</p> : null}
      {shown.kind === "detail" ? (
        <DisputeDetailView dispute={shown.dispute} busy={busy} onDecide={onDecide} onRetryTriage={onRetryTriage} />
      ) : shown.kind === "filing" ? (
        <FilingForm key={shown.item.revisionId} item={shown.item} busy={busy} onBack={onBack} onFile={onFile} />
      ) : shown.kind === "list" ? (
        <AwardRows list={shown.list} busy={busy} onOlder={onOlder} onReview={onReview} />
      ) : null}
    </section>
  );
}

type Sent = ReturnType<typeof requestReview> | ReturnType<typeof answerReview>;

type Review = {
  section: InboxRuntime;
  actor: string;
  selected: string | null;
  before: string | null;
  filing: DisputedAward | null;
  withdrawn: boolean;
  busy: boolean;
  error: string | undefined;
} & Omit<PointsDisputesProps, "shown" | "busy" | "error">;

function ReviewRead({ section, actor, selected, before, filing, withdrawn, busy, error, ...controls }: Review) {
  const read = useMounted(section, () => pointsReview(actor, selected, before));
  const loading = read.status === "running";
  const failure = read.status === "failed" ? read.message : read.status === "done" && read.value.kind !== "done" ? read.value.message : undefined;
  const value = read.status === "done" && read.value.kind === "done" ? read.value.value : undefined;
  const shown: ReviewShown =
    withdrawn || failure !== undefined ? { kind: "none" }
    : filing !== null ? { kind: "filing", item: filing }
    : value === undefined ? { kind: "none" }
    : "awards" in value ? { kind: "list", list: value }
    : { kind: "detail", dispute: value };
  return <PointsDisputes shown={shown} busy={busy || loading} error={error ?? failure} {...controls} />;
}

function selectedDispute(): string | null {
  return new URLSearchParams(location.search).get("pointsDispute");
}

/** The Points review of `actor` inside the Inbox, opened by `?points` or `?pointsDispute=`. */
export function PointsReview({ section, actor }: { section: InboxRuntime; actor: string }) {
  const [selected, setSelected] = useState<string | null>(selectedDispute);
  const [before, setBefore] = useState<string | null>(null);
  const [filing, setFiling] = useState<DisputedAward | null>(null);
  const [reads, setReads] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [withdrawn, setWithdrawn] = useState(false);
  const reread = () => {
    setError(undefined);
    setWithdrawn(false);
    setReads((value) => value + 1);
  };
  const act = (work: Sent) => {
    setBusy(true);
    setError(undefined);
    void run(section, work).then((done) => {
      setBusy(false);
      if (!done.ok) return setError(done.message);
      const outcome = done.value;
      if (outcome.kind !== "done") {
        if (outcome.kind === "accountChanged" || outcome.accessRefused) {
          setFiling(null);
          setWithdrawn(true);
        }
        return setError(outcome.message);
      }
      setSelected(outcome.value.id);
      setFiling(null);
      const query = new URLSearchParams(location.search);
      query.delete("points");
      query.set("pointsDispute", outcome.value.id);
      history.replaceState(history.state, "", `${location.pathname}?${query}${location.hash}`);
      reread();
    });
  };
  return (
    <ReviewRead
      key={`${selected ?? ""}:${before ?? ""}:${reads}`}
      section={section}
      actor={actor}
      selected={selected}
      before={before}
      filing={filing}
      withdrawn={withdrawn}
      busy={busy}
      error={error}
      onRetry={reread}
      onOlder={setBefore}
      onReview={setFiling}
      onBack={() => setFiling(null)}
      onFile={(reason) => filing !== null && act(requestReview(actor, filing.revisionId, reason))}
      onDecide={(action, reason) => selected !== null && act(answerReview(actor, selected, { action, reason }))}
      onRetryTriage={() => selected !== null && act(answerReview(actor, selected, { action: "retry" }))}
    />
  );
}
