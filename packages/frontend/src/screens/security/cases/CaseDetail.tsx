// spec/security/privacy.md, "Read authorization comes from the current case roles and is audited before delivery"; spec/frontend/reportDetails.md, "An individual mount or close changes only its own submission"; spec/frontend/reportDetails.md, "Private report IDs scope both heading references"; spec/frontend/navigation.md, "A private read belongs to the current account and navigation lifetime"; spec/security/cases.md, "An award commits only under paid terms, eligibility and project clearance"; spec/security/cases.md, "An independent moderator upholds or returns the appeal"
import { Alert, Button, CopyButton, Disclosure, ExternalLink, Metric, MetricGrid, Progress, Spinner, Status } from "@repo/ui";
import { ArrowRight, Check, GitBranch, LockKeyhole, ShieldCheck, UserRound, Wallet } from "lucide-react";
import { type ReactNode, useState } from "react";
import { formatDateTime } from "../../../app/format.ts";
import { useView } from "../../account/useView.ts";
import { run, useMounted } from "../program/hooks.ts";
import type { Sent } from "./ActionForm.tsx";
import { AnalysisPanel } from "./AnalysisPanel.tsx";
import { AppealTriage } from "./AppealTriage.tsx";
import type { SecurityCase } from "./case.schema.ts";
import { CaseActions } from "./CaseActions.tsx";
import {
  type Actor,
  type Presentation,
  awardPending,
  awardText,
  badge,
  canPay,
  caseTitle,
  eventActor,
  eventLabel,
  money,
  ownerResponse,
  payoutPresentation,
  receiptPresentation,
  recoveryStep,
  relatedPartyPresentation,
  severityPresentation,
  submissionPresentation,
} from "./labels.ts";
import { Fact, StaleNotice } from "./parts.tsx";
import { type CasesRuntime, actOnCase, caseChanged, openCase, reloadCase, watchCase } from "./runtime.vibe";

export type Retried = "analyze" | "triage-appeal";

/** The payment slot's hold on its last outcome: kept for the case across its reloads, cleared when another payment action starts. */
export interface PaymentHold {
  /** Reads the case again after a payment action changed it. */
  readonly changed: () => void;
  readonly notice: Presentation | null;
  readonly hold: (notice: Presentation | null) => void;
}

/** The payment controls of a case with a settlement: the wallet prompts and their checks, which reload the case when done. */
export type PaymentSlot = (record: SecurityCase, hold: PaymentHold) => ReactNode;

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
  /** Called when a payment action of the case itself starts, so the payment slot's notice is cleared. */
  onPaymentStart?: () => void;
  payment?: ReactNode;
};

type Send = CaseDetailViewProps["onSend"];

const actorIcons = { Reporter: UserRound, GitHub: GitBranch, "Program team": ShieldCheck } as const satisfies Record<Actor, unknown>;

function utc(value: string): string {
  return formatDateTime(value);
}

function TimeChip({ at, name }: { at: string; name: string }) {
  return (
    <span className="inline-flex items-center">
      <span className="sr-only">{name} </span>
      <Status title={name} presentation={badge(utc(at), "Neutral", "Clock")} />
    </span>
  );
}

function EventActor({ kind }: { kind: string }) {
  const actor = eventActor(kind);
  const Icon = actorIcons[actor];
  return (
    <span role="img" aria-label={actor} title={actor} className="inline-flex text-muted-foreground">
      <Icon aria-hidden className="size-3.5" />
    </span>
  );
}

function CopyIdentifier({ value, label }: { value: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <code className="break-all">{value}</code>
      <CopyButton text={value} label={`Copy ${label}`} />
    </span>
  );
}

function WalletLink() {
  return (
    <a href="/account#wallets" className="inline-flex items-center gap-1 text-primary underline underline-offset-4 hover:decoration-2">
      <Wallet aria-hidden className="size-3.5" /> Wallet
    </a>
  );
}

const advisoryStateLabels: Readonly<Record<string, string>> = {
  triage: "Open, in triage",
  draft: "Open, draft",
  published: "Published",
  closed: "Closed",
};

const closingReceipts = new Set(["duplicate", "out-of-scope", "rejected"]);

function Receipt({ record }: { record: SecurityCase }) {
  const advisoryState = record.advisory?.githubState ? advisoryStateLabels[record.advisory.githubState] : undefined;
  const closeOnGithub =
    record.advisory !== null &&
    record.advisory !== undefined &&
    (record.advisory.githubState === "triage" || record.advisory.githubState === "draft") &&
    closingReceipts.has(record.receiptState ?? "") &&
    record.viewerRoles.some((role) => role === "owner" || role === "triager" || role === "maintainer");
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Status presentation={submissionPresentation(record)} />
      {record.receivedAt ? utc(record.receivedAt) : null}
      {record.receivedAt && record.receivedAtSource === "maintainer-attested" ? (
        <span role="img" aria-label="Maintainer-attested" title="Maintainer-attested" className="inline-flex">
          <UserRound aria-hidden className="size-3.5" />
        </span>
      ) : null}
      {record.advisory ? (
        <>
          <ExternalLink href={record.advisory.url} label="GitHub advisory" className="inline-flex text-primary">
            <GitBranch aria-hidden className="size-4" />
          </ExternalLink>
          {advisoryState ? <span className="text-xs text-muted-foreground">GitHub: {advisoryState}</span> : null}
          {closeOnGithub ? (
            <ExternalLink href={record.advisory.url} className="text-xs text-primary underline underline-offset-4">
              Close on GitHub
            </ExternalLink>
          ) : null}
        </>
      ) : null}
    </span>
  );
}

function VerifyFoundPayment({ transactionIds, onSend, onStart }: { transactionIds: ReadonlyArray<string>; onSend: Send; onStart?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<Sent>({ key: null, error: null });
  const verify = () => {
    if (busy) return;
    onStart?.();
    setBusy(true);
    void onSend("verify-payment", { confirmation: true, transactionIds }, sent.key).then((answer) => {
      setBusy(false);
      setSent(answer);
    });
  };
  return (
    <>
      <Button variant="secondary" className="self-start" loading={busy} onClick={verify}>
        Verify
      </Button>
      {sent.error ? <Alert variant="destructive">{sent.error}</Alert> : null}
    </>
  );
}

function RecoveryStatus({ mode, payer, reporter }: { mode: string; payer: boolean; reporter: boolean }) {
  const [party, step] = recoveryStep(mode);
  const mine = (party === "Payer" && payer) || (party === "Reporter" && reporter);
  return (
    <p role="status" className="flex flex-wrap items-center gap-2">
      {party && !mine ? (
        <span className="inline-flex items-center">
          <span className="sr-only">Waiting on </span>
          <Status title={`Waiting on ${party}`} presentation={badge(party, "Neutral", "Clock")} />
        </span>
      ) : null}
      {step}
    </p>
  );
}

function PaymentFacts({ record, controls, onSend, onStart }: { record: SecurityCase; controls?: ReactNode; onSend: Send; onStart?: () => void }) {
  const settlement = record.settlement;
  if (settlement === null) return null;
  const payer = canPay(record);
  const reporter = record.viewerRoles.includes("reporter");
  const recovery = settlement.recovery ?? null;
  const found = recovery?.mode === "payment-found" && payer ? (recovery.transactionIds ?? []) : [];
  const finalized = settlement.transactionIds ?? (settlement.transactionId ? [settlement.transactionId] : []);
  const confirmed = settlement.confirmedTransactionIds?.length ?? 0;
  const total = confirmed + (settlement.remainingTransfers?.length ?? 0);
  return (
    <section aria-label="Private payment" className="flex flex-col gap-3">
      <h4 className="font-semibold text-foreground">Payment {settlement.network}</h4>
      {settlement.privacyNotice ? <p className="text-sm text-muted-foreground">{settlement.privacyNotice}</p> : null}
      {reporter && settlement.state !== "paid" ? (
        <p>
          <WalletLink />
        </p>
      ) : null}
      <dl className="flex flex-col gap-2">
        {record.paymentRail === "direct" && settlement.remainingTransfers ? (
          <Fact term="Progress">
            <span className="inline-flex items-center gap-2">
              <Progress aria-label="Transfers confirmed" value={confirmed} max={total} className="w-24" /> {confirmed}/{total}
            </span>
          </Fact>
        ) : null}
        {finalized.map((transactionId) => (
          <Fact
            key={transactionId}
            term={
              <span role="img" aria-label="Finalized" title="Finalized" className="inline-flex">
                <Check aria-hidden className="size-3.5" />
              </span>
            }
          >
            <CopyIdentifier value={transactionId} label="payment transaction ID" />
          </Fact>
        ))}
      </dl>
      {recovery ? (
        <fieldset aria-label="Payment recovery" className="flex flex-col gap-3 rounded-md border border-border p-4">
          <legend className="px-1 text-sm font-medium text-foreground">Payment recovery</legend>
          {recovery.target ? <CopyIdentifier value={recovery.target.address} label={recovery.role === "fee" ? "fee wallet" : "current payout wallet"} /> : null}
          <RecoveryStatus mode={recovery.mode} payer={payer} reporter={reporter} />
          {recovery.mode === "wallet-required" ? <WalletLink /> : null}
          {found.length > 0 ? <VerifyFoundPayment transactionIds={found} onSend={onSend} onStart={onStart} /> : null}
        </fieldset>
      ) : null}
      {controls}
    </section>
  );
}

function History({ record }: { record: SecurityCase }) {
  const owner = record.view === "restricted";
  const events = record.events ?? [];
  const triagers = (record.triagers ?? []).filter((entry) => entry.revokedAt === null);
  return (
    <Disclosure summary="History">
      {record.receiptState ? (
        <p className="flex flex-wrap items-center gap-2">
          {record.severity ? <Status title="Severity" presentation={severityPresentation(record.severity)} /> : null}
          {record.lossFinding ? <Status title="Loss of funds" presentation={badge(record.lossFinding)} /> : null}
          {record.remediationState ? <Status title="Remediation" presentation={badge(record.remediationState)} /> : null}
          {record.disclosureState ? <Status title="Disclosure" presentation={badge(record.disclosureState, "Neutral", record.disclosureState === "disclosed" ? "Eye" : "Lock")} /> : null}
          {record.recognition ? <Status title="Recognition" presentation={badge(record.recognition, "Neutral", record.recognition === "opt-in" ? "Eye" : "Slash")} /> : null}
          {record.appealState && record.appealState !== "none" ? <Status title="Appeal" presentation={badge(`Appeal ${record.appealState}`)} /> : null}
        </p>
      ) : null}
      <dl className="flex flex-col gap-2">
        <Fact term="Case">
          <CopyIdentifier value={record.id} label="case ID" />
        </Fact>
        <Fact term="Terms">
          {record.terms && record.terms.grossMinor !== undefined ? money(record.terms.grossMinor, record.terms) : "None"} · rev {record.policyRevision ?? "—"}
        </Fact>
        {record.reporter ? <Fact term="Reporter">@{record.reporter.githubLogin}</Fact> : null}
        {record.payee ? <Fact term="Payee">@{record.payee.githubLogin}</Fact> : null}
        {owner && record.rootCauseKey ? <Fact term="Root cause">{record.rootCauseKey}</Fact> : null}
        {owner && record.duplicateOf ? <Fact term="Duplicate of">{record.duplicateOf}</Fact> : null}
        {owner && triagers.length > 0 ? <Fact term="Triagers">{triagers.map((entry) => `@${entry.githubLogin}`).join(", ")}</Fact> : null}
      </dl>
      {events.length > 0 ? (
        <ol className="mt-3 flex flex-col gap-2">
          {events.map((event) => {
            const digest = event.kind === "disclosure" ? event.detail?.redactedContentDigest : null;
            const embargo = event.kind === "disclosure" ? event.detail?.embargoChange : null;
            return (
              <li key={event.revision} className="flex flex-col gap-1">
                <span className="inline-flex flex-wrap items-center gap-2">
                  <EventActor kind={event.kind} />
                  <strong className="text-foreground">{eventLabel(event.kind)}</strong>
                  {utc(event.at)}
                </span>
                {event.reason || event.evidenceReference || digest || embargo ? (
                  <Disclosure summary="Details">
                    {event.reason ? <p>{event.reason}</p> : null}
                    {event.evidenceReference ? <p>Evidence: {event.evidenceReference}</p> : null}
                    {digest ? <p>SHA-256: {digest}</p> : null}
                    {embargo ? <p>Embargo: {embargo}</p> : null}
                  </Disclosure>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}
    </Disclosure>
  );
}

/** One private case as its current roles may read it: next step, receipt, award, payout, analysis, actions and history. */
export function CaseDetailView({ record, note, refreshError, onReload, retrying, retryError, onRetry, onSend, onPaymentStart, payment }: CaseDetailViewProps) {
  const owner = record.view === "restricted";
  const response = ownerResponse(record);
  const pending = awardPending(record);
  const headingId = `case-${record.id}`;
  return (
    <article aria-labelledby={headingId} className="flex flex-col gap-6 rounded-lg border border-border bg-card p-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} className="text-lg font-semibold text-foreground">
          {caseTitle(record)} · {record.projectId}
        </h3>
        <span role="img" aria-label="Private" title="Private" className="inline-flex text-muted-foreground">
          <LockKeyhole aria-hidden className="size-4" />
        </span>
      </header>
      {note ? (
        <p role="status">
          <Status presentation={badge(note, "Positive", "Check")} />
        </p>
      ) : null}
      {refreshError ? <StaleNotice error={refreshError} onRetry={onReload} /> : null}
      <p className="flex items-start gap-2">
        <ArrowRight aria-hidden className="mt-1 size-4 shrink-0" />
        <span className="inline-flex flex-wrap items-center gap-2">
          {record.nextStep}
          {record.nextStepDueAt ? <TimeChip at={record.nextStepDueAt} name="Due" /> : null}
        </span>
      </p>
      <dl className="flex flex-col gap-2">
        <Fact term="Receipt">
          <Receipt record={record} />
        </Fact>
        {record.receiptState ? (
          <Fact term="Owner response">
            <span className="inline-flex flex-wrap items-center gap-2">
              <Status presentation={receiptPresentation(record.receiptState)} />
              {response ? <q>{response}</q> : null}
            </span>
          </Fact>
        ) : null}
        {record.award && record.terms ? null : (
          <Fact term="Award">
            <Status presentation={badge(awardText(record))} />
          </Fact>
        )}
        {record.relatedParty === "related" && record.relatedPartyReview !== "not-applicable" ? (
          <Fact term="Related party">
            <Status presentation={relatedPartyPresentation(record.relatedPartyReview)} />
          </Fact>
        ) : null}
        <Fact term="Payout">
          <span className="inline-flex flex-wrap items-center gap-2">
            <Status presentation={payoutPresentation(record)} />
            {record.paymentDeadline ? <TimeChip at={record.paymentDeadline} name="Payment deadline" /> : null}
          </span>
        </Fact>
      </dl>
      {record.award && record.terms ? (
        <section aria-label="Award and payment" className="flex flex-col gap-3">
          <MetricGrid>
            <Metric label="Award" value={money(record.award.grossMinor, record.terms)} detail={pending ? <Status presentation={badge(pending, "Caution", "Clock")} /> : undefined} />
          </MetricGrid>
          <dl className="flex flex-col gap-2">
            <Fact term="Researcher">{money(record.award.researcherMinor, record.terms)}</Fact>
            <Fact term="Slop">{money(record.award.slopMinor, record.terms)}</Fact>
          </dl>
        </section>
      ) : null}
      {owner ? <AnalysisPanel record={record} busy={retrying === "analyze"} error={retrying === null ? retryError : null} onRetry={() => onRetry("analyze")} /> : null}
      {owner && record.appealState === "open" ? <AppealTriage record={record} busy={retrying === "triage-appeal"} error={retrying === null ? retryError : null} onRetry={() => onRetry("triage-appeal")} /> : null}
      <PaymentFacts key={record.revision} record={record} controls={payment} onSend={onSend} onStart={onPaymentStart} />
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
  const [notice, setNotice] = useState<Presentation | null>(null);
  const reload = () => void run(runtime, reloadCase(owner));
  const changed = (record: SecurityCase | null) => void run(runtime, caseChanged(owner, record));
  if (shown === undefined || shown.owner !== owner || shown.caseId !== caseId || shown.loaded.status === "loading") return <Spinner size="sm" label="Loading case…" />;
  const loaded = shown.loaded;
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
    setNote("Saved");
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
      onPaymentStart={() => setNotice(null)}
      payment={payment?.(record, { changed: () => changed(null), notice, hold: setNotice })}
    />
  );
}
