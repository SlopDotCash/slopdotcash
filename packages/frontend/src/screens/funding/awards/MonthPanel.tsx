// spec/settlement/monthly.md, "Only a current owner, steward or repository administrator changes another recipient's amount"; spec/settlement/monthly.md, "The owner may finalize early; the coordinator freezes at the cutoff unless the default is off"; spec/frontend/ownerMonthly.md, "Only a current manager edits, and the editor closes at the cutoff"; spec/frontend/ownerMonthly.md, "A cut needs a 20 to 500 character public reason, and a save names the sequence it read"; spec/frontend/projections.md, "Award, funding and settlement status are independent facts"; spec/settlement/reserveRelease.md, "Finalized release returns the whole untouched reserve"
import { ordinaryFeeBase } from "@repo/settlement/kernels/fees";
import type { MonthlyAllocation, MonthlyOwnerView, MonthlyRun } from "@repo/settlement/client";
import { Button, Field, Input, Label, ListItem, Metric, MetricGrid, Status, Switch, Textarea } from "@repo/ui";
import { ArrowRight, Check } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { canEditDraft, canFinalize, canReview, canSave, cutsOpen, editDraft, editorOpen, type OwnerMonthly } from "../../../../gen/frontend__ownerMonthly.ts";
import { cutNoticeSeconds, cutReasonMax, cutReasonMin } from "../../../../gen/settlement__monthly.ts";
import { formatDateTime } from "../../../app/format.ts";
import { deploymentOf } from "../../../wallets/owner/commitmentCalls.ts";
import { formatDate } from "../../projects/summary.ts";
import { AwardAmounts } from "./AwardAmounts.tsx";
import { amountText, awardPresentation, editableUnits, isCut, isoOf, parsedGross, secondsOf, sumOf } from "./month.ts";

export type AllocationChangeRequest = {
  readonly githubUserId: string;
  readonly grossBase: string;
  readonly cut: boolean;
  readonly reason: string;
};

export type MonthPanelProps = {
  /** The month as the server returned it to this viewer. */
  view: MonthlyOwnerView;
  /** The owner page's state: who may edit, the clock and the month's windows. */
  state: OwnerMonthly;
  /** An owner request is running. */
  busy?: boolean;
  /** The project's page where the vault's own monthly authorization is reviewed, when the month's vault is registered. */
  manageHref?: string;
  /** No vault of the project pays on its network. */
  paymentsDisabled?: boolean;
  /** The recipient whose allocation the last owner action saved. */
  savedActor?: string;
  /** Saves one recipient's gross; resolves true once the server accepted it. */
  onSave: (change: AllocationChangeRequest) => Promise<boolean>;
  /** Freezes the month's saved allocations. */
  onFinalize: () => void;
  /** Turns the project's automatic finalization default on or off. */
  onAutomaticChange: (automatic: boolean) => void;
  /** Opens the commitment review for one approved award. */
  onReserve: (githubUserId: string) => void;
  /** The commitment in progress, shown under the final awards. */
  commitment?: ReactNode;
  /** The wrong-total reserve repair of the month's vault, shown last. */
  release?: ReactNode;
};

type Draft = { readonly value: string; readonly base: string; readonly reason: string };

function Time({ seconds }: { seconds: number }) {
  const iso = isoOf(seconds);
  return <time dateTime={iso}>{formatDateTime(iso)}</time>;
}

function Finalization({ view, state, busy, onAutomaticChange }: Pick<MonthPanelProps, "view" | "state" | "busy" | "onAutomaticChange">) {
  const id = useId();
  const cutoff = secondsOf(view.cutoffAt);
  const manages = view.canManage;
  const timing =
    view.run !== null ? (
      <Status presentation={{ tone: "Positive", icon: "Lock", label: "Final" }} />
    ) : !view.automatic ? null : cutoff > 0 && state.now >= cutoff ? (
      <Status presentation={{ tone: "Neutral", icon: "Spinner", label: "Finalizing" }} />
    ) : cutoff > 0 ? (
      <span className="text-sm text-muted-foreground">
        Finalizes <Time seconds={cutoff} />
      </span>
    ) : null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      {manages ? (
        <>
          <Switch id={id} checked={view.automatic} loading={busy} onCheckedChange={onAutomaticChange} />
          <Label htmlFor={id}>Auto-finalize</Label>
        </>
      ) : (
        <>
          <span className="text-sm font-medium text-foreground">Auto-finalize</span>
          <Status presentation={view.automatic ? { tone: "Positive", icon: "Check", label: "On" } : { tone: "Neutral", icon: "Dot", label: "Off" }} />
        </>
      )}
      {timing}
      {manages ? null : <Status role="status" presentation={{ tone: "Neutral", icon: "Eye", label: "View only" }} />}
    </div>
  );
}

function AllocationEditor({
  row,
  view,
  state,
  draft,
  busy,
  saved,
  onDraft,
  onSave,
}: {
  row: MonthlyAllocation;
  view: MonthlyOwnerView;
  state: OwnerMonthly;
  draft: Draft | undefined;
  busy: boolean;
  saved: boolean;
  onDraft: (draft: Draft | undefined) => void;
  onSave: MonthPanelProps["onSave"];
}) {
  const decimals = view.asset?.assetDecimals ?? null;
  const value = draft?.value ?? editableUnits(row.grossBase, decimals);
  const parsed = parsedGross(value, decimals);
  const cut = draft !== undefined && isCut(parsed, row.proposedGrossBase);
  const reason = draft?.reason ?? "";
  const reasonLength = cut ? reason.trim().length : 0;
  const open = editorOpen(state);
  const allowed = canEditDraft(state, cut, reasonLength, state.owner) && canSave(editDraft(state, cut, reasonLength, state.owner), state.owner);
  const save = () => {
    if (parsed.kind !== "Parsed") return;
    void onSave({ githubUserId: row.githubUserId, grossBase: parsed.base, cut, reason }).then((saved) => {
      if (saved) onDraft(undefined);
    });
  };
  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <Field
          label={
            <>
              {draft === undefined ? null : <span aria-hidden="true" title="Unsaved" className="inline-block size-2 rounded-full bg-warn" />}
              <span className="sr-only">
                Award for {row.login}
                {decimals === null ? " (base units)" : ""}
                {draft === undefined ? "" : " (unsaved)"}
              </span>
            </>
          }
          error={draft !== undefined && parsed.kind === "Refused" ? parsed.message : undefined}
          className="min-w-0 flex-1"
        >
          <Input inputMode="decimal" spellCheck={false} autoComplete="off" disabled={busy || !open} value={value} onChange={(event) => onDraft({ value: event.target.value, base: row.grossBase, reason })} />
        </Field>
        <Button variant="secondary" aria-label={saved && draft === undefined ? `Saved ${row.login}` : `Save ${row.login}`} disabled={draft === undefined || parsed.kind !== "Parsed" || !allowed} loading={busy} onClick={save}>
          {saved && draft === undefined ? (
            <>
              <Check aria-hidden="true" className="size-4" /> Saved
            </>
          ) : (
            "Save"
          )}
        </Button>
        <span role="status" className="sr-only">
          {saved ? "Saved" : ""}
        </span>
      </div>
      {cut && draft !== undefined ? (
        <Field
          label="Reason (shown publicly and sent to the contributor)"
          hint={
            open && !cutsOpen(state)
              ? "Cuts closed 24 hours before the cutoff. The contributor gets 24 hours of notice before a cut takes effect."
              : `This is below the proposed amount. Write ${cutReasonMin} to ${cutReasonMax} characters. The month cannot lock until 24 hours after you save.`
          }
        >
          <Textarea required rows={2} minLength={cutReasonMin} maxLength={cutReasonMax} disabled={busy || !open} value={reason} onChange={(event) => onDraft({ ...draft, reason: event.target.value })} />
        </Field>
      ) : null}
    </div>
  );
}

function Proposal({ view, state, busy = false, savedActor, onSave, onFinalize }: Pick<MonthPanelProps, "view" | "state" | "busy" | "savedActor" | "onSave" | "onFinalize">) {
  const [drafts, setDrafts] = useState<Readonly<Record<string, Draft>>>({});
  const proposal = view.proposal;
  if (proposal === null) return <p className="text-sm text-muted-foreground">No proposal yet</p>;
  const amount = amountText(view.asset);
  const finalizeFrom = proposal.latestCutAt === null ? 0 : secondsOf(proposal.latestCutAt) + cutNoticeSeconds;
  const draftOf = (row: MonthlyAllocation) => {
    const draft = drafts[row.githubUserId];
    return draft !== undefined && draft.base === row.grossBase ? draft : undefined;
  };
  const setDraft = (githubUserId: string) => (draft: Draft | undefined) =>
    setDrafts((current) => {
      const rest = Object.fromEntries(Object.entries(current).filter(([key]) => key !== githubUserId));
      return draft === undefined ? rest : { ...rest, [githubUserId]: draft };
    });
  return (
    <>
      {proposal.earlyCloseAt === undefined ? null : (
        <p className="text-sm text-muted-foreground">
          Contributions before <time dateTime={proposal.earlyCloseAt}>{formatDateTime(proposal.earlyCloseAt)}</time>.
        </p>
      )}
      <MetricGrid>
        <Metric label="Allocated" value={amount(sumOf(proposal.allocations.map((row) => row.grossBase)))} tone="Notice" />
        <Metric label={proposal.earlyCloseAt === undefined ? "Monthly cap" : "Prorated cap"} value={amount(proposal.capBase)} />
      </MetricGrid>
      {proposal.allocations.length === 0 ? (
        <p className="text-sm text-muted-foreground">No allocations</p>
      ) : (
        <ul aria-label="Allocations" className="flex flex-col divide-y divide-border">
          {proposal.allocations.map((row) => {
            const fee = ordinaryFeeBase(BigInt(row.grossBase));
            return (
              <ListItem
                key={row.githubUserId}
                title={row.login}
                detail={`Proposed ${amount(row.proposedGrossBase)}`}
                trailing={<AwardAmounts gross={amount(row.grossBase)} net={amount((BigInt(row.grossBase) - fee).toString())} fee={amount(fee.toString())} />}
                actions={
                  state.manages && !state.month.fixed ? (
                    <AllocationEditor row={row} view={view} state={state} draft={draftOf(row)} busy={busy} saved={savedActor === row.githubUserId} onDraft={setDraft(row.githubUserId)} onSave={onSave} />
                  ) : undefined
                }
              />
            );
          })}
        </ul>
      )}
      {state.manages && finalizeFrom > state.now ? (
        <p role="status" className="text-sm text-muted-foreground">
          A contributor gets 24 hours of notice after a cut. You can finalize from <Time seconds={finalizeFrom} />.
        </p>
      ) : null}
      {state.manages ? (
        <Button className="self-start" disabled={!canFinalize(state, state.owner)} loading={busy} onClick={onFinalize}>
          Finalize awards
        </Button>
      ) : null}
    </>
  );
}

function FinalAwards({ view, run, state, busy = false, onReserve, commitment }: Pick<MonthPanelProps, "view" | "state" | "busy" | "onReserve" | "commitment"> & { run: MonthlyRun }) {
  const amount = amountText(view.asset);
  const reservable =
    deploymentOf(view.deployment)?.network === run.network && state.manages && state.owner > 0 && (canReview(state, "Commitment", state.owner) || state.commitment.phase === "Reviewed");
  const by = run.trigger === "automatic" ? "auto" : view.canManage ? "you" : "owner";
  return (
    <>
      <p role="status" className="flex flex-wrap items-center gap-3">
        <Status presentation={{ tone: "Positive", icon: "Lock", label: `Final · ${by} · ${formatDate(isoOf(secondsOf(run.frozenAt)))}` }} />
        {run.funded ? null : <Status presentation={{ tone: "Negative", icon: "Alert", label: "Underfunded" }} />}
      </p>
      {run.awards.length === 0 ? (
        <p className="text-sm text-muted-foreground">No awards</p>
      ) : (
        <ul aria-label="Final awards" className="flex flex-col divide-y divide-border">
          {run.awards.map((award) => (
            <ListItem
              key={award.githubUserId}
              title={award.login}
              detail={<AwardAmounts gross={amount(award.grossBase)} net={amount(award.netBase)} fee={amount(award.feeBase)} />}
              trailing={<Status presentation={awardPresentation(award.state)} />}
              actions={
                reservable && award.state === "awaiting-reservation" ? (
                  <Button variant="secondary" aria-label={`Reserve award for ${award.login}`} disabled={busy} onClick={() => onReserve(award.githubUserId)}>
                    Reserve
                  </Button>
                ) : undefined
              }
            />
          ))}
        </ul>
      )}
      {commitment}
    </>
  );
}

/** One month of a project's awards for its owner: the finalization default, the editable allocations before the freeze, and the frozen awards with their reservation. */
export function MonthPanel({ view, state, busy = false, manageHref, paymentsDisabled = false, savedActor, onSave, onFinalize, onAutomaticChange, onReserve, commitment, release }: MonthPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Monthly payment settings" className="flex flex-col gap-2">
        <Finalization view={view} state={state} busy={busy} onAutomaticChange={onAutomaticChange} />
        {manageHref ? (
          <a href={manageHref} className="inline-flex items-center gap-1 self-start text-sm text-primary underline-offset-4 hover:underline">
            Auto-pay settings <ArrowRight aria-hidden="true" className="size-3.5" />
          </a>
        ) : null}
      </section>
      {paymentsDisabled ? (
        <p role="status">
          <Status presentation={{ tone: "Neutral", icon: "Pause", label: "Payments off" }} />
        </p>
      ) : null}
      {view.run === null ? (
        <Proposal view={view} state={state} busy={busy} savedActor={savedActor} onSave={onSave} onFinalize={onFinalize} />
      ) : (
        <FinalAwards view={view} run={view.run} state={state} busy={busy} onReserve={onReserve} commitment={commitment} />
      )}
      {release}
    </div>
  );
}
