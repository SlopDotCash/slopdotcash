/**
 * Private security bounty pages (PRD section 8, SEC-01 to SEC-18, MVP-13).
 *
 * `/projects/:id/security` shows the public program terms and starts a
 * private report in Slop before automated screening and optional private
 * GitHub forwarding. `/inbox` and `/security` show the authorized reporter
 * sees the receipt, the owner's response and the payout; the owner sees the
 * AI summary and the request-information, award and remediation actions.
 * The API returns only the cases and fields the caller's current role allows.
 */

import {
  ArrowRight,
  CircleAlert,
  Download,
  ExternalLink,
  LockKeyhole,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import {
  createContext,
  type FormEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { BountySubmittedPayments } from "./BountySubmittedPayments";
import {
  DirectBountyPayment,
  type DirectEvmTransaction,
} from "./DirectBountyPayment";
import { Link } from "./Link";
import { hasBountyOverview } from "./lib/home-projects";
import { PrivateReportForm, usePrivateDraftSession } from "./PrivateReportForm";
import {
  GRANT_ERRORS,
  githubSubmissionStatus,
  rateLimitMessage,
  reportNeedsAction,
  type Submission,
  submissionStatus,
} from "./PrivateReportSummary";
import { ProjectSecuritySettings } from "./ProjectSecuritySettings";
import { SecurityOffer } from "./SecurityOffer";
import {
  type DirectSolanaPlan,
  SolanaBountyPayment,
} from "./SolanaBountyPayment";
import { SolanaBountyRecovery } from "./SolanaBountyRecovery";
import "./operations-design.css";
import "./private-report-design.css";
import { decimalBaseUnits, formatBaseUnits } from "./lib/base-units.mjs";
import { errorMessage } from "./lib/errors";
import {
  clearAllDrafts,
  clearDraft,
  EMPTY_DRAFT,
  loadDraft,
  needsDraft,
  pruneDrafts,
  type ReportDraft,
  saveDraft,
  TERMINAL_FAILURES,
} from "./lib/intake-drafts";
import {
  currentProjectSession,
  ProjectApiError,
  type ProjectSessionState,
  projectApiRequest,
  useProjectSession,
} from "./lib/project-api";
import type { GithubActor } from "./lib/project-contracts";
import { PROJECTS, type ProjectDefinition } from "./lib/projects.mjs";
import type { RewardAsset } from "./lib/reward-asset.mjs";
import {
  formatSecurityAmount,
  isFullAwardSplit,
  type SecurityBountyTerms,
  securityBountySplit,
} from "./lib/security-bounty.mjs";
import { useAction } from "./lib/use-action";
import { CopyButton, CopyIdentifier } from "./Operations";
import {
  ExternalLinkAnchor,
  formatNullableUtc as formatUtc,
  ProjectNav,
  RoutePageHeader,
  SignInPanel,
  StatusBadge,
} from "./Presentation";

function FormError({ message }: { message: string | null }) {
  return message ? (
    <p className="form-error" role="alert">
      <CircleAlert aria-hidden="true" /> {message}
    </p>
  ) : null;
}

type DirectOwnerRequest = {
  rail: "direct";
  asset: { symbol: string; decimals: number; address: string };
  payer: { address: string };
  transfers: {
    recipient: string;
    amountBase: string;
    role: "researcher" | "fee";
  }[];
  transactions?: {
    from: string;
    to: string;
    value: string;
    data: string;
    chainId?: string;
    nonce?: string;
  }[];
  solana?: {
    transaction: string;
    blockhash: string;
    lastValidBlockHeight: number;
    messageId: string;
  };
};

function UnsignedPaymentRequest({
  request,
}: {
  request: Record<string, unknown>;
}) {
  const [feedback, setFeedback] = useState("");
  const text = JSON.stringify(request, null, 2);
  const direct =
    request.rail === "direct"
      ? (request as unknown as DirectOwnerRequest)
      : null;
  return (
    <section
      className="security-unsigned-payment"
      aria-label="Unsigned owner request"
    >
      <h5>{direct ? "Transfers still due" : "Unsigned owner request"}</h5>
      {direct ? (
        <>
          <p>
            Send these transfers with your external wallet, then verify the
            transaction IDs.
          </p>
          <dl className="operations-facts">
            <Fact term="From">
              <CopyIdentifier
                label="payer wallet"
                value={direct.payer.address}
              />
            </Fact>
            <Fact term="Asset">
              <CopyIdentifier
                label="payment asset"
                value={direct.asset.address}
              />
            </Fact>
          </dl>
          <div className="security-payment-transfers">
            {direct.transfers.map((transfer, index) => (
              <div
                key={`${transfer.role}:${transfer.recipient}`}
                data-payment-recipient={transfer.recipient}
              >
                <span>
                  {transfer.role === "fee" ? "Slop fee" : "Researcher"}
                </span>
                <strong>
                  {formatBaseUnits(transfer.amountBase, direct.asset.decimals)}{" "}
                  {direct.asset.symbol}
                </strong>
                <CopyIdentifier
                  label={`${transfer.role === "fee" ? "Slop fee" : "researcher"} wallet`}
                  value={transfer.recipient}
                />
                {direct.transactions?.[index] ? (
                  <CopyButton
                    label={`${transfer.role === "fee" ? "Slop fee" : "researcher"} transfer`}
                    text={JSON.stringify(direct.transactions[index], null, 2)}
                  />
                ) : null}
              </div>
            ))}
          </div>
          {direct.solana ? (
            <CopyButton
              label="Solana transaction"
              text={direct.solana.transaction}
            />
          ) : null}
        </>
      ) : null}
      <div className="operations-file-actions">
        <CopyButton
          label="unsigned request"
          text={text}
          successMessage="Request copied."
        />
        <button
          className="text-button operations-copy-button"
          type="button"
          aria-label="Download unsigned request"
          title="Download unsigned request"
          onClick={() => {
            const url = URL.createObjectURL(
              new Blob([`${text}\n`], { type: "application/json" }),
            );
            const link = document.createElement("a");
            link.href = url;
            link.download = "private-payment-request.json";
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            setFeedback("Request download started.");
          }}
        >
          <Download aria-hidden="true" />
        </button>
      </div>
      <p role="status">{feedback}</p>
      {direct ? null : (
        <textarea
          className="security-payment-request"
          aria-label="Unsigned transaction request"
          readOnly
          rows={9}
          value={text}
        />
      )}
    </section>
  );
}

function amounts(terms: SecurityBountyTerms) {
  const split = securityBountySplit(terms.amount.grossMinor, terms.split);
  return {
    gross: formatSecurityAmount(split.grossMinor, terms.amount),
    researcher: formatSecurityAmount(split.researcherMinor, terms.amount),
    slop: formatSecurityAmount(split.slopMinor, terms.amount),
  };
}

const PROGRAM_STATUS_LABELS: Record<SecurityBountyTerms["status"], string> = {
  draft: "Not open for paid reports",
  "pending-approval": "Not open for paid reports",
  open: "Open for paid reports",
  paused: "Paused — no new paid reports",
  closed: "Closed — no new paid reports",
};

type Readiness = {
  state: "ready" | "disabled" | "forbidden" | "unavailable";
  /** Whether Slop can file the report as the reporter (intake App). */
  automatic?: "ready" | "app-not-installed" | "unavailable" | "off";
  checkedAt: string | null;
  stale?: boolean;
  automaticConfigured?: boolean;
  storedIntake?: boolean;
  maxAgeSeconds: number;
  paidParticipation: "open" | "closed";
  handoffUrl: string | null;
};

type ReadinessState =
  | { status: "checking" }
  | { status: "error"; message: string }
  | {
      status: "checked";
      value: Readiness;
      stale: boolean;
      /** A fresh check is running; the page keeps the last answer. */
      rechecking: boolean;
    };

const BLOCKED_INTAKE: Record<Exclude<Readiness["state"], "ready">, string> = {
  disabled:
    "GitHub private vulnerability reporting is turned off for this repository.",
  forbidden: "GitHub refused the private reporting check.",
  unavailable: "Private reporting status is unavailable.",
};

/**
 * Accepts a report in Slop independently of GitHub availability. The optional
 * GitHub delivery link is shown only while the cached observation is fresh.
 */
function IntakeHandoff({
  project,
  session,
}: {
  project: ProjectDefinition;
  session: ProjectSessionState;
}) {
  const [state, setState] = useState<ReadinessState>({ status: "checking" });
  const check = useCallback((): Promise<Readiness | null> => {
    setState((current) =>
      current.status === "checked"
        ? { ...current, rechecking: true }
        : { status: "checking" },
    );
    return projectApiRequest<Readiness>(
      "GET",
      `security-programs/${encodeURIComponent(project.id)}/intake`,
    ).then(
      (value) => {
        setState({
          status: "checked",
          value,
          stale: value.stale === true,
          rechecking: false,
        });
        return value;
      },
      (error: unknown) => {
        setState((current) =>
          current.status === "checked"
            ? { ...current, stale: true, rechecking: false }
            : { status: "error", message: errorMessage(error) },
        );
        return null;
      },
    );
  }, [project.id]);
  useEffect(() => {
    void check();
  }, [check]);
  // The answer expires on this device's clock from when it arrived, so a
  // skewed clock cannot hide or extend it. The edge serves it at most
  // the edge TTL old; the server subtracts that TTL from observation freshness.
  useEffect(() => {
    if (state.status !== "checked" || state.stale) return;
    const timer = window.setTimeout(
      () =>
        setState((current) =>
          current.status === "checked" ? { ...current, stale: true } : current,
        ),
      state.value.maxAgeSeconds * 1000,
    );
    return () => window.clearTimeout(timer);
  }, [state]);
  const checkAgain = (busy: boolean) => (
    <button
      className="text-button"
      disabled={busy}
      onClick={() => void check()}
      type="button"
    >
      <RotateCcw aria-hidden="true" /> {busy ? "Checking…" : "Check again"}
    </button>
  );
  return (
    <section
      aria-labelledby="security-report"
      className="admin-card security-intake-card"
    >
      <h2 id="security-report">Private report</h2>
      <p className="operations-caution">
        <LockKeyhole aria-hidden="true" />
        Never post exploit details publicly.
      </p>
      {state.status === "checked" && state.value.storedIntake === true ? (
        <AutomaticReportForm session={session} project={project} />
      ) : state.status === "checking" ? (
        <p role="status">Checking private intake…</p>
      ) : (
        <p role="status">
          Slop private intake is unavailable. The private GitHub route below
          remains separate; never post a public report.
        </p>
      )}
      <details
        className="security-reference"
        open={state.status !== "checked" || state.value.storedIntake !== true}
      >
        <summary>
          {state.status === "checked" && state.value.storedIntake === true
            ? "Optional private GitHub delivery"
            : "Private reporting options"}
        </summary>
        {state.status === "checking" ? (
          <p aria-live="polite" className="admin-status">
            Loading private reporting status…
          </p>
        ) : state.status === "error" ? (
          <div className="form-error" role="alert">
            <CircleAlert aria-hidden="true" /> {state.message}
            {checkAgain(false)}
          </div>
        ) : state.value.state === "ready" && state.value.handoffUrl ? (
          <div aria-live="polite" className="security-handoff">
            {state.stale ? (
              <div className="form-error" role="alert">
                <CircleAlert aria-hidden="true" /> Private reporting status from{" "}
                {state.value.checkedAt
                  ? formatUtc(state.value.checkedAt)
                  : "an unknown time"}{" "}
                is out of date.
                {session.status === "signed-in" ? " Your draft is kept." : ""}
                {checkAgain(state.rechecking)}
              </div>
            ) : (
              <p className="admin-status security-readiness">
                <StatusBadge tone="success" icon={<ShieldCheck />}>
                  GitHub private reporting is on
                </StatusBadge>{" "}
                <span>
                  (checked{" "}
                  {state.value.checkedAt
                    ? formatUtc(state.value.checkedAt)
                    : "an unknown time"}
                  ).
                  {state.value.paidParticipation === "open"
                    ? ""
                    : " No new paid reports now."}
                </span>
              </p>
            )}
            {state.stale ? null : (
              <a
                className={
                  state.value.automatic === "ready"
                    ? "text-button"
                    : "button primary-button"
                }
                href={state.value.handoffUrl}
                rel="noreferrer"
                target="_blank"
              >
                {state.value.automatic === "ready"
                  ? "Or report directly on GitHub"
                  : "Report privately on GitHub"}{" "}
                <ExternalLink aria-hidden="true" />
              </a>
            )}
          </div>
        ) : (
          <div className="form-error" role="alert">
            <CircleAlert aria-hidden="true" />{" "}
            {
              BLOCKED_INTAKE[
                state.value.state as Exclude<Readiness["state"], "ready">
              ]
            }{" "}
            {state.stale && state.value.checkedAt
              ? ` Status from ${formatUtc(state.value.checkedAt)} is out of date.`
              : ""}
            Check again later.
            {checkAgain(state.rechecking)}
          </div>
        )}
        <p>
          Already reported on GitHub?{" "}
          <Link href="/security#security-link">Verify the private report</Link>.
        </p>
      </details>
    </section>
  );
}

function reportBody(draft: ReportDraft): Record<string, unknown> {
  const cweIds = draft.cwe
    .split(/[\s,]+/u)
    .map((entry) => entry.trim().toUpperCase())
    .filter(Boolean);
  return {
    summary: draft.summary.trim(),
    description: draft.description.trim(),
    ...(draft.cvss.trim()
      ? { cvssVectorString: draft.cvss.trim() }
      : draft.severity
        ? { severity: draft.severity }
        : {}),
    ...(cweIds.length > 0 ? { cweIds } : {}),
  };
}

/** Failures whose labels point the reporter to the maintainer-verified link. */
const LINK_FALLBACK_FAILURES: readonly string[] = [
  "not-private-report",
  "unverifiable",
];

/** The report text must survive the GitHub authorization redirect. */
const DRAFT_STORAGE_ERROR =
  "This browser could not keep your report during GitHub authorization. Allow site storage for this tab, then try again.";

/** One consent line before the fields. */
function IntakeConsent({ login }: { login: string | null }) {
  return (
    <p>
      The Slop private intake app will file this on GitHub as{" "}
      {login ? `@${login}` : "you"} with your authorization, as a private report
      only you and the repository’s administrators and security managers can
      read.
    </p>
  );
}

/** One optional explanation after the action (PRD section 7). */
function IntakeReferenceNote() {
  return (
    <p className="field-hint">
      Slop stores no report text. It adds a “Report reference:” line with a
      random code to your description. The line names neither you nor Slop and
      stays if the advisory is published.
    </p>
  );
}

function ReportFields({
  draft,
  onChange,
  disabled = false,
}: {
  draft: ReportDraft;
  onChange: (draft: ReportDraft) => void;
  disabled?: boolean;
}) {
  const fieldId = useId();
  const [classificationOpen, setClassificationOpen] = useState(
    Boolean(draft.severity || draft.cvss || draft.cwe),
  );
  const set = (key: keyof ReportDraft) => (value: string) =>
    onChange({ ...draft, [key]: value });
  return (
    <>
      <label>
        Summary
        <input
          id={`${fieldId}-summary`}
          autoComplete="off"
          disabled={disabled}
          maxLength={1024}
          minLength={8}
          onChange={(event) => set("summary")(event.target.value)}
          required
          value={draft.summary}
        />
      </label>
      <label>
        Description
        <textarea
          id={`${fieldId}-description`}
          disabled={disabled}
          maxLength={65000}
          minLength={20}
          onChange={(event) => set("description")(event.target.value)}
          required
          rows={10}
          value={draft.description}
        />
        <small className="field-hint">
          Include the affected revision, impact and safe reproduction steps. Do
          not include credentials or cause a real loss of funds.
        </small>
      </label>
      <details
        className="security-classification"
        open={classificationOpen}
        onToggle={(event) => setClassificationOpen(event.currentTarget.open)}
      >
        <summary>
          Additional classification <span>Optional</span>
        </summary>
        <div>
          <label>
            Severity (optional)
            <select
              disabled={disabled || draft.cvss.trim() !== ""}
              onChange={(event) => set("severity")(event.target.value)}
              value={draft.severity}
            >
              <option value="">Not set</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>
          <label>
            CVSS vector (optional, instead of severity)
            <input
              autoComplete="off"
              disabled={disabled}
              onChange={(event) => set("cvss")(event.target.value)}
              placeholder="CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"
              spellCheck={false}
              value={draft.cvss}
            />
          </label>
          <label>
            CWE IDs (optional)
            <input
              autoComplete="off"
              disabled={disabled}
              onChange={(event) => set("cwe")(event.target.value)}
              placeholder="CWE-284"
              spellCheck={false}
              value={draft.cwe}
            />
          </label>
        </div>
      </details>
    </>
  );
}

/**
 * Stores a private report before screening and opens its durable Inbox status.
 * A rejected request leaves the typed evidence in the form for recovery.
 */
function AutomaticReportForm({
  session,
  project,
}: {
  session: ProjectSessionState;
  project: ProjectDefinition;
}) {
  if (session.status !== "signed-in")
    return (
      <SignInPanel
        state={session}
        next={`/projects/${project.slug}/security`}
        purpose="Sign in to report through Slop."
      />
    );
  return (
    <PrivateReportForm
      key={`${project.id}:${session.session.githubId}`}
      project={project}
      owner={session.session.githubId}
      login={session.session.githubLogin}
      body={reportBody}
      fields={(draft, change) => (
        <ReportFields draft={draft} onChange={change} />
      )}
    />
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div>
      <dt>{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function people(list: SecurityBountyTerms["approvers"]["technical"]): string {
  return list.map((entry) => `@${entry.githubLogin}`).join(", ");
}

/** Public program terms and the verified private handoff. */
export function SecurityProgramPage({
  project: initialProject,
}: {
  project: ProjectDefinition;
}) {
  const [project, setProject] = useState(initialProject);
  const [published, setPublished] = useState<{
    projectId: string;
    revision: number;
  } | null>(null);
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const session = useProjectSession(sessionEpoch);
  usePrivateDraftSession(session);
  useEffect(() => {
    const check = () => setSessionEpoch((value) => value + 1);
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, []);
  useEffect(() => setProject(initialProject), [initialProject]);
  const terms = project.securityBounty;
  if (terms === undefined)
    return (
      <main className="shell route-main admin-page security-page operations-page security-program">
        <RoutePageHeader
          icon={<ShieldCheck />}
          title={
            <>
              Report a security issue in{" "}
              <Link href={`/projects/${project.slug}`}>{project.name}</Link>
            </>
          }
          lead="No published bounty terms, so no award is promised."
        />
        <ProjectNav project={project} current="security" />
        {published?.projectId === project.id ? (
          <p role="status">Published revision {published.revision}.</p>
        ) : null}
        <IntakeHandoff project={project} session={session} />
        <ProjectSecuritySettings
          key={project.id}
          onProjectChange={setProject}
          onPublishedRevision={(revision) =>
            setPublished({ projectId: project.id, revision })
          }
          project={project}
          session={session}
        />
      </main>
    );
  const money = amounts(terms);
  const agentPrompt = `Read ${window.location.origin}/SKILL.md and follow its private security reporting workflow for github.com/${terms.intake.repository}.`;
  const { scope } = terms;
  return (
    <main className="shell route-main admin-page security-page operations-page security-program">
      <RoutePageHeader
        icon={<ShieldCheck />}
        title={<>{project.name} security bounty</>}
        lead={<>{money.gross} security bounty</>}
      >
        <StatusBadge tone={terms.status === "open" ? "success" : "warning"}>
          {PROGRAM_STATUS_LABELS[terms.status]}
        </StatusBadge>
      </RoutePageHeader>
      {!hasBountyOverview(project) ? (
        <ProjectNav project={project} current="security" />
      ) : null}
      {published?.projectId === project.id ? (
        <p role="status">Published revision {published.revision}.</p>
      ) : null}
      <p>
        Find{" "}
        {terms.eligibility === "critical-loss-of-funds"
          ? "a critical"
          : "an in-scope"}{" "}
        security vulnerability in {project.name}
      </p>
      <p>
        <ExternalLinkAnchor href={project.links.repository}>
          View in GitHub <ExternalLink aria-hidden="true" size={14} />
        </ExternalLinkAnchor>
      </p>
      <section className="install-panel" aria-labelledby="bounty-agent-setup">
        <h2 id="bounty-agent-setup">Agent setup</h2>
        <p>Copy this into your agent.</p>
        <div className="command-box agent-prompt-box">
          <code>{agentPrompt}</code>
          <CopyButton label="agent prompt" text={agentPrompt} />
        </div>
      </section>
      <p>
        <a href="#security-scope">
          Check covered source and safe testing rules
        </a>
      </p>
      <div className="security-program-terms">
        <details className="security-reference">
          <summary>Full award terms</summary>
          <section aria-labelledby="security-terms" className="admin-card">
            <h2 id="security-terms">Award terms</h2>
            <SecurityOffer project={project} />
            <section className="security-award-split" aria-label="Award split">
              <div>
                <span>
                  Researcher · {isFullAwardSplit(terms.split) ? "100%" : "75%"}
                </span>
                <strong>{money.researcher}</strong>
              </div>
              <div>
                <span>
                  Slop · {isFullAwardSplit(terms.split) ? "0%" : "25%"}
                </span>
                <strong>{money.slop}</strong>
              </div>
            </section>
            <dl className="admin-facts">
              <Fact term="Currency">
                {terms.amount.currency}
                {terms.amount.network ? ` on ${terms.amount.network}` : ""}
              </Fact>
              <Fact term="Funding">
                {terms.funding.state === "pledged"
                  ? "Pledged. Awards require owner approval."
                  : `Verified available on ${formatUtc(terms.funding.verifiedAt)}: ${terms.funding.evidence}`}
              </Fact>
              <Fact term="Capacity">
                {terms.capacity.awards === null
                  ? "No fixed award count; each first qualifying finding is reviewed separately"
                  : `${terms.capacity.awards} award${terms.capacity.awards === 1 ? "" : "s"} at the published amount`}
                {terms.capacity.closesAt
                  ? `; closes ${formatUtc(terms.capacity.closesAt)}`
                  : ""}
                . {terms.capacity.exhaustionRule}
              </Fact>
              <Fact term="Other work">
                {terms.rewardMode === "bounty-only"
                  ? "Bounty only. Other work, including fixes, earns no monthly pool cash."
                  : "Contribution rewards are separate; one outcome is never paid twice."}
              </Fact>
            </dl>
            <p>
              Awards are discretionary. The owner decides whether to award;
              fixed after-approval awards use the amount published at receipt.{" "}
              {terms.eligibility === "critical-loss-of-funds"
                ? "Critical bugs and potential loss of funds are priorities, not an automatic payout."
                : "Findings must meet the published scope and acceptance criteria."}{" "}
              No other payout fee applies. The terms in force when Slop receives
              your report apply to your case.
            </p>
          </section>
        </details>
        <section aria-labelledby="security-scope" className="admin-card">
          <h2 id="security-scope">Scope</h2>
          <dl className="admin-facts">
            <Fact term="Covered source">
              <ul>
                {scope.sourceRevisions.map((source) => (
                  <li key={`${source.repository}@${source.commit}`}>
                    <ExternalLinkAnchor
                      href={`https://github.com/${source.repository}/tree/${source.commit}`}
                    >
                      {source.repository}@{source.commit.slice(0, 12)}
                    </ExternalLinkAnchor>
                  </li>
                ))}
              </ul>
            </Fact>
            <Fact term="Deployments">
              {scope.deployments.length === 0 ? (
                "None listed"
              ) : (
                <ul>
                  {scope.deployments.map((deployment) => (
                    <li key={`${deployment.network}:${deployment.address}`}>
                      {deployment.network}: <code>{deployment.address}</code>
                      {deployment.codeIdentity
                        ? ` (${deployment.codeIdentity})`
                        : ""}
                    </li>
                  ))}
                </ul>
              )}
            </Fact>
            <Fact term="Included assets">
              {scope.includedAssets.join("; ")}
            </Fact>
            <Fact term="Excluded dependencies">
              {scope.excludedDependencies.length === 0
                ? "None listed"
                : scope.excludedDependencies.join("; ")}
            </Fact>
            <Fact term="Testing permission">{scope.testingPermission}</Fact>
            <Fact term="Severity rubric">{scope.severityRubric}</Fact>
            <Fact
              term={
                terms.eligibility === "critical-loss-of-funds"
                  ? "Loss of funds"
                  : "Impact"
              }
            >
              {scope.lossDefinition}
            </Fact>
          </dl>
          <p>
            Do not exploit a production system, move another person's funds,
            reveal keys or cause damage. A local fork or isolated test can show
            potential{" "}
            {terms.eligibility === "critical-loss-of-funds" ? "loss" : "impact"}
            .
          </p>
        </section>
        <IntakeHandoff project={project} session={session} />
        <ProjectSecuritySettings
          key={project.id}
          onProjectChange={setProject}
          onPublishedRevision={(revision) =>
            setPublished({ projectId: project.id, revision })
          }
          project={project}
          session={session}
        />
        <details className="security-reference">
          <summary>Response, disclosure and researcher terms</summary>
          <section aria-labelledby="security-trust" className="admin-card">
            <h2 id="security-trust">Decisions, disputes and disclosure</h2>
            <dl className="admin-facts">
              <Fact term="Findings and awards">
                {people(terms.approvers.technical)}
              </Fact>
              <Fact term="Payment">{people(terms.approvers.financial)}</Fact>
              <Fact term="Disputes">
                Contact {people(terms.approvers.dispute)}.{" "}
                {terms.dispute.process} A Slop moderator decides escalated
                appeals.
              </Fact>
              <Fact term="Response targets">
                Acknowledge within {terms.responseTargets.acknowledgeHours}{" "}
                hours; first triage within{" "}
                {terms.responseTargets.triageBusinessDays} business days;
                updates every {terms.responseTargets.updateIntervalDays} days. A
                missed target never publishes a report or approves an award.
              </Fact>
              <Fact term="Disclosure">{terms.disclosure}</Fact>
              <Fact term="Safe harbor">{terms.safeHarbor}</Fact>
            </dl>
            <p>
              Slop never publishes cases; rejected, duplicate, disputed and paid
              reports stay private, and you decide separately whether your name
              is public. Repository administrators and security managers can
              read the advisory on GitHub. A public-chain payment shows its
              addresses, amount and time.
            </p>
          </section>
        </details>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Signed-in case inbox

type Terms = {
  fundingPolicy?: "after-approval";
  /** Present when an admin approved a full award. */
  split?: { researcherBasisPoints: 10000; slopBasisPoints: 0 };
  grossMinor: string;
  researcherMinor: string;
  slopMinor: string;
  currency: string;
  decimals: number;
  asset?: RewardAsset;
  network: string | null;
};

type CaseEvent = {
  revision: number;
  kind: string;
  at: string;
  reason: string | null;
  actorRole?: string;
  evidenceReference?: string | null;
  detail?: {
    redactedContentDigest?: string | null;
    embargoChange?: string | null;
  };
};

type Analysis = {
  sourceReportVersion?: number | null;
  state: "running" | "complete" | "failed" | "unavailable";
  provider: string | null;
  model: string | null;
  summary: string | null;
  proposedSeverity: string | null;
  potentialLoss: "likely" | "unlikely" | "unclear" | null;
  duplicateCaseIds: string[];
  rootCauseKey: string | null;
  remediation: string | null;
  finishedAt: string | null;
  retryable: boolean;
};

/** Slopbot's drafted resolution of the open appeal; a moderator decides. */
type AppealTriage = {
  state: "running" | "complete" | "failed" | "unavailable";
  model: string | null;
  proposedOutcome: "uphold" | "return" | null;
  rationale: string | null;
  confidence: number | null;
  escalationReasons: string[];
  retryable: boolean;
};

type SecurityCase = {
  id: string;
  projectId: string;
  revision: number;
  view: "restricted" | "reporter" | "financial";
  viewerRoles: string[];
  allowedActions: string[];
  nextStep: string;
  nextStepDueAt: string | null;
  submissionState: "claimed" | "verified" | "link-rejected";
  receivedAt: string | null;
  /**
   * `maintainer-attested`: a maintainer entered the time. `github-verified`:
   * Slop read GitHub's own record with the reporter's authorization.
   */
  receivedAtSource:
    | "maintainer-attested"
    | "github-verified"
    | "slop-received"
    | null;
  policyRevision: number | null;
  terms: Terms | null;
  awardState: string;
  award: {
    grossMinor: string;
    researcherMinor: string;
    slopMinor: string;
  } | null;
  relatedParty: "not-assessed" | "unrelated" | "related";
  relatedPartyReview: "not-applicable" | "pending" | "approved" | "refused";
  paymentState: string;
  paymentRail: "unavailable" | "escrow" | "direct";
  paymentNetworks: string[];
  settlement: {
    state: string;
    network: string;
    generation?: number;
    transactionId: string | null;
    transactionIds?: string[];
    confirmedTransactionIds?: string[];
    remainingTransfers?: {
      recipient: string;
      amountBase: string;
      role: "researcher" | "fee";
    }[];
    recovery?: {
      generation: number;
      mode:
        | "consent-required"
        | "cancellation-required"
        | "resume-original"
        | "legacy-manual"
        | "expiry-required"
        | "signature-required"
        | "history-check"
        | "wallet-required"
        | "fee-pending"
        | "retirement-required"
        | "retirement-unproven"
        | "payer-review"
        | "payment-found";
      target: { id: string; address: string; digest: string } | null;
      consented: boolean;
      cancellationRequest?: DirectEvmTransaction;
      payer?: string;
      messages?: { messageId: string; message: string }[];
      transactionIds?: string[];
      retirementNonce?: string;
      role?: "researcher" | "fee";
      legIndex?: number;
    } | null;
    privacyNotice: string;
    ownerRequest: Record<string, unknown> | null;
  } | null;
  paymentDeadline: string | null;
  advisory?: { repository: string; ghsa: string; url: string } | null;
  receiptState?: string;
  remediationState?: string;
  disclosureState?: string;
  recognition?: string;
  severity?: string | null;
  lossFinding?: string | null;
  appealState?: string;
  reporter?: GithubActor;
  payee?: { githubLogin: string };
  analysis?: Analysis | null;
  appealTriage?: AppealTriage | null;
  awardFunds?: {
    currency: string;
    decimals: number;
    availableMinor: string;
  } | null;
  rootCauseKey?: string | null;
  duplicateOf?: string | null;
  evidenceDigest?: string | null;
  triagers?: (GithubActor & { revokedAt: string | null })[];
  events?: CaseEvent[];
};

type ReportFilter = "all" | "review" | "waiting" | "award" | "resolved";
function matchesReport(record: SecurityCase, filter: ReportFilter): boolean {
  if (filter === "review")
    return record.allowedActions.some((action) =>
      ["decide", "verify-link", "request-information"].includes(action),
    );
  if (filter === "waiting") return record.receiptState === "needs-information";
  if (filter === "award")
    return (
      record.allowedActions.some((action) =>
        ["award", "prepare-payment"].includes(action),
      ) || Boolean(record.award && record.paymentState !== "paid")
    );
  if (filter === "resolved")
    return (
      record.paymentState === "paid" ||
      ["rejected", "duplicate", "out-of-scope"].includes(
        record.receiptState ?? "",
      ) ||
      record.awardState === "ineligible"
    );
  return true;
}

type CaseList = {
  viewer: GithubActor;
  programs: { projectId: string; roles: string[] }[];
  cases: SecurityCase[];
  authorityUnavailable?: boolean;
};

type Loaded<T> =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "error"; message: string }
  | { status: "ready"; value: T };

const PrivateRequestContext =
  createContext<typeof projectApiRequest>(projectApiRequest);

function usePrivateRequest() {
  return useContext(PrivateRequestContext);
}

function useSecurityData<T>(
  path: string | null,
): [Loaded<T>, () => void, (value: T) => void] {
  const privateRequest = usePrivateRequest();
  const [state, setState] = useState<Loaded<T>>({ status: "loading" });
  const generation = useRef(0);
  const load = useCallback(() => {
    if (path === null) return;
    const current = ++generation.current;
    // A refresh keeps the loaded view, so an open case stays mounted.
    setState((previous) =>
      previous.status === "ready" ? previous : { status: "loading" },
    );
    privateRequest<T>("GET", path).then(
      (value) => {
        if (generation.current === current)
          setState({ status: "ready", value });
      },
      (error: unknown) => {
        if (generation.current !== current) return;
        setState(
          error instanceof ProjectApiError && error.status === 401
            ? { status: "signed-out" }
            : { status: "error", message: errorMessage(error) },
        );
      },
    );
  }, [path, privateRequest]);
  useEffect(() => {
    load();
    return () => {
      generation.current += 1;
    };
  }, [load]);
  const replace = useCallback(
    (value: T) => setState({ status: "ready", value }),
    [],
  );
  return [state, load, replace];
}

function requestKey(): string {
  return crypto.randomUUID();
}

function money(minor: string, terms: { currency: string; decimals: number }) {
  return formatSecurityAmount(
    minor,
    terms as Parameters<typeof formatSecurityAmount>[1],
  );
}

/** Converts a typed decimal amount to integer minor units, without floats. */
function decimalToMinor(text: string, decimals: number): string | null {
  const value = text.replaceAll(",", "").trim();
  const match = /^(\d{1,16})(?:\.(\d+))?$/u.exec(value);
  if (!match || (match[2] ?? "").length > decimals) return null;
  const minor = decimalBaseUnits(match[1], match[2] ?? "", decimals);
  return minor === 0n ? null : minor.toString();
}

const RECEIPT_LABELS: Record<string, string> = {
  received: "Received — waiting for the owner",
  triaging: "Under review",
  "needs-information": "The owner asked for more information",
  confirmed: "Confirmed",
  duplicate: "Duplicate of an earlier report",
  "out-of-scope": "Out of scope",
  rejected: "Not accepted",
  disputed: "Under appeal",
};

const AWARD_LABELS: Record<string, string> = {
  "not-applicable": "No paid program was open when this report was received",
  pending: "Award not decided yet",
  ineligible: "No award",
  reserved: "Reserved",
  "capacity-exhausted": "Waiting for the owner's award decision",
  approved: "Approved and reserved",
};

const PAYMENT_LABELS: Record<string, string> = {
  "not-applicable": "No approved award",
  "rail-unavailable": "Approved, not paid yet",
  "awaiting-owner-commitment": "Waiting for the vault owner",
  "needs-wallet": "Wallet required",
  uncertain: "Submission outcome not yet confirmed",
  ready: "Ready for payment",
  processing: "Payment in progress",
  submitted: "Waiting for finality",
  held: "Payment held",
  paid: "Paid",
};

const SUBMISSION_LABELS: Record<SecurityCase["submissionState"], string> = {
  claimed: "Confirming with GitHub",
  verified: "Received by GitHub",
  "link-rejected": "Not confirmed by GitHub",
};

const EVENT_LABELS: Record<string, string> = {
  submit: "Reporter submitted privately; GitHub receipt verified",
  "submit-direct":
    "Reporter linked their GitHub report; GitHub receipt verified",
  claim: "Reporter linked the GitHub report",
  record: "Maintainer recorded the GitHub report",
  "verify-link": "Maintainer verified the GitHub report",
  "reject-link": "Maintainer rejected the link",
  receive: "GitHub receipt verified",
  "receipt-mismatch": "GitHub did not confirm this link",
  "assign-triager": "Triager assigned",
  "revoke-triager": "Triager removed",
  triage: "Triage state changed",
  "next-action": "Next action set",
  "request-information": "Owner asked for information",
  decide: "Finding decided",
  award: "Award decided",
  remediation: "Remediation state changed",
  disclosure: "Disclosure decision recorded",
  recognition: "Recognition choice changed",
  appeal: "Appeal sent",
  "decide-appeal": "Appeal decided",
  "approve-award": "Award approved",
  "consent-payment": "Reporter accepted chain visibility",
  "prepare-payment": "Unsigned payment prepared",
  "verify-payment": "Payment checked",
  "recover-payment": "Payment wallet recovered",
  "decide-related-party": "Related-party award reviewed",
  "reserve-award": "Award reserved with raised capacity",
};

/** The owner's latest words to the reporter, from the case history. */
const RESPONSE_KINDS = new Set([
  "request-information",
  "decide",
  "award",
  "decide-appeal",
  "decide-related-party",
  "reject-link",
]);

function ProjectSelect({
  projects,
  value,
  onChange,
}: {
  projects: ProjectDefinition[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      Project
      <select onChange={(event) => onChange(event.target.value)} value={value}>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A security maintainer brings direct GitHub reports into Slop. */
function ImportReports({
  projects,
  onImported,
}: {
  projects: ProjectDefinition[];
  onImported: () => void;
}) {
  const privateRequest = usePrivateRequest();
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [note, setNote] = useState<string | null>(null);
  const { busy, error, run: act } = useAction();
  const run = (event: FormEvent) => {
    event.preventDefault();
    setNote(null);
    void act(async () => {
      const body = await privateRequest<{
        state: "ok" | "unavailable";
        received: number;
      }>("POST", "security-cases", { mode: "import", projectId });
      if (body.state === "unavailable")
        throw new Error(
          "Slop could not read the repository's private reports on GitHub. Nothing changed; try again later.",
        );
      setNote(
        body.received === 0
          ? "Every private report on GitHub already has a case."
          : `${body.received} new private report${body.received === 1 ? "" : "s"} recorded.`,
      );
      onImported();
    });
  };
  return (
    <form className="security-form" onSubmit={run}>
      {projects.length > 1 ? (
        <ProjectSelect
          onChange={setProjectId}
          projects={projects}
          value={projectId}
        />
      ) : null}
      {note ? (
        <p className="admin-status" role="status">
          {note}
        </p>
      ) : null}
      <FormError message={error} />
      <button className="button secondary-button" disabled={busy} type="submit">
        {busy ? "Reading GitHub…" : "Bring in GitHub private reports"}
      </button>
    </form>
  );
}

function ClaimForm({
  programProjects,
  onCreated,
}: {
  programProjects: ProjectDefinition[];
  onCreated: (created: SecurityCase) => void;
}) {
  const privateRequest = usePrivateRequest();
  const [projectId, setProjectId] = useState(programProjects[0]?.id ?? "");
  const [advisory, setAdvisory] = useState("");
  const [key, setKey] = useState(requestKey);
  const { busy, error, run } = useAction();
  if (programProjects.length === 0)
    return (
      <p className="admin-status">No project runs a security program yet.</p>
    );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const body = await privateRequest<{ case: SecurityCase }>(
        "POST",
        "security-cases",
        {
          mode: "claim",
          projectId,
          advisory: advisory.trim(),
          idempotencyKey: key,
        },
      );
      setAdvisory("");
      setKey(requestKey());
      onCreated(body.case);
    });
  };
  return (
    <form className="security-form" onSubmit={submit}>
      <ProjectSelect
        onChange={setProjectId}
        projects={programProjects}
        value={projectId}
      />
      <label>
        GitHub advisory ID
        <input
          autoComplete="off"
          onChange={(event) => setAdvisory(event.target.value)}
          pattern="GHSA-[2-9cfghjmpqrvwx]{4}-[2-9cfghjmpqrvwx]{4}-[2-9cfghjmpqrvwx]{4}"
          placeholder="GHSA-xxxx-xxxx-xxxx"
          required
          spellCheck={false}
          value={advisory}
        />
        <small className="field-hint">
          Only the ID. Do not paste report details here.
        </small>
      </label>
      <FormError message={error} />
      <button className="button primary-button" disabled={busy} type="submit">
        {busy ? "Linking…" : "Link my GitHub report"}
      </button>
    </form>
  );
}

/**
 * "Already reported on GitHub? Verify it": GitHub's own record proves the
 * author and the receipt time, so no maintainer link check is needed.
 */
function DirectVerifyForm({
  onUnavailable,
  programProjects,
}: {
  /** The program's repository lacks the intake app, so GitHub cannot verify. */
  onUnavailable: () => void;
  programProjects: ProjectDefinition[];
}) {
  const privateRequest = usePrivateRequest();
  const [projectId, setProjectId] = useState(programProjects[0]?.id ?? "");
  const [advisory, setAdvisory] = useState("");
  const [key] = useState(requestKey);
  const { busy, error, run } = useAction();
  if (programProjects.length === 0)
    return (
      <p className="admin-status">No project runs a security program yet.</p>
    );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      try {
        const body = await privateRequest<{
          submission: Submission;
          authorizeUrl: string;
        }>("POST", "security-submissions", {
          projectId,
          advisory: advisory.trim(),
          idempotencyKey: key,
          origin: "direct",
        });
        window.location.assign(body.authorizeUrl);
        return "navigating";
      } catch (caught) {
        if (
          caught instanceof ProjectApiError &&
          caught.code === "intake_unavailable"
        )
          onUnavailable();
        throw caught;
      }
    });
  };
  return (
    <form className="security-form" onSubmit={submit}>
      <ProjectSelect
        onChange={setProjectId}
        projects={programProjects}
        value={projectId}
      />
      <label>
        GitHub advisory ID
        <input
          autoComplete="off"
          onChange={(event) => setAdvisory(event.target.value)}
          pattern="GHSA-[2-9cfghjmpqrvwx]{4}-[2-9cfghjmpqrvwx]{4}-[2-9cfghjmpqrvwx]{4}"
          placeholder="GHSA-xxxx-xxxx-xxxx"
          required
          spellCheck={false}
          value={advisory}
        />
        <small className="field-hint">
          Only the ID. Slop checks with GitHub that you are its author.
        </small>
      </label>
      <FormError message={error} />
      <button className="button primary-button" disabled={busy} type="submit">
        {busy ? "Opening GitHub…" : "Authorize GitHub and verify"}
      </button>
    </form>
  );
}

/** One wording for how the GitHub receipt time was established. */
const RECEIVED_AT_SOURCE_LABELS: Record<
  "github-verified" | "maintainer-attested" | "slop-received" | "unknown",
  string
> = {
  "github-verified": " (verified from GitHub)",
  "slop-received": " (received privately by Slop)",
  "maintainer-attested": " (maintainer-attested)",
  unknown: "",
};

type PrivateReport = {
  summary: string;
  description: string;
  severity?: string;
  cvssVectorString?: string;
  cweIds?: string[];
};

function RevisePrivateReport({
  submission,
  report,
  onUpdated,
}: {
  submission: Submission;
  report: PrivateReport;
  onUpdated: (submission: Submission) => void;
}) {
  const privateRequest = usePrivateRequest();
  const [draft, setDraft] = useState<ReportDraft>(() => ({
    summary: report.summary,
    description: report.description,
    severity: report.severity ?? "",
    cvss: report.cvssVectorString ?? "",
    cwe: (report.cweIds ?? []).join(", "),
  }));
  const { busy, error, run } = useAction();
  return (
    <details className="security-reference">
      <summary>Add evidence or correct report</summary>
      <form
        className="security-form"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            const result = await privateRequest<{ submission: Submission }>(
              "POST",
              `security-submissions/${encodeURIComponent(submission.id)}/report`,
              {
                expectedRevision: submission.intake?.revision,
                report: reportBody(draft),
              },
            );
            onUpdated(result.submission);
          });
        }}
      >
        <p>
          The new version is screened again. Your original receipt time and
          terms stay the same.
        </p>
        <ReportFields draft={draft} onChange={setDraft} disabled={busy} />
        <button className="button primary-button" disabled={busy} type="submit">
          {busy ? "Saving…" : "Save and screen again"}
        </button>
        <FormError message={error} />
      </form>
    </details>
  );
}

/** Fetch technical evidence only when its authorized reader opens the report. */
function PrivateReportDetail({
  submission,
  onUpdated,
  expanded = false,
}: {
  submission: Submission;
  onUpdated: (submission: Submission) => void;
  expanded?: boolean;
}) {
  const privateRequest = usePrivateRequest();
  const [opened, setOpened] = useState(expanded);
  const [detail, reload] = useSecurityData<{
    submission: Submission;
    report: PrivateReport;
  }>(
    opened ? `security-submissions/${encodeURIComponent(submission.id)}` : null,
  );
  const [reason, setReason] = useState("");
  const { busy, error, run } = useAction();
  const review = (decision: "forward" | "request-information") =>
    void run(async () => {
      const result = await privateRequest<{ submission: Submission }>(
        "POST",
        `security-submissions/${encodeURIComponent(submission.id)}/review`,
        { expectedRevision: submission.intake?.revision, decision, reason },
      );
      onUpdated(result.submission);
      reload();
      setReason("");
    });
  return (
    <details
      className="security-reference"
      open={opened}
      onToggle={(event) => setOpened(event.currentTarget.open)}
    >
      <summary>Read private report</summary>
      {!opened ? null : detail.status === "loading" ? (
        <p role="status">Loading private report…</p>
      ) : detail.status === "ready" ? (
        <>
          <h4>{detail.value.report.summary}</h4>
          <pre className="security-report-text">
            {detail.value.report.description}
          </pre>
          {detail.value.report.severity ? (
            <p>Reported severity: {detail.value.report.severity}</p>
          ) : null}
          {submission.intake?.canRevise ? (
            <RevisePrivateReport
              key={submission.intake.revision}
              submission={submission}
              report={detail.value.report}
              onUpdated={(updated) => {
                onUpdated(updated);
                reload();
              }}
            />
          ) : null}
          {submission.intake?.canReview ? (
            <div className="security-form">
              <label>
                Review reason
                <textarea
                  required
                  minLength={8}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={3}
                />
              </label>
              <div className="handoff-actions">
                <button
                  className="button primary-button"
                  disabled={busy || reason.trim().length < 8}
                  type="button"
                  onClick={() => review("forward")}
                >
                  Approve for owner review
                </button>
                <button
                  className="button secondary-button"
                  disabled={busy || reason.trim().length < 8}
                  type="button"
                  onClick={() => review("request-information")}
                >
                  Request more evidence
                </button>
              </div>
              <p className="field-hint">
                This routes the private report. It does not approve a bounty or
                payment.
              </p>
            </div>
          ) : null}
        </>
      ) : (
        <div role="alert">
          <p>
            {detail.status === "error"
              ? detail.message
              : "Sign in again to read this report."}
          </p>
          <button className="text-button" type="button" onClick={reload}>
            Retry
          </button>
        </div>
      )}
      <FormError message={error} />
    </details>
  );
}

/** One private submission and the only action its state allows. */
function SubmissionCard({
  session,
  submission,
  focused,
  onUpdated,
  onOpenCase,
  caseRecord,
  readReport,
}: {
  session: Extract<ProjectSessionState, { status: "signed-in" }>;
  submission: Submission;
  caseRecord?: SecurityCase;
  focused: boolean;
  readReport: boolean;
  onUpdated: (submission: Submission) => void;
  onOpenCase: (caseId: string) => void;
}) {
  const privateRequest = usePrivateRequest();
  const [draft, setDraft] = useState<ReportDraft>(
    () => loadDraft(submission.id) ?? EMPTY_DRAFT,
  );
  const { busy, error, setError, run: act } = useAction();
  const [needsGrant, setNeedsGrant] = useState(false);
  const keepDraft = !submission.intake && needsDraft(submission);
  useEffect(() => {
    if (!keepDraft) clearDraft(submission.id);
  }, [submission.id, keepDraft]);
  const run = (path: string, body: Record<string, unknown>) =>
    void act(async () => {
      try {
        const result = await privateRequest<{
          submission: Submission;
          rateLimited?: { retryAfterSeconds: number | null };
        }>(
          "POST",
          `security-submissions/${encodeURIComponent(submission.id)}/${path}`,
          body,
        );
        setNeedsGrant(false);
        onUpdated(result.submission);
        if (result.rateLimited)
          setError(rateLimitMessage(result.rateLimited.retryAfterSeconds));
      } catch (caught) {
        if (
          !(caught instanceof ProjectApiError) ||
          caught.code !== "grant_required"
        )
          throw caught;
        setNeedsGrant(true);
      }
    });
  const authorize = () => {
    if (keepDraft && !saveDraft(submission.id, draft)) {
      setError(DRAFT_STORAGE_ERROR);
      return;
    }
    void act(async () => {
      const body = await privateRequest<{ authorizeUrl: string }>(
        "POST",
        `security-submissions/${encodeURIComponent(submission.id)}/authorize`,
        {},
      );
      window.location.assign(body.authorizeUrl);
      return "navigating";
    });
  };
  const canSend =
    !submission.intake &&
    submission.origin === "slop" &&
    (submission.state === "draft" ||
      (submission.state === "failed" &&
        !TERMINAL_FAILURES.includes(submission.failureCode ?? "") &&
        submission.advisory === null));
  const expectedRevision = submission.revision;
  const [expanded, setExpanded] = useState(
    focused || reportNeedsAction(submission),
  );
  useEffect(() => {
    if (focused) setExpanded(true);
  }, [focused]);
  // Reporters file many reports per project; the case reference tells them apart.
  const reportReference = submission.caseId
    ? caseTitle({
        id: submission.caseId,
        advisory: caseRecord?.advisory ?? submission.advisory,
      })
    : (submission.advisory?.ghsa ?? null);
  return (
    <article
      aria-labelledby={`submission-${submission.id}`}
      className={`admin-card security-case${focused ? " is-focused" : ""}`}
    >
      <header className="private-report-heading">
        <h3 id={`submission-${submission.id}`}>
          Private report · {submission.projectId}
          {reportReference ? (
            <>
              {" · "}
              <span title={submission.caseId ?? undefined}>
                {reportReference}
              </span>
            </>
          ) : null}
        </h3>
        {submission.caseId ? (
          <button
            className="text-button"
            type="button"
            onClick={() => onOpenCase(submission.caseId as string)}
          >
            Open case
          </button>
        ) : null}
      </header>
      {caseRecord ? (
        <div className="private-report-next">
          <p className="security-next-step">
            <ArrowRight aria-hidden="true" />
            <span>
              <strong>Next step:</strong> {caseRecord.nextStep}
            </span>
          </p>
          <p className="inbox-meta">
            Award: {awardText(caseRecord)}
            {caseRecord.nextStepDueAt
              ? ` · Due ${formatUtc(caseRecord.nextStepDueAt)}`
              : ""}
          </p>
        </div>
      ) : null}
      {submission.intake && submission.state !== "draft" ? (
        <p className="field-hint">{githubSubmissionStatus(submission)}</p>
      ) : null}
      <details
        open={expanded}
        onToggle={(event) => setExpanded(event.currentTarget.open)}
      >
        <summary className="private-report-summary">
          <span className="admin-status">{submissionStatus(submission)}</span>
        </summary>
        {submission.intake ? (
          <>
            <p className="field-hint">
              Slop receipt · {formatUtc(submission.intake.receivedAt)}
            </p>
            {submission.intake.reason ? (
              <p>{submission.intake.reason}</p>
            ) : null}
            <PrivateReportDetail
              submission={submission}
              onUpdated={onUpdated}
              expanded={focused && readReport}
            />
            {submission.intake.canRetryScreening ? (
              <button
                className="text-button"
                disabled={busy}
                type="button"
                onClick={() =>
                  run("screen", {
                    expectedRevision: submission.intake?.revision,
                  })
                }
              >
                <RotateCcw aria-hidden="true" />{" "}
                {submission.intake.canForward
                  ? "Retry owner notification"
                  : "Retry screening"}
              </button>
            ) : null}
            {submission.intake.canForward &&
            (submission.intake.canAuthorize ?? !submission.intake.canReview) &&
            (submission.state === "draft" ||
              (submission.state === "failed" &&
                !TERMINAL_FAILURES.includes(submission.failureCode ?? "") &&
                submission.advisory === null)) ? (
              <details className="security-reference">
                <summary>
                  {submission.state === "failed"
                    ? "Retry private GitHub delivery"
                    : "Also send privately to GitHub"}
                </summary>
                <p>
                  Optional: authorize GitHub to submit the saved report as you.
                  Your original Slop receipt and review status are retained.
                </p>
                <button
                  className="button secondary-button"
                  disabled={busy}
                  type="button"
                  onClick={authorize}
                >
                  Authorize private GitHub delivery
                </button>
                <button
                  className="text-button"
                  disabled={busy}
                  type="button"
                  onClick={() => run("send", { expectedRevision })}
                >
                  Send saved report to GitHub
                </button>
              </details>
            ) : null}
          </>
        ) : null}
        {submission.advisory ? (
          <p>
            <ExternalLinkAnchor href={submission.advisory.url}>
              {submission.advisory.ghsa}
            </ExternalLinkAnchor>
          </p>
        ) : null}
        {canSend ? (
          <form
            className="security-form"
            onSubmit={(event) => {
              event.preventDefault();
              saveDraft(submission.id, draft);
              run("send", { expectedRevision, report: reportBody(draft) });
            }}
          >
            <IntakeConsent login={session.session.githubLogin} />
            <ReportFields
              draft={draft}
              disabled={busy}
              onChange={(next) => {
                setDraft(next);
                saveDraft(submission.id, next);
              }}
            />
            <button
              className="button primary-button"
              disabled={busy}
              type="submit"
            >
              {submission.state === "failed"
                ? "Fix and resend"
                : "Submit privately"}
            </button>
            <IntakeReferenceNote />
          </form>
        ) : null}
        {submission.origin === "direct" && submission.state === "draft" ? (
          <button
            className="button primary-button"
            disabled={busy}
            onClick={() => run("verify", { expectedRevision })}
            type="button"
          >
            Verify with GitHub
          </button>
        ) : null}
        {submission.state === "uncertain" ||
        submission.state === "submitted" ? (
          <button
            className="button primary-button"
            disabled={busy}
            onClick={() => run("reconcile", { expectedRevision })}
            type="button"
          >
            <RotateCcw aria-hidden="true" /> Check again
          </button>
        ) : null}
        {needsGrant ? (
          <div className="form-error" role="alert">
            <CircleAlert aria-hidden="true" /> Authorize GitHub for this report
            first.
            <button
              className="text-button"
              disabled={busy}
              onClick={authorize}
              type="button"
            >
              Authorize GitHub to submit as you
            </button>
          </div>
        ) : null}
        <FormError message={error} />
      </details>
    </article>
  );
}

/**
 * The reporter's automatic private submissions. Shows nothing while the
 * intake is off, so the manual claim path stays the only path shown.
 */
function SubmissionsPanel({
  session,
  focusId,
  grantError,
  onAvailability,
  onLinkFallback,
  onOpenCase,
  onKnownCases,
  cases,
  filter,
  readReport,
}: {
  filter: ReportFilter;
  readReport: boolean;
  session: Extract<ProjectSessionState, { status: "signed-in" }>;
  cases: SecurityCase[];
  focusId: string | null;
  grantError: string | null;
  onAvailability: (available: boolean) => void;
  /** Whether a report failed in a way GitHub cannot verify automatically. */
  onLinkFallback: (needed: boolean) => void;
  onOpenCase: (caseId: string) => void;
  onKnownCases: (ids: string[]) => void;
}) {
  const privateRequest = usePrivateRequest();
  const [submissions, setSubmissions] = useState<Submission[] | null>(null);
  const [authorityUnavailable, setAuthorityUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    if (submissions === null) return;
    onKnownCases(
      submissions
        .filter((entry) => entry.state !== "abandoned" || entry.id === focusId)
        .flatMap((entry) => (entry.caseId ? [entry.caseId] : [])),
    );
    onLinkFallback(
      submissions.some(
        (entry) =>
          entry.state === "failed" &&
          LINK_FALLBACK_FAILURES.includes(entry.failureCode ?? ""),
      ),
    );
  }, [submissions, onLinkFallback, onKnownCases, focusId]);
  const load = useCallback(() => {
    const current = ++generation.current;
    setError(null);
    privateRequest<{
      recipientGithubId: string;
      automatic: boolean;
      submissions: Submission[];
      authorityUnavailable?: boolean;
    }>("GET", "security-submissions")
      .then(async (body) => {
        if (current !== generation.current) return;
        if (body.recipientGithubId !== session.session.githubId)
          throw new Error("Your account changed. Reload your private reports.");
        // Keep the successful list if a stale receipt link is no longer readable.
        setSubmissions(body.submissions);
        setAuthorityUnavailable(body.authorityUnavailable === true);
        onAvailability(body.automatic === true);
        // The recent list is bounded. A receipt link still identifies an older
        // report; resolve it through its own current authorization check.
        if (
          focusId &&
          !body.submissions.some((entry) => entry.id === focusId)
        ) {
          try {
            const focused = await privateRequest<{ submission: Submission }>(
              "GET",
              `security-submissions/${encodeURIComponent(focusId)}?view=receipt`,
            );
            if (current !== generation.current) return;
            body.submissions = [...body.submissions, focused.submission];
            setSubmissions(body.submissions);
          } catch (caught) {
            if (current === generation.current) setError(errorMessage(caught));
          }
        }
        // Keep a linked report's draft until its authorization check resolves.
        if (current === generation.current) pruneDrafts(body.submissions);
      })
      .catch((caught: unknown) => {
        if (current !== generation.current) return;
        // The manual path stays available whenever the list cannot load.
        onAvailability(false);
        setError(errorMessage(caught));
      });
    return () => {
      generation.current++;
    };
  }, [onAvailability, session.session.githubId, privateRequest, focusId]);
  useEffect(load, [load]);
  if (error && submissions === null)
    return (
      <div className="form-error" role="alert">
        <CircleAlert aria-hidden="true" /> {error}
        <button className="text-button" onClick={load} type="button">
          <RotateCcw aria-hidden="true" /> Retry
        </button>
      </div>
    );
  if (submissions === null)
    return <p role="status">Loading private reports…</p>;
  const shown = submissions.filter(
    (entry) => entry.state !== "abandoned" || entry.id === focusId,
  );
  if (shown.length === 0 && !grantError && !authorityUnavailable && !error)
    return cases.length === 0 ? (
      <p className="admin-status">You have no private reports yet.</p>
    ) : null;
  const ordered = shown
    .filter((submission) => {
      const record = cases.find((record) => record.id === submission.caseId);
      return record ? matchesReport(record, filter) : filter === "all";
    })
    .sort(
      (a, b) =>
        Number(b.id === focusId) - Number(a.id === focusId) ||
        Number(reportNeedsAction(b)) - Number(reportNeedsAction(a)),
    );
  const renderSubmission = (submission: Submission) => (
    <SubmissionCard
      session={session}
      readReport={readReport}
      focused={submission.id === focusId}
      key={submission.id}
      onOpenCase={onOpenCase}
      onUpdated={(updated) =>
        setSubmissions((current) =>
          (current ?? []).map((entry) =>
            entry.id === updated.id ? updated : entry,
          ),
        )
      }
      submission={submission}
      caseRecord={cases.find((record) => record.id === submission.caseId)}
    />
  );
  return (
    <section aria-labelledby="security-submissions" className="admin-section">
      <div className="section-heading">
        <h2 id="security-submissions">Private reports</h2>
        <button className="text-button" onClick={load} type="button">
          <RotateCcw aria-hidden="true" /> Refresh reports
        </button>
      </div>
      {authorityUnavailable ? (
        <p className="form-error" role="status">
          <CircleAlert aria-hidden="true" /> Some maintainer access could not be
          checked. Your own reports are shown.{" "}
          <button className="text-button" onClick={load} type="button">
            Retry access check
          </button>
        </p>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          Report status could not refresh. The previous status is shown. {error}
        </p>
      ) : null}
      {grantError ? (
        <p className="form-error" role="alert">
          <CircleAlert aria-hidden="true" />{" "}
          {GRANT_ERRORS[grantError] ?? GRANT_ERRORS.grant_exchange_failed}
        </p>
      ) : null}
      <p className="field-hint">
        Screening assists review; owners decide awards. GitHub delivery is
        optional.
      </p>
      {ordered.map(renderSubmission)}
    </section>
  );
}

function RecordForm({
  programProjects,
  onCreated,
}: {
  programProjects: ProjectDefinition[];
  onCreated: (created: SecurityCase) => void;
}) {
  const privateRequest = usePrivateRequest();
  const [projectId, setProjectId] = useState(programProjects[0]?.id ?? "");
  const [advisory, setAdvisory] = useState("");
  const [reporterId, setReporterId] = useState("");
  const [reporterLogin, setReporterLogin] = useState("");
  const [receivedAt, setReceivedAt] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [key, setKey] = useState(requestKey);
  const { busy, error, run } = useAction();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const body = await privateRequest<{ case: SecurityCase }>(
        "POST",
        "security-cases",
        {
          mode: "record",
          projectId,
          advisory: advisory.trim(),
          reporterGithubId: reporterId.trim(),
          reporterGithubLogin: reporterLogin.trim(),
          receivedAt: utcInput(receivedAt),
          confirmation: confirmed,
          idempotencyKey: key,
        },
      );
      setKey(requestKey());
      onCreated(body.case);
    });
  };
  return (
    <form className="security-form" onSubmit={submit}>
      <ProjectSelect
        onChange={setProjectId}
        projects={programProjects}
        value={projectId}
      />
      <label>
        GitHub advisory ID
        <input
          autoComplete="off"
          onChange={(event) => setAdvisory(event.target.value)}
          required
          spellCheck={false}
          value={advisory}
        />
      </label>
      <label>
        Reporter GitHub account ID
        <input
          inputMode="numeric"
          onChange={(event) => setReporterId(event.target.value)}
          required
          value={reporterId}
        />
      </label>
      <label>
        Reporter GitHub login
        <input
          onChange={(event) => setReporterLogin(event.target.value)}
          required
          value={reporterLogin}
        />
      </label>
      <label>
        Time GitHub received the report (UTC)
        <input
          onChange={(event) => setReceivedAt(event.target.value)}
          required
          type="datetime-local"
          value={receivedAt}
        />
      </label>
      <label className="checkbox-label">
        <input
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          type="checkbox"
        />
        I checked on GitHub that this advisory exists and that this reporter
        submitted it.
      </label>
      <FormError message={error} />
      <button className="button primary-button" disabled={busy} type="submit">
        {busy ? "Recording…" : "Record verified report"}
      </button>
    </form>
  );
}

type FieldSpec =
  | {
      name: string;
      label: string;
      kind: "text" | "textarea";
      hint?: string;
      optional?: boolean;
      initial?: string;
      when?: { field: string; values: string[] };
    }
  | {
      name: string;
      label: string;
      kind: "select";
      options: [string, string][];
      /** Shown only when another select has one of these values. */
      when?: { field: string; values: string[] };
    }
  | {
      name: string;
      label: string;
      kind: "checkbox";
      when?: { field: string; values: string[] };
    }
  | {
      name: string;
      label: string;
      kind: "utc";
      when?: { field: string; values: string[] };
    }
  | {
      name: string;
      label: string;
      kind: "amount";
      decimals: number;
      hint?: string;
      initial?: string;
      readOnly?: boolean;
      when?: { field: string; values: string[] };
    };

type ActionSpec = { title: string; submit: string; fields: FieldSpec[] };

const REASON: FieldSpec = {
  name: "reason",
  label: "Private reason",
  kind: "textarea",
  hint: "Do not name another reporter or quote another report.",
};

const SEVERITY_OPTIONS: [string, string][] = [
  ["critical", "Critical"],
  ["high", "High"],
  ["medium", "Medium"],
  ["low", "Low"],
  ["informational", "Informational"],
  ["unresolved", "Unresolved"],
];

function actionSpec(action: string, record: SecurityCase): ActionSpec | null {
  const proposal =
    record.analysis?.state === "complete" ? record.analysis : null;
  switch (action) {
    case "verify-link":
      return {
        title: "Verify the GitHub report",
        submit: "Verify report",
        fields: [
          {
            name: "receivedAt",
            label: "Time GitHub received the report (UTC)",
            kind: "utc",
          },
          {
            name: "confirmation",
            label: `I checked on GitHub that ${record.advisory?.ghsa ?? "this advisory"} exists and that @${record.reporter?.githubLogin ?? "the reporter"} submitted it.`,
            kind: "checkbox",
          },
        ],
      };
    case "reject-link":
      return {
        title: "Reject this link",
        submit: "Reject link",
        fields: [REASON],
      };
    case "request-information":
      return {
        title: "Ask the reporter for information",
        submit: "Ask for information",
        fields: [
          {
            name: "reason",
            label: "What you need",
            kind: "textarea",
            hint: record.advisory
              ? "The reporter answers in the private GitHub advisory."
              : "Use the private report review to request further evidence.",
          },
        ],
      };
    case "decide":
      return {
        title: "Decide the finding",
        submit: "Record decision",
        fields: [
          {
            name: "outcome",
            label: "Outcome",
            kind: "select",
            options: [
              ["confirmed", "Confirmed"],
              ["duplicate", "Duplicate"],
              ["out-of-scope", "Out of scope"],
              ["rejected", "Rejected"],
            ],
          },
          {
            name: "severity",
            label: "Severity",
            kind: "select",
            options: [["", "Choose severity"], ...SEVERITY_OPTIONS],
          },
          {
            name: "loss",
            label: "Loss of funds",
            kind: "select",
            options: [
              ["unresolved", "Unresolved"],
              ["verified-potential", "Verified potential loss"],
              ["verified-actual", "Verified actual loss"],
              ["not-verified", "Not verified"],
            ],
          },
          {
            name: "inScope",
            label: "The affected asset is in scope",
            kind: "checkbox",
          },
          {
            name: "relatedParty",
            label:
              "The reporter is a related party (owner, employee, sponsor or approver). An independent reviewer must then approve any award.",
            kind: "checkbox",
          },
          {
            name: "rootCauseKey",
            label: "Root cause key",
            kind: "text",
            optional: true,
            initial: proposal?.rootCauseKey ?? "",
            hint: "Lowercase words and hyphens. Required to confirm.",
          },
          {
            name: "duplicateOf",
            label: "Original case ID",
            kind: "text",
            when: { field: "outcome", values: ["duplicate"] },
            initial: proposal?.duplicateCaseIds[0] ?? "",
          },
          {
            name: "evidenceReference",
            label: "Private evidence reference (optional)",
            kind: "text",
            optional: true,
          },
          REASON,
        ],
      };
    case "award": {
      if (record.terms === null) return null;
      const decimals = record.terms.decimals;
      const fixed = record.terms.fundingPolicy === "after-approval";
      const direct = record.paymentRail === "direct";
      const available = record.awardFunds
        ? money(record.awardFunds.availableMinor, record.awardFunds)
        : "no verified funds";
      return {
        title: "Award",
        submit: "Record award decision",
        fields: [
          {
            name: "decision",
            label: "Decision",
            kind: "select",
            options: [
              [
                "amount",
                fixed ? "Award the published amount" : "Award an amount",
              ],
              ["none", "No award"],
            ],
          },
          {
            name: "grossMinor",
            label: `Gross award (${record.terms.currency})`,
            kind: "amount",
            decimals,
            initial: fixed
              ? formatBaseUnits(record.terms.grossMinor, decimals, {
                  grouping: false,
                })
              : undefined,
            readOnly: fixed,
            hint: direct
              ? fixed
                ? "The published award is fixed."
                : undefined
              : fixed
                ? `The published award is fixed. Available to reserve: ${available}. Without funds, it stays selected and unpaid.`
                : `Available to reserve: ${available}.`,
            when: { field: "decision", values: ["amount"] },
          },
          {
            name: "paymentDeadline",
            label: "Payment deadline (UTC)",
            kind: "utc",
            when: { field: "decision", values: ["amount"] },
          },
          {
            name: "confirmation",
            label: `I approve this award for @${record.reporter?.githubLogin ?? "the reporter"}.${direct ? "" : fixed ? " It remains unpaid until verified funds cover the award." : " Approval reserves the amount now."}`,
            kind: "checkbox",
            when: { field: "decision", values: ["amount"] },
          },
          REASON,
        ],
      };
    }
    case "remediation":
      return {
        title: "Remediation",
        submit: "Save remediation state",
        fields: [
          {
            name: "remediationState",
            label: "Remediation state",
            kind: "select",
            options: [
              ["investigating", "Investigating"],
              ["fixing", "Fixing in a private workspace"],
              ["retest", "Retest"],
              ["resolved", "Resolved (fix merged)"],
              ["mitigation-verified", "Deployed mitigation verified"],
              ["reopened", "Reopened"],
            ],
          },
          {
            name: "evidenceReference",
            label: "Private test or deployment evidence",
            kind: "text",
            optional: true,
            hint: "Required for resolved and for deployed mitigation.",
          },
          { ...REASON, optional: true } as FieldSpec,
        ],
      };
    case "disclosure":
      return {
        title: "Disclosure",
        submit: "Save disclosure decision",
        fields: [
          {
            name: "disclosureState",
            label: "Disclosure state",
            kind: "select",
            options: [
              ["embargoed", "Embargoed"],
              ["redaction-approved", "Redacted text approved"],
              ["disclosed", "Disclosed by the security maintainer"],
            ],
          },
          {
            name: "evidenceReference",
            label: "Private disclosure approval evidence",
            kind: "text",
            hint: "Reference the approval in the private advisory. Do not paste the content here.",
          },
          {
            name: "redactedContentDigest",
            label: "Approved redacted content SHA-256",
            kind: "text",
            optional: true,
            hint: "Required when approving redacted text or recording disclosure.",
          },
          {
            name: "embargoChange",
            label: "Approved embargo change",
            kind: "textarea",
            optional: true,
            hint: "Leave blank if unchanged.",
          },
          REASON,
        ],
      };
    case "assign-triager":
      return {
        title: "Assign a triager",
        submit: "Assign triager",
        fields: [
          {
            name: "githubId",
            label: "Triager GitHub account ID",
            kind: "text",
          },
          { name: "githubLogin", label: "Triager GitHub login", kind: "text" },
        ],
      };
    case "revoke-triager": {
      const active = (record.triagers ?? []).filter(
        (entry) => entry.revokedAt === null,
      );
      if (active.length === 0) return null;
      return {
        title: "Remove a triager",
        submit: "Remove triager",
        fields: [
          {
            name: "githubId",
            label: "Triager",
            kind: "select",
            options: active.map((entry) => [
              entry.githubId,
              `@${entry.githubLogin}`,
            ]),
          },
        ],
      };
    }
    case "recognition":
      return {
        title: "Public recognition",
        submit: "Save my choice",
        fields: [
          {
            name: "recognition",
            label: "Show my name publicly",
            kind: "select",
            // The current choice is listed first, so the form shows it.
            options: (
              [
                ["private", "No, keep my identity private"],
                ["opt-in", "Yes, after authorized disclosure"],
              ] as [string, string][]
            ).sort(([value]) => (value === record.recognition ? -1 : 1)),
          },
        ],
      };
    case "appeal":
      return {
        title: "Appeal this decision",
        submit: "Send appeal",
        fields: [
          {
            name: "reason",
            label: "Why the decision is wrong",
            kind: "textarea",
            hint: "An independent reviewer reads this privately.",
          },
        ],
      };
    case "decide-appeal":
      return {
        title: "Decide the appeal",
        submit: "Record appeal decision",
        fields: [
          {
            name: "outcome",
            label: "Outcome",
            kind: "select",
            options: [
              ["uphold", "Uphold the original decision"],
              ["return", "Return the case for a new decision"],
            ],
          },
          REASON,
        ],
      };
    case "decide-related-party":
      return {
        title: "Related-party award review",
        submit: "Record review",
        fields: [
          {
            name: "outcome",
            label: "Outcome",
            kind: "select",
            options: [
              [
                "approve",
                `Approve ${record.award && record.terms ? money(record.award.grossMinor, record.terms) : "the proposed award"}${record.paymentRail === "direct" ? "" : " and reserve it if funds remain"}`,
              ],
              ["refuse", "Refuse: the reporter is not eligible for this award"],
            ],
          },
          REASON,
        ],
      };
    case "consent-payment":
    case "prepare-payment":
      if (!record.paymentNetworks.length) return null;
      return {
        title:
          action === "consent-payment"
            ? "Accept payment visibility"
            : record.settlement
              ? "Refresh payment request"
              : "Prepare payment",
        submit:
          action === "consent-payment"
            ? "Accept visibility"
            : record.settlement
              ? "Refresh unsigned payment"
              : "Prepare unsigned payment",
        fields: [
          {
            name: "network",
            label: "Payment network",
            kind: "select",
            options: record.paymentNetworks.map((n) => [n, n]),
          },
          {
            name: "confirmation",
            label:
              action === "consent-payment"
                ? record.paymentRail === "direct"
                  ? "I understand that chain transactions reveal my wallet, time and amounts. My report stays private."
                  : "I understand that chain transactions reveal my GitHub actor number, wallet, time and amounts. My report stays private."
                : `I approve ${awardText(record)} on this network. This prepares an unsigned request; it does not pay.`,
            kind: "checkbox",
          },
        ],
      };
    case "verify-payment":
      return {
        title: "Verify payment",
        submit: "Verify payment",
        fields: [
          {
            name: "transactionIds",
            label: "Transaction IDs",
            kind: "textarea",
            hint: "One per line.",
          },
          {
            name: "confirmation",
            label: "These transactions pay the approved award.",
            kind: "checkbox",
          },
        ],
      };
    case "recover-payment": {
      const recovery = record.settlement?.recovery;
      if (
        !recovery ||
        [
          "legacy-manual",
          "consent-required",
          "wallet-required",
          "signature-required",
          "payment-found",
          "fee-pending",
          "retirement-unproven",
          "payer-review",
        ].includes(recovery.mode)
      )
        return null;
      return {
        title: "Recover payment",
        submit:
          recovery.mode === "resume-original"
            ? "Resume original wallet"
            : recovery.mode === "cancellation-required"
              ? "Verify cancellation"
              : recovery.mode === "retirement-required"
                ? "Verify previous transaction"
                : "Check payment recovery",
        fields: [
          ...(["cancellation-required", "retirement-required"].includes(
            recovery.mode,
          )
            ? [
                {
                  name: "cancellationTransactionId",
                  label:
                    recovery.mode === "retirement-required"
                      ? `Previous ${recovery.role === "fee" ? "fee" : "researcher"} transaction ID`
                      : "Cancellation transaction ID",
                  kind: "text" as const,
                },
              ]
            : []),
          {
            name: "confirmation",
            label: "I approve recovery to the payout wallet shown above.",
            kind: "checkbox",
          },
        ],
      };
    }
  }
  return null;
}

function initialValues(spec: ActionSpec): Record<string, string | boolean> {
  const values: Record<string, string | boolean> = {};
  for (const field of spec.fields)
    values[field.name] =
      field.kind === "checkbox"
        ? false
        : field.kind === "select"
          ? field.options[0][0]
          : "initial" in field
            ? (field.initial ?? "")
            : "";
  return values;
}

function utcInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value)) return null;
  return `${value}:00.000Z`;
}

function ActionForm({
  action,
  record,
  onDone,
  headingId,
}: {
  action: string;
  record: SecurityCase;
  onDone: (updated: SecurityCase | null, note: string) => void;
  headingId?: string;
}) {
  const privateRequest = usePrivateRequest();
  const spec = actionSpec(action, record);
  const [values, setValues] = useState(() => (spec ? initialValues(spec) : {}));
  const [key] = useState(requestKey);
  const { busy, error, setError, run } = useAction();
  if (spec === null) return null;
  const shown = (field: FieldSpec) =>
    !("when" in field) ||
    field.when === undefined ||
    field.when.values.includes(String(values[field.when.field]));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const body: Record<string, unknown> = {
      action,
      expectedRevision: record.revision,
      idempotencyKey: key,
    };
    for (const field of spec.fields) {
      if (!shown(field)) continue;
      const value = values[field.name];
      if (action === "verify-payment" && field.name === "transactionIds")
        body[field.name] = String(value).trim().split(/\s+/u).filter(Boolean);
      else if (field.kind === "utc") body[field.name] = utcInput(String(value));
      else if (field.kind === "amount") {
        const minor = decimalToMinor(String(value), field.decimals);
        if (minor === null) {
          setError(`Enter the ${field.label.toLowerCase()} as a number.`);
          return;
        }
        body[field.name] = minor;
      } else if (
        field.kind !== "checkbox" &&
        field.kind !== "select" &&
        field.optional &&
        String(value).trim() === ""
      )
        continue;
      else body[field.name] = value;
    }
    void run(async () => {
      const response = await privateRequest<{ case: SecurityCase }>(
        "POST",
        `security-cases/${encodeURIComponent(record.id)}/actions`,
        body,
      );
      onDone(
        "allowedActions" in response.case ? response.case : null,
        `${spec.title}: saved.`,
      );
    });
  };
  const formId = `${record.id}-${action}`;
  return (
    <form
      aria-labelledby={headingId ?? `${formId}-title`}
      className="security-form security-action"
      data-case-action={action}
      onSubmit={submit}
    >
      {headingId ? null : <h4 id={`${formId}-title`}>{spec.title}</h4>}
      {spec.fields.filter(shown).map((field) => {
        const set = (value: string | boolean) =>
          setValues((current) => ({ ...current, [field.name]: value }));
        if (field.kind === "checkbox")
          return (
            <label className="checkbox-label" key={field.name}>
              <input
                checked={values[field.name] === true}
                onChange={(event) => set(event.target.checked)}
                type="checkbox"
              />
              {field.label}
            </label>
          );
        if (field.kind === "select")
          return (
            <label key={field.name}>
              {field.label}
              <select
                required
                onChange={(event) => set(event.target.value)}
                value={String(values[field.name])}
              >
                {field.options.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          );
        if (field.kind === "utc")
          return (
            <label key={field.name}>
              {field.label}
              <input
                onChange={(event) => set(event.target.value)}
                required
                type="datetime-local"
                value={String(values[field.name])}
              />
            </label>
          );
        const hint =
          "hint" in field && field.hint ? (
            <small className="field-hint">{field.hint}</small>
          ) : null;
        if (field.kind === "amount") {
          const minor = decimalToMinor(
            String(values[field.name]),
            field.decimals,
          );
          const fullAward = isFullAwardSplit(record.terms?.split);
          const exact =
            minor !== null && (fullAward || BigInt(minor) % 4n === 0n);
          return (
            <label key={field.name}>
              {field.label}
              <input
                autoComplete="off"
                inputMode="decimal"
                readOnly={field.readOnly}
                onChange={(event) => set(event.target.value)}
                required
                value={String(values[field.name])}
              />
              {hint}
              {minor !== null && record.terms ? (
                <small className="field-hint" role="status">
                  {exact
                    ? fullAward
                      ? `Researcher ${money(minor, record.terms)} · no Slop share`
                      : `Researcher ${money(((BigInt(minor) * 3n) / 4n).toString(), record.terms)} · Slop ${money((BigInt(minor) / 4n).toString(), record.terms)}`
                    : "This amount cannot be split exactly 75/25."}
                </small>
              ) : null}
            </label>
          );
        }
        if (field.kind === "textarea")
          return (
            <label key={field.name}>
              {field.label}
              <textarea
                onChange={(event) => set(event.target.value)}
                required={!field.optional}
                rows={3}
                value={String(values[field.name])}
              />
              {hint}
            </label>
          );
        return (
          <label key={field.name}>
            {field.label}
            <input
              autoComplete="off"
              onChange={(event) => set(event.target.value)}
              required={!field.optional}
              spellCheck={false}
              value={String(values[field.name])}
            />
            {hint}
          </label>
        );
      })}
      <FormError message={error} />
      <button className="button secondary-button" disabled={busy} type="submit">
        {busy ? "Saving…" : spec.submit}
      </button>
    </form>
  );
}

function caseTitle(record: {
  id: string;
  advisory?: { ghsa: string } | null;
}): string {
  return record.advisory?.ghsa ?? `Case ${record.id.slice(-8)}`;
}

function awardText(record: SecurityCase): string {
  if (record.award === null || record.terms === null)
    return record.paymentRail === "direct" && record.awardState === "approved"
      ? "Approved"
      : (AWARD_LABELS[record.awardState] ?? record.awardState);
  const amount = `${money(record.award.researcherMinor, record.terms)} to the researcher · ${money(record.award.slopMinor, record.terms)} to Slop · ${money(record.award.grossMinor, record.terms)} gross`;
  return record.awardState === "pending"
    ? `${record.relatedPartyReview === "pending" ? "Proposed; awaiting independent review" : record.paymentRail === "direct" ? "Selected; awaiting payment approval" : "Selected; awaiting verified funding"} · ${amount}`
    : amount;
}

function paymentLabel(record: SecurityCase): string {
  if (
    record.paymentRail === "direct" &&
    record.settlement?.state === "awaiting-external-payment"
  )
    return (record.settlement.confirmedTransactionIds?.length ?? 0) > 0
      ? "Partly paid"
      : "Ready for external payment";
  if (
    record.paymentRail === "direct" &&
    record.paymentState === "awaiting-owner-commitment"
  )
    return "Waiting for the payer";
  return PAYMENT_LABELS[record.paymentState] ?? record.paymentState;
}

const RELATED_PARTY_LABELS: Record<SecurityCase["relatedPartyReview"], string> =
  {
    "not-applicable": "No related-party review",
    pending: "Waiting for an independent reviewer",
    approved: "Approved by an independent reviewer",
    refused: "Refused by an independent reviewer",
  };

const LOSS_LABELS: Record<string, string> = {
  likely: "Likely path to loss of funds",
  unlikely: "No path to loss of funds found",
  unclear: "Loss of funds unclear",
};

/** The automatic private analysis, for the owner and triagers only. */
function AnalysisPanel({
  record,
  onRetry,
}: {
  record: SecurityCase;
  onRetry: () => void;
}) {
  const privateRequest = usePrivateRequest();
  const analysis = record.analysis ?? null;
  const { busy, error, run } = useAction();
  const retry = () =>
    void run(async () => {
      await privateRequest<{ case: SecurityCase }>(
        "POST",
        `security-cases/${encodeURIComponent(record.id)}/actions`,
        {
          action: "analyze",
          expectedRevision: record.revision,
          idempotencyKey: requestKey(),
        },
      );
      onRetry();
    });
  return (
    <section aria-labelledby={`analysis-${record.id}`}>
      <h4 id={`analysis-${record.id}`}>Advisory assessment</h4>
      {analysis === null ? (
        <p className="admin-status">No analysis yet.</p>
      ) : analysis.state === "running" ? (
        <p aria-live="polite" className="admin-status">
          Analyzing the private report…
        </p>
      ) : analysis.state === "complete" ? (
        <>
          <p>{analysis.summary}</p>
          <dl className="admin-facts">
            <Fact term="Proposed severity">
              {analysis.proposedSeverity ?? "—"}
            </Fact>
            <Fact term="Loss of funds">
              {analysis.potentialLoss
                ? LOSS_LABELS[analysis.potentialLoss]
                : "—"}
            </Fact>
            <Fact term="Possible duplicates">
              {analysis.duplicateCaseIds.length === 0
                ? "None found"
                : analysis.duplicateCaseIds.join(", ")}
            </Fact>
            <Fact term="Remediation">{analysis.remediation ?? "—"}</Fact>
          </dl>
          <p className="field-hint">
            AI proposal. The report text can try to influence it; you decide.
          </p>
        </>
      ) : (
        <p className="admin-status">
          {analysis.state === "unavailable"
            ? "Analysis unavailable. Run it again later."
            : "The analysis failed."}
        </p>
      )}
      {record.allowedActions.includes("analyze") ? (
        <button
          className="text-button"
          disabled={busy}
          onClick={retry}
          type="button"
        >
          <RotateCcw aria-hidden="true" />{" "}
          {busy ? "Starting…" : "Run the analysis again"}
        </button>
      ) : null}
      <FormError message={error} />
    </section>
  );
}

const ESCALATION_LABELS: Record<string, string> = {
  "private-security-case": "Every private security case goes to a moderator",
  "confidence-below-floor": "Slopbot's confidence is below 0.9",
};

/**
 * Slopbot's first triage of an open appeal (PRD section 8). It is a draft
 * for the moderator who decides; it never decides the appeal.
 */
function AppealTriagePanel({
  record,
  onRetry,
}: {
  record: SecurityCase;
  onRetry: () => void;
}) {
  const privateRequest = usePrivateRequest();
  const triage = record.appealTriage ?? null;
  const { busy, error, run } = useAction();
  const retry = () =>
    void run(async () => {
      await privateRequest<{ case: SecurityCase }>(
        "POST",
        `security-cases/${encodeURIComponent(record.id)}/actions`,
        {
          action: "triage-appeal",
          expectedRevision: record.revision,
          idempotencyKey: requestKey(),
        },
      );
      onRetry();
    });
  return (
    <section aria-labelledby={`appeal-triage-${record.id}`}>
      <h4 id={`appeal-triage-${record.id}`}>Slopbot appeal triage</h4>
      {triage === null ? (
        <p className="admin-status">No appeal triage yet.</p>
      ) : triage.state === "running" ? (
        <p aria-live="polite" className="admin-status">
          Slopbot is drafting a resolution…
        </p>
      ) : triage.state === "complete" ? (
        <>
          <dl className="admin-facts">
            <Fact term="Drafted resolution">
              {triage.proposedOutcome === "return"
                ? "Return the case for a new technical review"
                : "Keep the decision"}
            </Fact>
            <Fact term="Confidence">
              {triage.confidence === null
                ? "—"
                : `${Math.round(triage.confidence * 100)}%`}
            </Fact>
            <Fact term="Escalated to a moderator">
              {triage.escalationReasons
                .map((reason) => ESCALATION_LABELS[reason] ?? reason)
                .join("; ")}
            </Fact>
          </dl>
          <p>{triage.rationale}</p>
          <p className="field-hint">
            Slopbot draft. The appeal text can try to influence it; a moderator
            decides.
          </p>
        </>
      ) : (
        <p className="admin-status">
          {triage.state === "unavailable"
            ? "Slopbot triage is unavailable. A moderator decides without a draft."
            : "The appeal triage failed. A moderator decides without a draft."}
        </p>
      )}
      {record.allowedActions.includes("triage-appeal") ? (
        <button
          className="text-button"
          disabled={busy}
          onClick={retry}
          type="button"
        >
          <RotateCcw aria-hidden="true" />{" "}
          {busy ? "Starting…" : "Run the appeal triage again"}
        </button>
      ) : null}
      <FormError message={error} />
    </section>
  );
}

/** Order common decisions first while keeping one action visible at a time. */
const PRIMARY_ACTIONS = [
  "verify-link",
  "reject-link",
  "request-information",
  "decide",
  "award",
  "remediation",
  "decide-appeal",
  "decide-related-party",
  "prepare-payment",
  "verify-payment",
  "recover-payment",
  "consent-payment",
  "appeal",
];

function CaseActions({
  record,
  disclosureRelevant,
  onDone,
}: {
  record: SecurityCase;
  disclosureRelevant: boolean;
  onDone: (updated: SecurityCase | null, note: string) => void;
}) {
  const available = record.allowedActions.filter(
    (action) => actionSpec(action, record) !== null,
  );
  const actions = [
    ...available.filter(
      (action) =>
        PRIMARY_ACTIONS.includes(action) ||
        (action === "disclosure" && disclosureRelevant),
    ),
    ...available.filter(
      (action) =>
        !PRIMARY_ACTIONS.includes(action) &&
        !(action === "disclosure" && disclosureRelevant),
    ),
  ];
  const [selected, setSelected] = useState(actions[0] ?? "");
  const active = actions.includes(selected) ? selected : (actions[0] ?? "");
  if (!active) return null;
  return (
    <section className="security-actions" aria-label="Case actions">
      <fieldset className="report-form-actions">
        <legend>Review actions</legend>
        {actions
          .filter((action) => PRIMARY_ACTIONS.includes(action))
          .map((action) => (
            <button
              type="button"
              className="button secondary-button"
              aria-pressed={active === action}
              data-case-action-selector={action}
              onClick={() => setSelected(action)}
              key={action}
            >
              {actionSpec(action, record)?.title}
            </button>
          ))}
      </fieldset>
      {actions.some((action) => !PRIMARY_ACTIONS.includes(action)) ? (
        <details open={!PRIMARY_ACTIONS.includes(active)}>
          <summary>Other case actions</summary>
          <label>
            Action
            <select
              value={active}
              onChange={(event) => setSelected(event.target.value)}
            >
              {actions.map((action) => (
                <option key={action} value={action}>
                  {actionSpec(action, record)?.title}
                </option>
              ))}
            </select>
          </label>
        </details>
      ) : null}
      {actions.map((action) => (
        <div hidden={action !== active} key={`${action}-${record.revision}`}>
          <ActionForm action={action} record={record} onDone={onDone} />
        </div>
      ))}
    </section>
  );
}

function recoveryMessage(
  mode: string,
  payer: boolean,
  reporter: boolean,
): string {
  switch (mode) {
    case "wallet-required":
      return reporter
        ? "Confirm your payout wallet in Settings."
        : "Waiting for the reporter's verified payout wallet.";
    case "consent-required":
      return reporter
        ? "Accept payment visibility for this payout wallet."
        : "Waiting for the reporter to accept payment visibility for this wallet.";
    case "fee-pending":
      return payer
        ? "Pay and verify the unchanged fee first."
        : "Waiting for the payer to verify the unchanged fee.";
    case "retirement-required":
      return payer
        ? "This wallet nonce was used. Verify its failed or cancelled transaction before preparing a replacement."
        : "Waiting for verification of the previous wallet transaction.";
    case "retirement-unproven":
      return payer
        ? "Verify any payment already sent. This consumed wallet nonce needs manual review before a replacement."
        : "The previous wallet transaction needs review.";
    case "payer-review":
      return "The payer wallet needs manual review before recovery. Existing payments can still be verified.";
    case "legacy-manual":
      return "This older payment request requires manual review. Existing transfers can still be verified.";
    case "resume-original":
      return payer
        ? "Resume the original verified payout wallet."
        : "Waiting for the payer to resume the original wallet.";
    case "cancellation-required":
      return payer
        ? "Cancel the old transfer before sending to this wallet."
        : "Waiting for the payer to cancel the old transfer.";
    case "payment-found":
      return payer
        ? "An existing payment was found. Verify it before continuing."
        : "Waiting for verification of an existing payment.";
    case "signature-required":
    case "history-check":
      return payer
        ? "Check the finalized history of the expired request."
        : "Waiting for the payer to check the expired request.";
    default:
      return payer
        ? "Wait for the old transaction to expire, then check payment recovery."
        : "Waiting for the old transaction to expire.";
  }
}

function CaseDetail({
  caseId,
  onChanged,
}: {
  caseId: string;
  onChanged: () => void;
}) {
  const privateRequest = usePrivateRequest();
  const recoveryAction = useAction();
  const [state, reload, replace] = useSecurityData<{ case: SecurityCase }>(
    `security-cases/${encodeURIComponent(caseId)}`,
  );
  const [note, setNote] = useState<string | null>(null);
  if (state.status === "loading")
    return (
      <p aria-live="polite" className="admin-status">
        Loading case…
      </p>
    );
  if (state.status === "signed-out")
    return (
      <p className="form-error" role="alert">
        <CircleAlert aria-hidden="true" /> Your session ended. Sign in again.
      </p>
    );
  if (state.status === "error")
    return (
      <div className="form-error" role="alert">
        <CircleAlert aria-hidden="true" /> {state.message}
        <button className="text-button" onClick={reload} type="button">
          <RotateCcw aria-hidden="true" /> Retry
        </button>
      </div>
    );
  const record = state.value.case;
  const owner = record.view === "restricted";
  const canPay =
    record.viewerRoles.includes("financial") ||
    record.viewerRoles.includes("security-maintainer");
  const directRequest = record.settlement?.ownerRequest as
    | DirectOwnerRequest
    | null
    | undefined;
  const canSendEvm =
    record.paymentRail === "direct" &&
    record.settlement?.generation !== undefined &&
    !["retirement-required", "retirement-unproven"].includes(
      record.settlement.recovery?.mode ?? "",
    ) &&
    Array.isArray(directRequest?.transactions) &&
    directRequest.transactions.every(
      (transaction) =>
        typeof transaction.nonce === "string" &&
        typeof transaction.chainId === "string",
    );
  const canSendSolana =
    record.paymentRail === "direct" &&
    record.settlement?.generation !== undefined &&
    typeof directRequest?.solana?.transaction === "string" &&
    typeof directRequest.solana.messageId === "string";
  const authorizeExistingPayment = async () => {
    const current = await privateRequest<{ case: SecurityCase }>(
      "GET",
      `security-cases/${encodeURIComponent(record.id)}`,
    );
    if (
      !current.case.allowedActions.includes("verify-payment") ||
      current.case.settlement?.generation !== record.settlement?.generation
    ) {
      replace(current);
      onChanged();
      throw new Error("The payment state changed. Review the current case.");
    }
  };
  const verifyExistingPayment = async (hashes: string[]) => {
    const current = await privateRequest<{ case: SecurityCase }>(
      "GET",
      `security-cases/${encodeURIComponent(record.id)}`,
    );
    if (
      !current.case.allowedActions.includes("verify-payment") ||
      current.case.settlement?.generation !== record.settlement?.generation
    ) {
      replace(current);
      onChanged();
      throw new Error("The payment state changed. Review the current case.");
    }
    const response = await privateRequest<{ case: SecurityCase }>(
      "POST",
      `security-cases/${encodeURIComponent(record.id)}/actions`,
      {
        action: "verify-payment",
        expectedRevision: current.case.revision,
        idempotencyKey: requestKey(),
        transactionIds: hashes,
        confirmation: true,
      },
    );
    replace(response);
    onChanged();
  };
  const response = [...(record.events ?? [])]
    .reverse()
    .find((event) => RESPONSE_KINDS.has(event.kind) && event.reason);
  // Disclosure is shown once a fix exists or a decision was recorded.
  const disclosureRelevant =
    ["resolved", "mitigation-verified"].includes(
      record.remediationState ?? "",
    ) || record.disclosureState !== "embargoed";
  return (
    <article
      aria-labelledby={`case-${record.id}`}
      className="admin-card security-case"
    >
      <header>
        <h3 id={`case-${record.id}`}>
          {caseTitle(record)} · {record.projectId}
        </h3>
        <StatusBadge icon={<LockKeyhole />}>Private case</StatusBadge>
      </header>
      {note ? (
        <p className="admin-status" role="status">
          {note}
        </p>
      ) : null}
      <p className="security-next-step">
        <ArrowRight aria-hidden="true" />
        <span>
          <strong>Next step:</strong> {record.nextStep}
          {record.nextStepDueAt ? (
            <span className="security-due">
              {" "}
              Due {formatUtc(record.nextStepDueAt)}.
            </span>
          ) : null}
        </span>
      </p>
      <dl className="admin-facts">
        <Fact term="Receipt">
          <StatusBadge
            tone={record.submissionState === "verified" ? "success" : "warning"}
          >
            {record.receivedAtSource === "slop-received"
              ? "Received by Slop"
              : SUBMISSION_LABELS[record.submissionState]}
          </StatusBadge>
          {record.receivedAt
            ? ` ${formatUtc(record.receivedAt)}${record.receivedAtSource === "maintainer-attested" ? RECEIVED_AT_SOURCE_LABELS["maintainer-attested"] : ""}`
            : ""}
          {record.advisory ? (
            <>
              {" · "}
              <ExternalLinkAnchor href={record.advisory.url}>
                GitHub advisory
              </ExternalLinkAnchor>
            </>
          ) : null}
        </Fact>
        {record.receiptState ? (
          <Fact term="Owner response">
            {RECEIPT_LABELS[record.receiptState] ?? record.receiptState}
            {response?.reason ? ` — “${response.reason}”` : ""}
          </Fact>
        ) : null}
        <Fact term="Award">{awardText(record)}</Fact>
        {record.relatedParty === "related" &&
        record.relatedPartyReview !== "not-applicable" ? (
          <Fact term="Related party">
            {RELATED_PARTY_LABELS[record.relatedPartyReview]}
          </Fact>
        ) : null}
        <Fact term="Payout">
          <StatusBadge
            tone={record.paymentState === "paid" ? "success" : "neutral"}
          >
            {paymentLabel(record)}
          </StatusBadge>
          {record.paymentDeadline
            ? ` · deadline ${formatUtc(record.paymentDeadline)}`
            : ""}
        </Fact>
      </dl>
      {record.award && record.terms ? (
        <section className="security-offer" aria-label="Award and payment">
          <h4>Award and payment</h4>
          <dl className="admin-facts">
            <Fact term="Researcher receives">
              {money(record.award.researcherMinor, record.terms)}
            </Fact>
            <Fact term="Total award">
              {money(record.award.grossMinor, record.terms)}
            </Fact>
            <Fact term="Slop share">
              {money(record.award.slopMinor, record.terms)}
            </Fact>
            <Fact term="Payment status">{paymentLabel(record)}</Fact>
          </dl>
          <p>Approval and funding are separate from finalized payment.</p>
        </section>
      ) : null}
      {owner ? (
        <AnalysisPanel
          onRetry={() => {
            reload();
            onChanged();
          }}
          record={record}
        />
      ) : null}
      {owner && record.appealState === "open" ? (
        <AppealTriagePanel
          onRetry={() => {
            reload();
            onChanged();
          }}
          record={record}
        />
      ) : null}
      {record.allowedActions.includes("check-receipt") ? (
        <CheckReceipt onDone={reload} record={record} />
      ) : null}
      {record.settlement ? (
        <section
          aria-label="Private payment"
          className="security-payment-panel"
        >
          <h4>Payment</h4>
          <p className="operations-muted">{record.settlement.privacyNotice}</p>
          {record.viewerRoles.includes("reporter") &&
          record.settlement.state !== "paid" ? (
            <p>
              <Link href="/account#wallets">Review your payout wallet</Link>
            </p>
          ) : null}
          <dl className="operations-facts">
            <Fact term="Network">{record.settlement.network}</Fact>
            {record.paymentRail === "direct" &&
            record.settlement.remainingTransfers ? (
              <Fact term="Progress">
                {record.settlement.confirmedTransactionIds?.length ?? 0}{" "}
                transaction(s) confirmed ·{" "}
                {record.settlement.remainingTransfers.length} transfer(s)
                remaining
              </Fact>
            ) : null}
            {(
              record.settlement.transactionIds ??
              (record.settlement.transactionId
                ? [record.settlement.transactionId]
                : [])
            ).map((transactionId) => (
              <Fact term="Finalized transaction" key={transactionId}>
                <CopyIdentifier
                  label="payment transaction ID"
                  value={transactionId}
                />
              </Fact>
            ))}
          </dl>
          {record.settlement.recovery ? (
            <fieldset
              className="security-payment-recovery"
              aria-label="Payment recovery"
            >
              <legend>Payment recovery</legend>
              {record.settlement.recovery.target ? (
                <CopyIdentifier
                  label={
                    record.settlement.recovery.role === "fee"
                      ? "fee wallet"
                      : "current payout wallet"
                  }
                  value={record.settlement.recovery.target.address}
                />
              ) : null}
              <p role="status">
                {recoveryMessage(
                  record.settlement.recovery.mode,
                  canPay,
                  record.viewerRoles.includes("reporter"),
                )}
              </p>
              {record.settlement.recovery.mode === "wallet-required" ? (
                <Link href="/account#wallets">Review payout wallet</Link>
              ) : null}
              {record.settlement.recovery.mode === "payment-found" &&
              record.settlement.recovery.transactionIds?.length &&
              (record.viewerRoles.includes("financial") ||
                record.viewerRoles.includes("security-maintainer")) ? (
                <button
                  className="button secondary-button"
                  type="button"
                  disabled={recoveryAction.busy}
                  onClick={() =>
                    void recoveryAction.run(async () => {
                      const value = await privateRequest<{
                        case: SecurityCase;
                      }>(
                        "POST",
                        `security-cases/${encodeURIComponent(record.id)}/actions`,
                        {
                          action: "verify-payment",
                          expectedRevision: record.revision,
                          idempotencyKey: requestKey(),
                          confirmation: true,
                          transactionIds:
                            record.settlement?.recovery?.transactionIds,
                        },
                      );
                      replace(value);
                      onChanged();
                    })
                  }
                >
                  Verify found payment
                </button>
              ) : null}
              <FormError message={recoveryAction.error} />
              {record.settlement.recovery.payer &&
              record.settlement.recovery.messages?.length &&
              ["signature-required", "history-check"].includes(
                record.settlement.recovery.mode,
              ) &&
              (record.viewerRoles.includes("financial") ||
                record.viewerRoles.includes("security-maintainer")) ? (
                <SolanaBountyRecovery
                  key={`history:${record.id}:${record.settlement.recovery.generation}`}
                  caseId={record.id}
                  generation={record.settlement.recovery.generation}
                  payer={record.settlement.recovery.payer}
                  messages={record.settlement.recovery.messages}
                  authorize={async () => {
                    const current = await privateRequest<{
                      case: SecurityCase;
                    }>(
                      "GET",
                      `security-cases/${encodeURIComponent(record.id)}`,
                    );
                    if (
                      !current.case.allowedActions.includes(
                        "recover-payment",
                      ) ||
                      current.case.settlement?.recovery?.generation !==
                        record.settlement?.recovery?.generation ||
                      JSON.stringify(
                        current.case.settlement?.recovery?.messages,
                      ) !==
                        JSON.stringify(record.settlement?.recovery?.messages)
                    ) {
                      replace(current);
                      onChanged();
                      throw new Error(
                        "The recovery request changed. Refresh before signing.",
                      );
                    }
                  }}
                  verify={async (signatures) => {
                    const response = await privateRequest<{
                      case: SecurityCase;
                    }>(
                      "POST",
                      `security-cases/${encodeURIComponent(record.id)}/actions`,
                      {
                        action: "recover-payment",
                        expectedRevision: record.revision,
                        idempotencyKey: requestKey(),
                        confirmation: true,
                        signatures,
                      },
                    );
                    replace(response);
                    onChanged();
                  }}
                />
              ) : null}
              {record.settlement.recovery.mode === "cancellation-required" &&
              record.settlement.recovery.consented &&
              record.settlement.recovery.cancellationRequest &&
              (record.viewerRoles.includes("financial") ||
                record.viewerRoles.includes("security-maintainer")) ? (
                <>
                  <CopyButton
                    label="cancellation request"
                    text={JSON.stringify(
                      record.settlement.recovery.cancellationRequest,
                      null,
                      2,
                    )}
                  />
                  <DirectBountyPayment
                    key={`recovery:${record.id}:${record.settlement.recovery.generation}`}
                    caseId={record.id}
                    generation={record.settlement.recovery.generation}
                    payer={record.settlement.recovery.cancellationRequest.from}
                    transactions={[
                      record.settlement.recovery.cancellationRequest,
                    ]}
                    cancellation
                    authorize={async () => {
                      const current = await privateRequest<{
                        case: SecurityCase;
                      }>(
                        "GET",
                        `security-cases/${encodeURIComponent(record.id)}`,
                      );
                      if (
                        !current.case.allowedActions.includes(
                          "recover-payment",
                        ) ||
                        current.case.settlement?.recovery?.generation !==
                          record.settlement?.recovery?.generation ||
                        JSON.stringify(
                          current.case.settlement?.recovery
                            ?.cancellationRequest,
                        ) !==
                          JSON.stringify(
                            record.settlement?.recovery?.cancellationRequest,
                          )
                      ) {
                        replace(current);
                        onChanged();
                        throw new Error(
                          "The recovery request changed. Refresh the case before signing.",
                        );
                      }
                    }}
                    authorizeVerification={async () => {
                      const current = await privateRequest<{
                        case: SecurityCase;
                      }>(
                        "GET",
                        `security-cases/${encodeURIComponent(record.id)}`,
                      );
                      const previous = record.settlement?.recovery;
                      const next = current.case.settlement?.recovery;
                      if (
                        !current.case.allowedActions.includes(
                          "recover-payment",
                        ) ||
                        next?.generation !== previous?.generation ||
                        next?.legIndex !== previous?.legIndex ||
                        (next?.cancellationRequest?.nonce ??
                          next?.retirementNonce) !==
                          previous?.cancellationRequest?.nonce
                      ) {
                        replace(current);
                        onChanged();
                        throw new Error(
                          "The recovery changed. Review its current state.",
                        );
                      }
                    }}
                    verify={async (hashes) => {
                      if (hashes.length !== 1)
                        throw new Error(
                          "Provide the exact cancellation transaction.",
                        );
                      const response = await privateRequest<{
                        case: SecurityCase;
                      }>(
                        "POST",
                        `security-cases/${encodeURIComponent(record.id)}/actions`,
                        {
                          action: "recover-payment",
                          expectedRevision: record.revision,
                          idempotencyKey: requestKey(),
                          confirmation: true,
                          cancellationTransactionId: hashes[0],
                        },
                      );
                      replace(response);
                      onChanged();
                    }}
                  />
                </>
              ) : null}
            </fieldset>
          ) : null}
          {!canSendEvm &&
          !canSendSolana &&
          record.settlement.generation !== undefined &&
          record.paymentRail === "direct" &&
          canPay &&
          record.allowedActions.includes("verify-payment") ? (
            <BountySubmittedPayments
              caseId={record.id}
              generation={record.settlement.generation}
              solana={record.settlement.network.startsWith("solana")}
              confirmed={record.settlement.confirmedTransactionIds ?? []}
              authorize={authorizeExistingPayment}
              verify={verifyExistingPayment}
            />
          ) : null}
          {record.settlement.ownerRequest &&
          (record.viewerRoles.includes("financial") ||
            record.viewerRoles.includes("security-maintainer")) ? (
            <>
              <UnsignedPaymentRequest
                request={record.settlement.ownerRequest}
              />
              {canSendEvm && record.settlement.generation !== undefined ? (
                <DirectBountyPayment
                  key={`${record.id}:${record.settlement.generation}`}
                  caseId={record.id}
                  generation={record.settlement.generation}
                  payer={
                    (
                      record.settlement
                        .ownerRequest as unknown as DirectOwnerRequest
                    ).payer.address
                  }
                  transactions={
                    record.settlement.ownerRequest
                      .transactions as DirectEvmTransaction[]
                  }
                  authorize={async () => {
                    const current = await privateRequest<{
                      case: SecurityCase;
                    }>(
                      "GET",
                      `security-cases/${encodeURIComponent(record.id)}`,
                    );
                    if (
                      !current.case.allowedActions.includes("verify-payment") ||
                      current.case.settlement?.generation !==
                        record.settlement?.generation ||
                      JSON.stringify(
                        current.case.settlement?.ownerRequest?.transactions,
                      ) !==
                        JSON.stringify(
                          record.settlement?.ownerRequest?.transactions,
                        )
                    ) {
                      replace(current);
                      onChanged();
                      throw new Error(
                        "The payment request changed. Refresh the case before signing.",
                      );
                    }
                  }}
                  authorizeVerification={authorizeExistingPayment}
                  verify={verifyExistingPayment}
                />
              ) : null}
              {canSendSolana && record.settlement.generation !== undefined ? (
                <SolanaBountyPayment
                  key={`solana:${record.id}:${record.settlement.generation}:${(record.settlement.ownerRequest as unknown as DirectOwnerRequest).solana?.messageId}`}
                  caseId={record.id}
                  generation={record.settlement.generation}
                  payer={
                    (
                      record.settlement
                        .ownerRequest as unknown as DirectOwnerRequest
                    ).payer.address
                  }
                  plan={
                    (
                      record.settlement
                        .ownerRequest as unknown as DirectOwnerRequest
                    ).solana as DirectSolanaPlan
                  }
                  authorize={async () => {
                    const current = await privateRequest<{
                      case: SecurityCase;
                    }>(
                      "GET",
                      `security-cases/${encodeURIComponent(record.id)}`,
                    );
                    if (
                      !current.case.allowedActions.includes("verify-payment") ||
                      current.case.settlement?.generation !==
                        record.settlement?.generation ||
                      JSON.stringify(
                        current.case.settlement?.ownerRequest?.solana,
                      ) !==
                        JSON.stringify(record.settlement?.ownerRequest?.solana)
                    ) {
                      replace(current);
                      onChanged();
                      throw new Error(
                        "The payment request changed. Review its current state before signing.",
                      );
                    }
                  }}
                  authorizeVerification={authorizeExistingPayment}
                  verify={(signature) => verifyExistingPayment([signature])}
                />
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}
      <CaseActions
        record={record}
        disclosureRelevant={disclosureRelevant}
        onDone={(updated, saved) => {
          setNote(saved);
          if (updated) replace({ case: updated });
          else reload();
          onChanged();
        }}
      />
      <details className="security-reference">
        <summary>Case details and history</summary>
        <dl className="admin-facts">
          <Fact term="Case">
            <CopyIdentifier label="case ID" value={record.id} />
          </Fact>
          <Fact term="Program terms at receipt">
            {record.terms
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
          {record.reporter ? (
            <Fact term="Reporter">@{record.reporter.githubLogin}</Fact>
          ) : null}
          {record.payee ? (
            <Fact term="Payee">@{record.payee.githubLogin}</Fact>
          ) : null}
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
        {record.events && record.events.length > 0 ? (
          <ol className="security-history">
            {record.events.map((event) => (
              <li key={event.revision}>
                {formatUtc(event.at)} ·{" "}
                {event.kind === "submit" &&
                record.receivedAtSource === "slop-received"
                  ? "Reporter submitted privately to Slop"
                  : (EVENT_LABELS[event.kind] ?? event.kind)}
                {event.reason ? ` — ${event.reason}` : ""}
                {event.evidenceReference
                  ? ` (evidence: ${event.evidenceReference})`
                  : ""}
                {event.kind === "disclosure" &&
                event.detail?.redactedContentDigest
                  ? ` (approved content SHA-256: ${event.detail.redactedContentDigest})`
                  : ""}
                {event.kind === "disclosure" && event.detail?.embargoChange
                  ? ` (embargo change: ${event.detail.embargoChange})`
                  : ""}
              </li>
            ))}
          </ol>
        ) : null}
      </details>
    </article>
  );
}

/** Settles a link from before automatic receipt against GitHub. */
function CheckReceipt({
  record,
  onDone,
}: {
  record: SecurityCase;
  onDone: () => void;
}) {
  const privateRequest = usePrivateRequest();
  const { busy, error, run } = useAction();
  const check = () =>
    void run(async () => {
      await privateRequest(
        "POST",
        `security-cases/${encodeURIComponent(record.id)}/actions`,
        {
          action: "check-receipt",
          expectedRevision: record.revision,
          idempotencyKey: requestKey(),
        },
      );
      onDone();
    });
  return (
    <div>
      <button
        className="button secondary-button"
        disabled={busy}
        onClick={check}
        type="button"
      >
        {busy ? "Checking GitHub…" : "Confirm with GitHub"}
      </button>
      <FormError message={error} />
    </div>
  );
}

/** The signed-in private case inbox. */
export function SecurityInbox({
  embedded = false,
  expectedActorId,
  onIdentityChange,
}: {
  embedded?: boolean;
  expectedActorId?: string;
  onIdentityChange?: (actorId: string | null) => void;
}) {
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const session = useProjectSession(sessionEpoch);
  usePrivateDraftSession(session);
  const [problem, setProblem] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const actorId =
    session.status === "signed-in" ? session.session.githubId : null;
  const refreshIdentity = useCallback(() => {
    setProblem(null);
    setSessionEpoch((value) => value + 1);
  }, []);
  useEffect(() => {
    if (embedded) return;
    window.addEventListener("focus", refreshIdentity);
    return () => window.removeEventListener("focus", refreshIdentity);
  }, [embedded, refreshIdentity]);
  useEffect(() => {
    if (session.status === "signed-out") onIdentityChange?.(null);
    else if (
      session.status === "signed-in" &&
      expectedActorId &&
      actorId !== expectedActorId
    )
      onIdentityChange?.(actorId);
  }, [session.status, actorId, expectedActorId, onIdentityChange]);
  const privateRequest = useCallback(
    async <T,>(
      method: "GET" | "POST" | "PUT",
      path: string,
      body?: unknown,
    ): Promise<T> => {
      if (actorId === null)
        throw new Error("Sign in before accessing private reports.");
      const verifyIdentity = async () => {
        let current: Awaited<ReturnType<typeof currentProjectSession>>;
        try {
          current = await currentProjectSession();
        } catch {
          if (mounted.current)
            setProblem(
              "Your private session could not be verified. Retry before viewing reports.",
            );
          throw new Error("Your private session could not be verified.");
        }
        if (!mounted.current)
          throw new Error("This private report view was closed.");
        if (!current || current.githubId !== actorId) {
          clearAllDrafts();
          setProblem(
            "Your account changed or signed out. Reload your private reports.",
          );
          onIdentityChange?.(current?.githubId ?? null);
          throw new Error("Your account changed or signed out.");
        }
      };
      await verifyIdentity();
      let value: T;
      try {
        value = await projectApiRequest<T>(method, path, body, {
          expectedActorGithubId: actorId,
        });
      } catch (cause) {
        const missingReceipt =
          method === "GET" &&
          /^security-submissions\/ss_[A-Za-z0-9_-]+\?view=receipt$/u.test(
            path,
          ) &&
          cause instanceof ProjectApiError &&
          cause.status === 404;
        if (
          cause instanceof ProjectApiError &&
          [401, 403, 404, 410].includes(cause.status) &&
          !missingReceipt
        ) {
          if (mounted.current) {
            setProblem(
              "Private report access changed. Reload your private reports.",
            );
            if (cause.status === 401) {
              clearAllDrafts();
              onIdentityChange?.(null);
            }
          }
          throw cause;
        }
        // A missing receipt may be a stale deep link. Keep the fresh list,
        // or a transient view, only after verifying the same account again.
        await verifyIdentity();
        throw cause;
      }
      await verifyIdentity();
      const identity = value as {
        recipientGithubId?: string;
        viewer?: { githubId?: string };
      } | null;
      if (
        identity &&
        ((identity.recipientGithubId &&
          identity.recipientGithubId !== actorId) ||
          (identity.viewer?.githubId && identity.viewer.githubId !== actorId))
      ) {
        setProblem(
          "This private response belongs to another account. Reload your private reports.",
        );
        throw new Error("Private report account mismatch.");
      }
      return value;
    },
    [actorId, onIdentityChange],
  );
  let body: ReactNode;
  if (problem)
    body = (
      <div className="form-error" role="alert">
        <p>{problem}</p>
        <button className="text-button" type="button" onClick={refreshIdentity}>
          Retry private session
        </button>
      </div>
    );
  else if (
    session.status === "signed-in" &&
    (!expectedActorId || actorId === expectedActorId)
  )
    body = (
      <PrivateRequestContext.Provider value={privateRequest}>
        <SecurityInboxContent
          embedded={embedded}
          session={session}
          key={actorId}
        />
      </PrivateRequestContext.Provider>
    );
  else if (session.status === "checking" || session.status === "signed-in")
    body = <p role="status">Checking private session…</p>;
  else
    body = (
      <SignInPanel
        next={embedded ? "/inbox?view=reports" : "/security"}
        purpose="Sign in to see your security cases."
        state={session}
      />
    );
  return embedded ? (
    <section
      className="security-page operations-page"
      aria-label="Private security reports"
    >
      {body}
    </section>
  ) : (
    <main className="shell route-main admin-page security-page operations-page">
      <RoutePageHeader icon={<LockKeyhole />} title="Security cases" />
      {body}
    </main>
  );
}

function SecurityInboxContent({
  embedded,
  session,
}: {
  embedded: boolean;
  session: ProjectSessionState;
}) {
  const [filter, setFilter] = useState<ReportFilter>("all");
  const [list, reload] = useSecurityData<CaseList>(
    session.status === "signed-in" ? "security-cases" : null,
  );
  const [selected, setSelected] = useState<string | null>(() => {
    const id = new URLSearchParams(window.location.search).get("case");
    return id && /^sc_[A-Za-z0-9_-]{8,72}$/u.test(id) ? id : null;
  });
  const [note, setNote] = useState<string | null>(null);
  const [knownSubmissionCases, setKnownSubmissionCases] = useState<string[]>(
    [],
  );
  // `null` until the submission list answers; false while intake is off.
  const [automatic, setAutomatic] = useState<boolean | null>(null);
  // The maintainer-verified link appears only after automatic verification
  // cannot run: a failed submission or a repository without the intake app.
  const [linkFallback, setLinkFallback] = useState(false);
  const [directUnavailable, setDirectUnavailable] = useState(false);
  // GitHub's authorization returns here with the submission and any error.
  const [returned] = useState(() => {
    const query = new URLSearchParams(window.location.search);
    const submission = query.get("submission");
    const intake = query.get("intake");
    return {
      submission:
        submission && /^ss_[A-Za-z0-9_-]{8,72}$/u.test(submission)
          ? submission
          : null,
      error: intake && /^grant_[a-z_]{3,40}$/u.test(intake) ? intake : null,
    };
  });
  const openCase = useCallback(
    (caseId: string) => {
      setSelected(caseId);
      const query = new URLSearchParams(window.location.search);
      query.set("case", caseId);
      window.history.replaceState(
        window.history.state,
        "",
        `${embedded ? "/inbox" : "/security"}?${query}`,
      );
      reload();
    },
    [reload, embedded],
  );
  const created = (record: SecurityCase) => {
    setSelected(record.id);
    setNote("Report saved.");
    reload();
  };
  const programProjects = useMemo(
    () => PROJECTS.filter((project) => project.listingTier !== "retired"),
    [],
  );
  let body: ReactNode;
  if (session.status !== "signed-in") {
    body = (
      <SignInPanel
        next="/security"
        purpose="Sign in to see your security cases."
        state={session}
      />
    );
  } else if (list.status === "signed-out") {
    body = (
      <SignInPanel
        next="/security"
        purpose="Your session ended."
        state={{ status: "signed-out" }}
      />
    );
  } else if (list.status === "loading") {
    body = (
      <p aria-live="polite" className="admin-status">
        Loading your cases…
      </p>
    );
  } else if (list.status === "error") {
    body = (
      <div className="form-error" role="alert">
        <CircleAlert aria-hidden="true" /> {list.message}
        <button className="text-button" onClick={reload} type="button">
          <RotateCcw aria-hidden="true" /> Retry
        </button>
      </div>
    );
  } else if (list.value.viewer.githubId !== session.session.githubId) {
    body = (
      <div className="form-error" role="alert">
        Your account changed. Reload this page to view your private cases.
        <button
          className="text-button"
          type="button"
          onClick={() => window.location.reload()}
        >
          Reload private cases
        </button>
      </div>
    );
  } else {
    const maintained = new Set(
      list.value.programs
        .filter((entry) => entry.roles.includes("security-maintainer"))
        .map((entry) => entry.projectId),
    );
    body = (
      <>
        {note ? <p role="status">{note}</p> : null}
        {maintained.size > 0 ? (
          <label>
            Show reports
            <select
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value as ReportFilter);
                setSelected(null);
              }}
            >
              <option value="all">All reports</option>
              <option value="review">Needs your review</option>
              <option value="waiting">Waiting for researcher</option>
              <option value="award">Award and payment</option>
              <option value="resolved">Paid or ineligible</option>
            </select>
          </label>
        ) : null}
        <SubmissionsPanel
          key={session.session.githubId}
          readReport={!embedded}
          filter={filter}
          session={session}
          focusId={returned.submission}
          grantError={returned.error}
          onAvailability={setAutomatic}
          onLinkFallback={setLinkFallback}
          onOpenCase={openCase}
          onKnownCases={setKnownSubmissionCases}
          cases={list.value.cases}
        />
        {selected ||
        list.value.authorityUnavailable ||
        list.value.cases.some(
          (record) => !knownSubmissionCases.includes(record.id),
        ) ? (
          <section aria-labelledby="security-cases" className="admin-section">
            <h2 id="security-cases">Decisions and payments</h2>
            {list.value.authorityUnavailable ? (
              <p className="form-error" role="status">
                Some maintainer access could not be checked.{" "}
                <button className="text-button" onClick={reload} type="button">
                  Retry access check
                </button>
              </p>
            ) : null}
            {list.value.cases.length === 0 ? (
              <p className="admin-status">
                {list.value.authorityUnavailable
                  ? "No cases to show. Retry the access check."
                  : "You have no private security cases."}
              </p>
            ) : (
              <ul
                className={`security-case-list${selected ? " security-case-list-selected" : ""}`}
              >
                {list.value.cases
                  .filter(
                    (record) =>
                      !knownSubmissionCases.includes(record.id) &&
                      matchesReport(record, filter),
                  )
                  .map((record) => (
                    <li key={record.id}>
                      <button
                        aria-pressed={selected === record.id}
                        className="security-case-choice"
                        onClick={() => setSelected(record.id)}
                        type="button"
                      >
                        <span>{record.projectId}</span>
                        <strong title={record.id}>{caseTitle(record)}</strong>
                        <span>{record.nextStep}</span>
                        <span>Award: {awardText(record)}</span>
                      </button>
                    </li>
                  ))}
              </ul>
            )}
            {selected ? (
              <>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setSelected(null);
                    const query = new URLSearchParams(window.location.search);
                    query.delete("case");
                    window.history.replaceState(
                      window.history.state,
                      "",
                      `${window.location.pathname}?${query}`,
                    );
                  }}
                >
                  Back to reports
                </button>
                <CaseDetail
                  caseId={selected}
                  key={selected}
                  onChanged={reload}
                />
              </>
            ) : null}
          </section>
        ) : null}
        {!embedded ? (
          <details
            className="security-reference"
            open={
              linkFallback ||
              directUnavailable ||
              window.location.hash === "#security-link"
            }
          >
            <summary>Link or import a GitHub report</summary>
            {automatic ? (
              <section
                aria-labelledby="security-link"
                className="admin-section"
              >
                <h2 id="security-link">
                  Already reported on GitHub? Verify it
                </h2>
                <DirectVerifyForm
                  onUnavailable={() => setDirectUnavailable(true)}
                  programProjects={programProjects}
                />
                {linkFallback || directUnavailable ? (
                  <>
                    <p className="admin-status">
                      GitHub could not verify this report. Link it for a
                      maintainer to verify.
                    </p>
                    <ClaimForm
                      onCreated={created}
                      programProjects={programProjects}
                    />
                  </>
                ) : null}
              </section>
            ) : automatic === false ? (
              <section
                aria-labelledby="security-link"
                className="admin-section"
              >
                <h2 id="security-link">
                  Link a report you submitted on GitHub
                </h2>
                <p className="admin-status">A maintainer verifies the link.</p>
                <ClaimForm
                  onCreated={created}
                  programProjects={programProjects}
                />
              </section>
            ) : null}
            {maintained.size > 0 ? (
              <section
                aria-labelledby="security-import"
                className="admin-section"
              >
                <h2 id="security-import">Reports sent on GitHub directly</h2>
                {automatic === false ? (
                  <RecordForm
                    onCreated={created}
                    programProjects={programProjects.filter((project) =>
                      maintained.has(project.id),
                    )}
                  />
                ) : (
                  <ImportReports
                    onImported={reload}
                    projects={programProjects.filter((project) =>
                      maintained.has(project.id),
                    )}
                  />
                )}
              </section>
            ) : null}
          </details>
        ) : null}
      </>
    );
  }
  return <>{body}</>;
}

export default function SecurityCasesPage() {
  return <SecurityInbox />;
}
