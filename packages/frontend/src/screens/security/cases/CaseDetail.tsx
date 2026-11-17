// spec/security/privacy.md, "Read authorization comes from the current case roles and is audited before delivery"; spec/frontend/reportDetails.md, "An individual mount or close changes only its own submission"; spec/frontend/navigation.md, "A private read belongs to the current account and navigation lifetime"; spec/security/cases.md, "An award commits only under paid terms, eligibility and project clearance"; spec/security/cases.md, "An independent moderator upholds or returns the appeal"
import { Alert, Button, CopyButton, Disclosure, ExternalLink, Status } from "@repo/ui";
import { ArrowRight } from "lucide-react";
import { type ReactNode, useState } from "react";
import { formatDateTime } from "../../../app/format.ts";
import { useView } from "../../account/useView.ts";
import { run, useMounted } from "../program/hooks.ts";
import type { Sent } from "./ActionForm.tsx";
import { actionSpec } from "./actionSpec.ts";
import { AnalysisPanel } from "./AnalysisPanel.tsx";
import { AppealTriage } from "./AppealTriage.tsx";
import type { SecurityCase } from "./case.schema.ts";
import { CaseActions } from "./CaseActions.tsx";
import {
  awardText,
  canPay,
  caseTitle,
  eventLabel,
  money,
  ownerResponse,
  paymentLabel,
  receiptLabels,
  receivedAtSourceLabels,
  recoveryMessage,
  relatedPartyLabels,
  submissionLabels,
} from "./labels.ts";
import { Fact } from "./parts.tsx";
import { type CasesRuntime, actOnCase, caseChanged, openCase, reloadCase, watchCase } from "./runtime.vibe";

export type Retried = "analyze" | "triage-appeal";

/** The payment controls of a case with a settlement: the wallet prompts and their checks, which reload the case when done. */
export type PaymentSlot = (record: SecurityCase, changed: () => void) => ReactNode;

export type CaseDetailViewProps = {
  record: SecurityCase;
  /** What the last action saved. */
  note: string | null;
  /** Why the last refresh failed while this case stays shown. */
  refreshError: string | null;
  onReload: () => void;
  retrying: Retried | null;
  retryError: string | null;
  onRetry: (action: Retried) => void;
  onSend: (action: string, fields: Readonly<Record<string, unknown>>, key: string | null) => Promise<Sent>;
  payment?: ReactNode;
};

function utc(value: string): string {
  return formatDateTime(value);
}

function Receipt({ record }: { record: SecurityCase }) {
  const source = record.receivedAtSource === "maintainer-attested" ? receivedAtSourceLabels["maintainer-attested"] : "";
  return (
    <>
      <Status
        presentation={
          record.submissionState === "verified"
            ? { tone: "Positive", icon: "Check", label: record.receivedAtSource === "slop-received" ? "Received by Slop" : (submissionLabels.verified ?? "") }
            : { tone: "Caution", icon: "Clock", label: record.receivedAtSource === "slop-received" ? "Received by Slop" : (submissionLabels[record.submissionState] ?? record.submissionState) }
        }
      />
      {record.receivedAt ? ` ${utc(record.receivedAt)}${source}` : ""}
      {record.advisory ? (
        <>
          {" · "}
          <ExternalLink href={record.advisory.url} className="text-primary underline underline-offset-4">
            GitHub advisory
          </ExternalLink>
        </>
      ) : null}
    </>
  );
}

function PaymentFacts({ record, controls }: { record: SecurityCase; controls?: ReactNode }) {
  const settlement = record.settlement;
  if (settlement === null) return null;
  const reporter = record.viewerRoles.includes("reporter");
  const finalized = settlement.transactionIds ?? (settlement.transactionId ? [settlement.transactionId] : []);
  return (
    <section aria-labelledby={`payment-${record.id}`} className="flex flex-col gap-3">
      <h4 id={`payment-${record.id}`} className="font-semibold text-foreground">
        Payment
      </h4>
      {settlement.privacyNotice ? <p className="text-sm text-muted-foreground">{settlement.privacyNotice}</p> : null}
      {reporter && settlement.state !== "paid" ? (
        <p>
          <a href="/account#wallets" className="text-primary underline underline-offset-4 hover:decoration-2">
            Review your payout wallet
          </a>
        </p>
      ) : null}
      <dl className="flex flex-col gap-2">
        <Fact term="Network">{settlement.network}</Fact>
        {record.paymentRail === "direct" && settlement.remainingTransfers ? (
          <Fact term="Progress">
            {settlement.confirmedTransactionIds?.length ?? 0} transaction(s) confirmed · {settlement.remainingTransfers.length} transfer(s) remaining
          </Fact>
        ) : null}
        {finalized.map((transactionId) => (
          <Fact term="Finalized transaction" key={transactionId}>
            <span className="inline-flex items-center gap-2">
              <code className="break-all">{transactionId}</code>
              <CopyButton text={transactionId} label="Copy payment transaction ID" />
            </span>
          </Fact>
        ))}
      </dl>
      {settlement.recovery ? (
        <fieldset aria-label="Payment recovery" className="flex flex-col gap-3 rounded-md border border-border p-4">
          <legend className="px-1 text-sm font-medium text-foreground">Payment recovery</legend>
          {settlement.recovery.target ? (
            <span className="inline-flex items-center gap-2">
              <code className="break-all">{settlement.recovery.target.address}</code>
              <CopyButton text={settlement.recovery.target.address} label={settlement.recovery.role === "fee" ? "Copy fee wallet" : "Copy current payout wallet"} />
            </span>
          ) : null}
          <p role="status">{recoveryMessage(settlement.recovery.mode, canPay(record), reporter)}</p>
          {settlement.recovery.mode === "wallet-required" ? (
            <a href="/account#wallets" className="text-primary underline underline-offset-4 hover:decoration-2">
              Review payout wallet
            </a>
          ) : null}
        </fieldset>
      ) : null}
      {controls}
    </section>
  );
}

function History({ record }: { record: SecurityCase }) {
  const owner = record.view === "restricted";
  const events = record.events ?? [];
  return (
    <Disclosure summary="Case details and history">
      <dl className="flex flex-col gap-2">
        <Fact term="Case">
          <span className="inline-flex items-center gap-2">
            <code className="break-all">{record.id}</code>
            <CopyButton text={record.id} label="Copy case ID" />
          </span>
        </Fact>
        <Fact term="Program terms at receipt">
          {record.terms && record.terms.grossMinor !== undefined
            ? `${money(record.terms.grossMinor, record.terms)} published gross per finding (policy revision ${record.policyRevision ?? "—"})`
            : `No paid program was open (policy revision ${record.policyRevision ?? "—"})`}
        </Fact>
        {record.receiptState ? (
          <>
            <Fact term="Severity">{record.severity ?? "—"}</Fact>
            <Fact term="Loss of funds">{record.lossFinding ?? "—"}</Fact>
            <Fact term="Remediation">{record.remediationState}</Fact>
            <Fact term="Disclosure">{record.disclosureState}</Fact>
            <Fact term="Recognition">{record.recognition}</Fact>
            <Fact term="Appeal">{record.appealState}</Fact>
          </>
        ) : null}
        {record.reporter ? <Fact term="Reporter">@{record.reporter.githubLogin}</Fact> : null}
        {record.payee ? <Fact term="Payee">@{record.payee.githubLogin}</Fact> : null}
        {owner ? (
          <>
            <Fact term="Root cause">{record.rootCauseKey ?? "—"}</Fact>
            <Fact term="Duplicate of">{record.duplicateOf ?? "—"}</Fact>
            <Fact term="Triagers">
              {(record.triagers ?? [])
                .filter((entry) => entry.revokedAt === null)
                .map((entry) => `@${entry.githubLogin}`)
                .join(", ") || "None"}
            </Fact>
          </>
        ) : null}
      </dl>
      {events.length > 0 ? (
        <ol className="mt-3 flex flex-col gap-1">
          {events.map((event) => (
            <li key={event.revision}>
              {utc(event.at)} · {eventLabel(record, event.kind)}
              {event.reason ? ` — ${event.reason}` : ""}
              {event.evidenceReference ? ` (evidence: ${event.evidenceReference})` : ""}
              {event.kind === "disclosure" && event.detail?.redactedContentDigest ? ` (approved content SHA-256: ${event.detail.redactedContentDigest})` : ""}
              {event.kind === "disclosure" && event.detail?.embargoChange ? ` (embargo change: ${event.detail.embargoChange})` : ""}
            </li>
          ))}
        </ol>
      ) : null}
    </Disclosure>
  );
}

/** One private case as its current roles may read it: next step, receipt, award, payout, analysis, actions and history. */
export function CaseDetailView({ record, note, refreshError, onReload, retrying, retryError, onRetry, onSend, payment }: CaseDetailViewProps) {
  const owner = record.view === "restricted";
  const response = ownerResponse(record);
  const headingId = `case-${record.id}`;
  return (
    <article aria-labelledby={headingId} className="flex flex-col gap-6 rounded-lg border border-border bg-card p-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} className="text-lg font-semibold text-foreground">
          {caseTitle(record)} · {record.projectId}
        </h3>
        <Status presentation={{ tone: "Neutral", icon: "Lock", label: "Private case" }} />
      </header>
      {note ? <p role="status">{note}</p> : null}
      {refreshError ? (
        <Alert
          variant="destructive"
          action={
            <Button variant="link" onClick={onReload}>
              Retry
            </Button>
          }
        >
          {refreshError} Showing the last loaded case.
        </Alert>
      ) : null}
      <p className="flex items-start gap-2">
        <ArrowRight aria-hidden className="mt-1 size-4 shrink-0" />
        <span>
          <strong>Next step:</strong> {record.nextStep}
          {record.nextStepDueAt ? <span> Due {utc(record.nextStepDueAt)}.</span> : null}
        </span>
      </p>
      <dl className="flex flex-col gap-2">
        <Fact term="Receipt">
          <Receipt record={record} />
        </Fact>
        {record.receiptState ? (
          <Fact term="Owner response">
            {receiptLabels[record.receiptState] ?? record.receiptState}
            {response ? ` — “${response}”` : ""}
          </Fact>
        ) : null}
        <Fact term="Award">{awardText(record)}</Fact>
        {record.relatedParty === "related" && record.relatedPartyReview !== "not-applicable" ? (
          <Fact term="Related party">{relatedPartyLabels[record.relatedPartyReview] ?? record.relatedPartyReview}</Fact>
        ) : null}
        <Fact term="Payout">
          <Status presentation={{ tone: record.paymentState === "paid" ? "Positive" : "Neutral", icon: record.paymentState === "paid" ? "Check" : "Clock", label: paymentLabel(record) }} />
          {record.paymentDeadline ? ` · deadline ${utc(record.paymentDeadline)}` : ""}
        </Fact>
      </dl>
      {record.award && record.terms ? (
        <section aria-label="Award and payment" className="flex flex-col gap-3">
          <h4 className="font-semibold text-foreground">Award and payment</h4>
          <dl className="flex flex-col gap-2">
            <Fact term="Researcher receives">{money(record.award.researcherMinor, record.terms)}</Fact>
            <Fact term="Total award">{money(record.award.grossMinor, record.terms)}</Fact>
            <Fact term="Slop share">{money(record.award.slopMinor, record.terms)}</Fact>
            <Fact term="Payment status">{paymentLabel(record)}</Fact>
          </dl>
          <p>Approval and funding are separate from finalized payment.</p>
        </section>
      ) : null}
      {owner ? <AnalysisPanel record={record} busy={retrying === "analyze"} error={retrying === null ? retryError : null} onRetry={() => onRetry("analyze")} /> : null}
      {owner && record.appealState === "open" ? <AppealTriage record={record} busy={retrying === "triage-appeal"} error={retrying === null ? retryError : null} onRetry={() => onRetry("triage-appeal")} /> : null}
      <PaymentFacts record={record} controls={payment} />
      <CaseActions record={record} onSend={onSend} />
      <History record={record} />
    </article>
  );
}

export type CaseDetailProps = {
  runtime: CasesRuntime;
  /** The signed-in viewer's GitHub user ID. */
  owner: string;
  caseId: string;
  payment?: PaymentSlot;
};

/** The selected case, read with the viewer's current case roles and mounted only in this account's navigation lifetime. */
export function CaseDetail({ runtime, owner, caseId, payment }: CaseDetailProps) {
  useMounted(runtime, () => openCase(owner, caseId));
  const shown = useView(runtime, watchCase);
  const [note, setNote] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<Retried | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const reload = () => void run(runtime, reloadCase(owner));
  const changed = (record: SecurityCase | null) => void run(runtime, caseChanged(owner, record));
  if (shown === undefined || shown.owner !== owner || shown.caseId !== caseId || shown.loaded.status === "loading")
    return (
      <p aria-live="polite" className="text-muted-foreground">
        Loading case…
      </p>
    );
  const loaded = shown.loaded;
  if (loaded.status === "signedOut") return <Alert variant="destructive">Your session ended. Sign in again.</Alert>;
  if (loaded.status !== "ready")
    return (
      <Alert
        variant="destructive"
        action={
          <Button variant="link" onClick={reload}>
            Retry
          </Button>
        }
      >
        {loaded.message}
      </Alert>
    );
  const record = loaded.value;
  const send = async (action: string, fields: Readonly<Record<string, unknown>>, key: string | null): Promise<Sent> => {
    const done = await run(runtime, actOnCase(owner, record, action, fields, key));
    if (!done.ok) return { key, error: done.message };
    if (done.value.kind === "refused") return { key: done.value.key, error: done.value.message };
    setNote(`${actionSpec(action, record)?.title ?? action}: saved.`);
    changed(done.value.record);
    return { key: done.value.key, error: null };
  };
  const retry = (action: Retried) => {
    setRetrying(action);
    setRetryError(null);
    void run(runtime, actOnCase(owner, record, action, {}, null)).then((done) => {
      setRetrying(null);
      if (!done.ok) return setRetryError(done.message);
      if (done.value.kind === "refused") return setRetryError(done.value.message);
      changed(null);
    });
  };
  return (
    <CaseDetailView
      record={record}
      note={note}
      refreshError={loaded.refreshError}
      onReload={reload}
      retrying={retrying}
      retryError={retryError}
      onRetry={retry}
      onSend={send}
      payment={payment?.(record, () => changed(null))}
    />
  );
}

