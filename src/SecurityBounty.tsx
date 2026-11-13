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
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  CircleAlert,
  Clock,
  Download,
  Ellipsis,
  ExternalLink,
  Eye,
  EyeOff,
  Hourglass,
  Info,
  LoaderCircle,
  LockKeyhole,
  Pencil,
  Receipt,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  UserRound,
  Wallet,
} from "lucide-react";
import {
  createContext,
  type FormEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
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
import { GithubIcon } from "./lib/github-icon";
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
import { formatAssetSymbol, type RewardAsset } from "./lib/reward-asset.mjs";
import {
  formatSecurityAmount,
  isFullAwardSplit,
  type SecurityBountyTerms,
  securityBountySplit,
} from "./lib/security-bounty.mjs";
import { useAction } from "./lib/use-action";
import { useTimeBoundary } from "./lib/use-time-boundary";
import { securityBountyShares } from "./lib/verified-security-split";
import { CopyButton, CopyIdentifier } from "./Operations";
import {
  ExternalLinkAnchor,
  formatNullableUtc as formatUtc,
  MetricGrid,
  MetricTile,
  NetworkName,
  ProjectNav,
  RoutePageHeader,
  SignInPanel,
  StatusBadge,
} from "./Presentation";

type Tone = "neutral" | "success" | "warning" | "danger" | "info";

function FormError({ message }: { message: string | null }) {
  return message ? (
    <p className="form-error" role="alert">
      <CircleAlert aria-hidden="true" /> {message}
    </p>
  ) : null;
}

/** A loading state: a spinner with its meaning kept for assistive technology. */
function Spinner({ label }: { label: string }) {
  return (
    <p className="admin-status" role="status" title={label}>
      <LoaderCircle aria-hidden="true" className="wallet-spin" size={16} />
      <span className="visually-hidden">{label}</span>
    </p>
  );
}

/** An icon that carries a short explanation as its name and tooltip. */
function InfoTip({ text }: { text: string }) {
  return (
    <span role="img" aria-label={text} title={text}>
      <Info aria-hidden="true" size={14} />
    </span>
  );
}

function RetryButton({
  label,
  onClick,
  busy = false,
}: {
  label: string;
  onClick: () => void;
  busy?: boolean;
}) {
  return (
    <button
      aria-label={label}
      className="text-button"
      disabled={busy}
      onClick={onClick}
      title={label}
      type="button"
    >
      <RotateCcw aria-hidden="true" />
    </button>
  );
}

/** A failed refresh: the loaded view stays and is marked stale. */
function StaleNotice({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => void;
}) {
  return (
    <p className="admin-status" role="alert">
      <StatusBadge tone="warning" icon={<CircleAlert />} title={error}>
        Stale
      </StatusBadge>{" "}
      <span className="visually-hidden">{error}</span>
      <RetryButton label="Retry" onClick={onRetry} />
    </p>
  );
}

const SEVERITY_TONES: Record<string, Tone> = {
  critical: "danger",
  high: "danger",
  medium: "warning",
  low: "info",
};

function SeverityChip({ severity }: { severity: string }) {
  return (
    <StatusBadge tone={SEVERITY_TONES[severity] ?? "neutral"} title="Severity">
      {severity}
    </StatusBadge>
  );
}

function shortAddress(value: string): string {
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
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
  const [downloaded, setDownloaded] = useState(false);
  useEffect(() => {
    if (!downloaded) return;
    const timer = window.setTimeout(() => setDownloaded(false), 2000);
    return () => window.clearTimeout(timer);
  }, [downloaded]);
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
      <h5>{direct ? "Transfers due" : "Unsigned request"}</h5>
      {direct ? (
        <>
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
                  {formatAssetSymbol(direct.asset.symbol)}
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
        <CopyButton label="unsigned request" text={text} />
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
            setDownloaded(true);
          }}
        >
          {downloaded ? (
            <Check aria-hidden="true" />
          ) : (
            <Download aria-hidden="true" />
          )}
        </button>
        {downloaded ? (
          <span className="visually-hidden" role="status">
            Download started.
          </span>
        ) : null}
      </div>
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

const PROGRAM_STATUS: Record<SecurityBountyTerms["status"], [string, Tone]> = {
  draft: ["Draft", "neutral"],
  "pending-approval": ["Draft", "neutral"],
  open: ["Open", "success"],
  paused: ["Paused", "warning"],
  closed: ["Closed", "neutral"],
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
  disabled: "GitHub reporting off",
  forbidden: "GitHub check refused",
  unavailable: "Status unavailable",
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
    <RetryButton
      busy={busy}
      label={busy ? "Checking…" : "Check again"}
      onClick={() => void check()}
    />
  );
  return (
    <section
      aria-labelledby="security-report"
      className="admin-card security-intake-card"
    >
      <h2 id="security-report">Private report</h2>
      <p>
        <StatusBadge icon={<LockKeyhole />}>Private</StatusBadge>
      </p>
      {state.status === "checked" && state.value.storedIntake === true ? (
        <AutomaticReportForm session={session} project={project} />
      ) : state.status === "checking" ? (
        <Spinner label="Checking private intake…" />
      ) : (
        <p role="status">Slop intake unavailable</p>
      )}
      <details
        className="security-reference"
        open={state.status !== "checked" || state.value.storedIntake !== true}
      >
        <summary>GitHub option</summary>
        {state.status === "checking" ? (
          <Spinner label="Loading private reporting status…" />
        ) : state.status === "error" ? (
          <div className="form-error" role="alert">
            <CircleAlert aria-hidden="true" /> {state.message}
            {checkAgain(false)}
          </div>
        ) : state.value.state === "ready" && state.value.handoffUrl ? (
          <div aria-live="polite" className="security-handoff">
            {state.stale ? (
              <div className="admin-status" role="alert">
                <StatusBadge tone="warning" icon={<CircleAlert />}>
                  Stale ·{" "}
                  {state.value.checkedAt
                    ? formatUtc(state.value.checkedAt)
                    : "unknown time"}
                </StatusBadge>{" "}
                {checkAgain(state.rechecking)}
              </div>
            ) : (
              <p className="admin-status security-readiness">
                <StatusBadge
                  tone="success"
                  icon={<ShieldCheck />}
                  title={`Checked ${
                    state.value.checkedAt
                      ? formatUtc(state.value.checkedAt)
                      : "at an unknown time"
                  }`}
                >
                  GitHub on
                </StatusBadge>
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
                Report on GitHub <ExternalLink aria-hidden="true" />
              </a>
            )}
          </div>
        ) : (
          <div className="admin-status" role="alert">
            <StatusBadge tone="danger" icon={<CircleAlert />}>
              {
                BLOCKED_INTAKE[
                  state.value.state as Exclude<Readiness["state"], "ready">
                ]
              }
            </StatusBadge>{" "}
            {state.stale && state.value.checkedAt ? (
              <>
                <StatusBadge tone="warning">
                  Stale · {formatUtc(state.value.checkedAt)}
                </StatusBadge>{" "}
              </>
            ) : null}
            {checkAgain(state.rechecking)}
          </div>
        )}
        <p>
          <Link href="/security#security-link">
            Verify a GitHub report <ArrowRight aria-hidden="true" size={14} />
          </Link>
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
const DRAFT_STORAGE_ERROR = "Allow site storage, then retry.";

/** One consent line before the fields. */
function IntakeConsent({ login }: { login: string | null }) {
  return (
    <p>
      <LockKeyhole aria-hidden="true" size={14} /> Filed privately as{" "}
      {login ? `@${login}` : "you"}
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
          placeholder="Revision, impact, repro steps"
          required
          rows={10}
          value={draft.description}
        />
      </label>
      <details
        className="security-classification"
        open={classificationOpen}
        onToggle={(event) => setClassificationOpen(event.currentTarget.open)}
      >
        <summary>Classification</summary>
        <div>
          <label>
            Severity
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
            CVSS vector
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
            CWE IDs
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
        purpose="Sign in to report"
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

function Fact({ term, children }: { term: ReactNode; children: ReactNode }) {
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
  const refreshIdentity = useCallback(
    () => setSessionEpoch((value) => value + 1),
    [],
  );
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
              <Link href={`/projects/${project.slug}`}>{project.name}</Link>{" "}
              security
            </>
          }
        >
          <StatusBadge>No bounty</StatusBadge>
        </RoutePageHeader>
        <ProjectNav project={project} current="security" />
        {published?.projectId === project.id ? (
          <p role="status">
            <StatusBadge tone="success" icon={<Check />}>
              Rev {published.revision}
            </StatusBadge>
          </p>
        ) : null}
        <IntakeHandoff project={project} session={session} />
        <ProjectSecuritySettings
          key={project.id}
          onIdentityChange={refreshIdentity}
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
        title={<>{project.name} security</>}
        titleAction={
          <ExternalLinkAnchor
            href={project.links.repository}
            label="View in GitHub"
          >
            <GithubIcon aria-hidden="true" size={20} />
          </ExternalLinkAnchor>
        }
      >
        <MetricGrid>
          <MetricTile label="Bounty" value={money.gross} />
        </MetricGrid>
        <StatusBadge tone={PROGRAM_STATUS[terms.status][1]}>
          {PROGRAM_STATUS[terms.status][0]}
        </StatusBadge>
      </RoutePageHeader>
      {!hasBountyOverview(project) ? (
        <ProjectNav project={project} current="security" />
      ) : null}
      {published?.projectId === project.id ? (
        <p role="status">
          <StatusBadge tone="success" icon={<Check />}>
            Rev {published.revision}
          </StatusBadge>
        </p>
      ) : null}
      <section className="install-panel" aria-labelledby="bounty-agent-setup">
        <h2 id="bounty-agent-setup">Agent setup</h2>
        <div className="command-box agent-prompt-box">
          <code>{agentPrompt}</code>
          <CopyButton label="agent prompt" text={agentPrompt} />
        </div>
      </section>
      <div className="security-program-terms">
        <details className="security-reference">
          <summary id="security-terms">Terms</summary>
          <section aria-labelledby="security-terms" className="admin-card">
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
                {terms.funding.state === "pledged" ? (
                  <StatusBadge tone="warning">Pledged</StatusBadge>
                ) : (
                  <StatusBadge
                    tone="success"
                    icon={<Check />}
                    title={terms.funding.evidence}
                  >
                    Verified {formatUtc(terms.funding.verifiedAt)}
                  </StatusBadge>
                )}
              </Fact>
              <Fact term="Awards">
                {terms.capacity.awards === null
                  ? "Unlimited"
                  : terms.capacity.awards}
                {terms.capacity.closesAt
                  ? ` · closes ${formatUtc(terms.capacity.closesAt)}`
                  : ""}
              </Fact>
              {terms.rewardMode === "bounty-only" ? (
                <Fact term="Other work">
                  <StatusBadge>Bounty only</StatusBadge>
                </Fact>
              ) : null}
            </dl>
            <p>Owner decides awards.</p>
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
            {scope.deployments.length === 0 ? null : (
              <Fact term="Deployments">
                <ul>
                  {scope.deployments.map((deployment) => (
                    <li key={`${deployment.network}:${deployment.address}`}>
                      <NetworkName chain={deployment.network} iconOnly>
                        {deployment.network}
                      </NetworkName>{" "}
                      <span className="operations-identifier">
                        <code
                          title={
                            deployment.codeIdentity
                              ? `${deployment.address} (${deployment.codeIdentity})`
                              : deployment.address
                          }
                        >
                          {shortAddress(deployment.address)}
                        </code>
                        <CopyButton
                          label={`${deployment.network} deployment address`}
                          text={deployment.address}
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              </Fact>
            )}
            <Fact term="Included assets">
              {scope.includedAssets.join("; ")}
            </Fact>
            {scope.excludedDependencies.length === 0 ? null : (
              <Fact term="Excluded dependencies">
                {scope.excludedDependencies.join("; ")}
              </Fact>
            )}
          </dl>
          <details className="security-reference">
            <summary>Testing</summary>
            <p>{scope.testingPermission}</p>
          </details>
          <details className="security-reference">
            <summary>Severity</summary>
            <p>{scope.severityRubric}</p>
          </details>
          <details className="security-reference">
            <summary>
              {terms.eligibility === "critical-loss-of-funds"
                ? "Loss"
                : "Impact"}
            </summary>
            <p>{scope.lossDefinition}</p>
          </details>
          <p>Test on a fork only.</p>
        </section>
        <IntakeHandoff project={project} session={session} />
        <ProjectSecuritySettings
          key={project.id}
          onIdentityChange={refreshIdentity}
          onProjectChange={setProject}
          onPublishedRevision={(revision) =>
            setPublished({ projectId: project.id, revision })
          }
          project={project}
          session={session}
        />
        <details className="security-reference">
          <summary id="security-trust">Process</summary>
          <section aria-labelledby="security-trust" className="admin-card">
            <dl className="admin-facts">
              <Fact term="Reviewers">{people(terms.approvers.technical)}</Fact>
              <Fact term="Payment">{people(terms.approvers.financial)}</Fact>
              <Fact term="Disputes">
                {people(terms.approvers.dispute)}{" "}
                <InfoTip text={terms.dispute.process} />
              </Fact>
              <Fact term="Response targets">
                <StatusBadge>
                  {terms.responseTargets.acknowledgeHours}h ack
                </StatusBadge>{" "}
                <StatusBadge>
                  {terms.responseTargets.triageBusinessDays}d triage
                </StatusBadge>{" "}
                <StatusBadge>
                  {terms.responseTargets.updateIntervalDays}d updates
                </StatusBadge>
              </Fact>
            </dl>
            <details className="security-reference">
              <summary>Disclosure</summary>
              <p>{terms.disclosure}</p>
            </details>
            <details className="security-reference">
              <summary>Safe harbor</summary>
              <p>{terms.safeHarbor}</p>
            </details>
            <p>
              <StatusBadge icon={<LockKeyhole />}>
                Cases stay private
              </StatusBadge>
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
  | { status: "ready"; value: T; refreshError?: string };

type PrivateRequest = <T>(
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown,
  options?: { expectedActorGithubId?: string; isCurrent?: () => boolean },
) => Promise<T>;
const PrivateRequestContext = createContext<PrivateRequest>(projectApiRequest);

function usePrivateRequest() {
  return useContext(PrivateRequestContext);
}

function useSecurityData<T>(
  path: string | null,
): [
  Loaded<T>,
  () => void,
  (value: T, accept?: (previous: T) => boolean | "refresh") => void,
] {
  const privateRequest = usePrivateRequest();
  const [state, setState] = useState<Loaded<T>>({ status: "loading" });
  const mounted = useRef(false);
  const generation = useRef(0);
  const activeRead = useRef<number | null>(null);
  const accepted = useRef<{ value: T } | null>(null);
  const load = useCallback(() => {
    if (!mounted.current || path === null) return;
    const current = ++generation.current;
    activeRead.current = current;
    // A refresh keeps the loaded view, so an open case stays mounted.
    setState((previous) =>
      previous.status === "ready" ? previous : { status: "loading" },
    );
    privateRequest<T>("GET", path).then(
      (value) => {
        if (generation.current === current) {
          activeRead.current = null;
          accepted.current = { value };
          setState({ status: "ready", value });
        }
      },
      (error: unknown) => {
        if (generation.current !== current) return;
        activeRead.current = null;
        if (error instanceof ProjectApiError && error.status === 401) {
          setState({ status: "signed-out" });
          return;
        }
        const message = errorMessage(error);
        // A failed refresh keeps the loaded view, as the refresh start
        // above does; the failure rides on the view instead of replacing
        // it. Only a load with nothing on screen becomes an error.
        setState((previous) =>
          previous.status === "ready"
            ? { ...previous, refreshError: message }
            : { status: "error", message },
        );
      },
    );
  }, [path, privateRequest]);
  useEffect(() => {
    mounted.current = true;
    load();
    return () => {
      mounted.current = false;
      generation.current += 1;
      activeRead.current = null;
    };
  }, [load]);
  const replace = useCallback(
    (value: T, accept?: (previous: T) => boolean | "refresh") => {
      if (!mounted.current) return;
      const decision =
        accepted.current !== null && accept
          ? accept(accepted.current.value)
          : true;
      if (decision === "refresh") {
        // Keep current projections until a fresh read answers. An existing
        // current read already owns that work; do not cancel it and start over.
        if (activeRead.current !== generation.current) load();
        return;
      }
      if (!decision) return;
      // An action result supersedes every read started before it.
      generation.current += 1;
      activeRead.current = null;
      accepted.current = { value };
      setState({ status: "ready", value });
    },
    [load],
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
  received: "Received",
  triaging: "In review",
  "needs-information": "Info needed",
  confirmed: "Confirmed",
  duplicate: "Duplicate",
  "out-of-scope": "Out of scope",
  rejected: "Rejected",
  disputed: "Appeal",
};

const RECEIPT_TONES: Record<string, Tone> = {
  "needs-information": "warning",
  confirmed: "success",
  rejected: "danger",
};

const AWARD_LABELS: Record<string, string> = {
  "not-applicable": "No program",
  pending: "Pending",
  ineligible: "None",
  reserved: "Reserved",
  "capacity-exhausted": "Pending",
  approved: "Approved",
};

const PAYMENT_LABELS: Record<string, string> = {
  "not-applicable": "No award",
  "rail-unavailable": "Unpaid",
  "awaiting-owner-commitment": "Owner",
  "needs-wallet": "Wallet",
  uncertain: "Unconfirmed",
  ready: "Ready",
  processing: "Sending",
  submitted: "Finalizing",
  held: "Held",
  paid: "Paid",
};

const SUBMISSION_LABELS: Record<
  SecurityCase["submissionState"],
  [string, Tone]
> = {
  claimed: ["Checking", "warning"],
  verified: ["Received", "success"],
  "link-rejected": ["Unconfirmed", "danger"],
};

const EVENT_LABELS: Record<string, string> = {
  submit: "Submitted",
  "submit-direct": "Linked",
  claim: "Linked",
  record: "Recorded",
  "verify-link": "Verified",
  "reject-link": "Link rejected",
  receive: "Receipt verified",
  "receipt-mismatch": "Receipt mismatch",
  "assign-triager": "Triager +",
  "revoke-triager": "Triager −",
  triage: "Triage",
  "next-action": "Next action",
  "request-information": "Info requested",
  "report-revised": "Revised",
  decide: "Decided",
  award: "Award decided",
  remediation: "Remediation",
  disclosure: "Disclosure",
  recognition: "Recognition",
  appeal: "Appealed",
  "decide-appeal": "Appeal decided",
  "approve-award": "Award approved",
  "consent-payment": "Visibility accepted",
  "prepare-payment": "Payment prepared",
  "verify-payment": "Payment checked",
  "recover-payment": "Wallet recovered",
  "decide-related-party": "Related-party review",
  "reserve-award": "Award reserved",
};

/** Who acted, shown as an icon before the event's verb. */
const REPORTER_EVENTS = new Set([
  "submit",
  "submit-direct",
  "claim",
  "report-revised",
  "recognition",
  "appeal",
  "consent-payment",
]);
const GITHUB_EVENTS = new Set(["receive", "receipt-mismatch"]);

function EventActor({ kind }: { kind: string }) {
  const label = REPORTER_EVENTS.has(kind)
    ? "Reporter"
    : GITHUB_EVENTS.has(kind)
      ? "GitHub"
      : "Program team";
  const Icon =
    label === "Reporter"
      ? UserRound
      : label === "GitHub"
        ? GithubIcon
        : ShieldCheck;
  return (
    <span role="img" aria-label={label} title={label}>
      <Icon aria-hidden="true" size={14} />
    </span>
  );
}

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
        throw new Error("GitHub read failed. Retry.");
      setNote(body.received === 0 ? "Up to date" : `${body.received} imported`);
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
        {busy ? "Importing…" : "Import from GitHub"}
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
    return <p className="admin-status">No programs yet</p>;
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
      <AdvisoryIdField onChange={setAdvisory} value={advisory} />
      <FormError message={error} />
      <button className="button primary-button" disabled={busy} type="submit">
        {busy ? "Linking…" : "Link report"}
      </button>
    </form>
  );
}

/** A reporter's GHSA advisory ID input; only the ID, never report details. */
function AdvisoryIdField({
  onChange,
  value,
}: {
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label>
      GitHub advisory ID
      <input
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        pattern="GHSA-[2-9cfghjmpqrvwx]{4}-[2-9cfghjmpqrvwx]{4}-[2-9cfghjmpqrvwx]{4}"
        placeholder="GHSA-xxxx-xxxx-xxxx"
        required
        spellCheck={false}
        value={value}
      />
    </label>
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
    return <p className="admin-status">No programs yet</p>;
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
      <AdvisoryIdField onChange={setAdvisory} value={advisory} />
      <FormError message={error} />
      <button className="button primary-button" disabled={busy} type="submit">
        <GithubIcon aria-hidden="true" size={16} />{" "}
        {busy ? "Opening…" : "Verify"}
      </button>
    </form>
  );
}

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
      <summary>
        <Pencil aria-hidden="true" size={14} /> Edit report
      </summary>
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
        <ReportFields draft={draft} onChange={setDraft} disabled={busy} />
        <button className="button primary-button" disabled={busy} type="submit">
          {busy ? "Saving…" : "Save"}
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
      <summary>
        <LockKeyhole aria-hidden="true" size={14} /> Report
      </summary>
      {!opened ? null : detail.status === "loading" ? (
        <Spinner label="Loading private report…" />
      ) : detail.status === "ready" ? (
        <>
          {detail.refreshError ? (
            <StaleNotice error={detail.refreshError} onRetry={reload} />
          ) : null}
          <h4 id={`report-summary-${submission.id}`}>
            {detail.value.report.summary}
          </h4>
          {detail.value.report.severity ? (
            <p>
              <SeverityChip severity={detail.value.report.severity} />
            </p>
          ) : null}
          {/* biome-ignore lint/a11y/useSemanticElements: This named scroll region must preserve the report's preformatted text. */}
          <pre
            className="security-report-text"
            role="region"
            aria-labelledby={`submission-${submission.id} report-summary-${submission.id}`}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll the complete private report.
            tabIndex={0}
          >
            {detail.value.report.description}
          </pre>
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
                  Forward to owner
                </button>
                <button
                  className="button secondary-button"
                  disabled={busy || reason.trim().length < 8}
                  type="button"
                  onClick={() => review("request-information")}
                >
                  Request evidence
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <div role="alert">
          <p>{detail.status === "error" ? detail.message : "Sign in again"}</p>
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
  useTimeBoundary(
    submission.state === "uncertain" && submission.reconcileAfter
      ? Date.parse(submission.reconcileAfter)
      : null,
  );
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
          <LockKeyhole aria-hidden="true" size={16} /> {submission.projectId}
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
            <span>{caseRecord.nextStep}</span>
          </p>
          <p className="inbox-meta">
            <StatusBadge title="Award">{awardShort(caseRecord)}</StatusBadge>
            {caseRecord.nextStepDueAt ? (
              <>
                {" "}
                <DueChip at={caseRecord.nextStepDueAt} />
              </>
            ) : null}
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
            <p className="field-hint" title="Slop receipt">
              <Receipt aria-hidden="true" size={14} />{" "}
              <span className="visually-hidden">Slop receipt</span>
              {formatUtc(submission.intake.receivedAt)}
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
                aria-label={
                  submission.intake.canForward
                    ? "Retry owner notification"
                    : "Retry screening"
                }
                className="text-button"
                disabled={busy}
                title={
                  submission.intake.canForward
                    ? "Retry owner notification"
                    : "Retry screening"
                }
                type="button"
                onClick={() =>
                  run("screen", {
                    expectedRevision: submission.intake?.revision,
                  })
                }
              >
                <RotateCcw aria-hidden="true" /> Retry
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
                  <GithubIcon aria-hidden="true" size={14} />{" "}
                  {submission.state === "failed" ? "Retry" : "Send to GitHub"}
                </summary>
                <div className="report-form-actions">
                  <button
                    title="Authorize private GitHub delivery"
                    className="button secondary-button"
                    disabled={busy}
                    type="button"
                    onClick={authorize}
                  >
                    1 Authorize
                  </button>
                  <ArrowRight aria-hidden="true" size={14} />
                  <button
                    title="Send saved report to GitHub"
                    className="button secondary-button"
                    disabled={busy}
                    type="button"
                    onClick={() => run("send", { expectedRevision })}
                  >
                    2 Send
                  </button>
                </div>
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
          <div role="alert">
            <button
              aria-label="Authorize GitHub to submit as you"
              className="button secondary-button"
              disabled={busy}
              onClick={authorize}
              title="Authorize GitHub to submit as you"
              type="button"
            >
              <GithubIcon aria-hidden="true" size={16} /> Authorize
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
          throw new Error("Account changed. Reload.");
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
  if (submissions === null) return <Spinner label="Loading private reports…" />;
  const shown = submissions.filter(
    (entry) => entry.state !== "abandoned" || entry.id === focusId,
  );
  if (shown.length === 0 && !grantError && !authorityUnavailable && !error)
    return cases.length === 0 ? (
      <p className="admin-status">No reports</p>
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
        <RetryButton label="Refresh reports" onClick={load} />
      </div>
      {authorityUnavailable ? (
        <p className="admin-status" role="status">
          <StatusBadge
            tone="warning"
            icon={<CircleAlert />}
            title="Some maintainer access could not be checked"
          >
            Partial list
          </StatusBadge>{" "}
          <RetryButton label="Retry access check" onClick={load} />
        </p>
      ) : null}
      {error ? <StaleNotice error={error} onRetry={load} /> : null}
      {grantError ? (
        <p className="form-error" role="alert">
          <CircleAlert aria-hidden="true" />{" "}
          {GRANT_ERRORS[grantError] ?? GRANT_ERRORS.grant_exchange_failed}
        </p>
      ) : null}
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
        Reporter ID
        <input
          inputMode="numeric"
          onChange={(event) => setReporterId(event.target.value)}
          required
          value={reporterId}
        />
      </label>
      <label>
        Reporter login
        <input
          onChange={(event) => setReporterLogin(event.target.value)}
          required
          value={reporterLogin}
        />
      </label>
      <label>
        Received (UTC)
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
        Verified on GitHub
      </label>
      <FormError message={error} />
      <button className="button primary-button" disabled={busy} type="submit">
        {busy ? "Recording…" : "Record"}
      </button>
    </form>
  );
}

type FieldSpec =
  | {
      name: string;
      label: string;
      kind: "text" | "textarea";
      placeholder?: string;
      /** Marks a field whose content only authorized reviewers read. */
      private?: boolean;
      optional?: boolean;
      /** Required while another select has one of these values. */
      requiredWhen?: { field: string; values: string[] };
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
      /** A short explanation carried by an info icon. */
      info?: string;
      /** The consent reveals data publicly. */
      publicNotice?: boolean;
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
      /** A short fact shown as a chip under the input. */
      chip?: string;
      initial?: string;
      readOnly?: boolean;
      when?: { field: string; values: string[] };
    };

type ActionSpec = { title: string; submit: string; fields: FieldSpec[] };

const REASON: FieldSpec = {
  name: "reason",
  label: "Reason",
  kind: "textarea",
  private: true,
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
        title: "Verify report",
        submit: "Verify report",
        fields: [
          {
            name: "receivedAt",
            label: "Received (UTC)",
            kind: "utc",
          },
          {
            name: "confirmation",
            label: `Verified on GitHub: ${record.advisory?.ghsa ?? "this advisory"} by @${record.reporter?.githubLogin ?? "the reporter"}`,
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
        title: "Request info",
        submit: "Ask for information",
        fields: [
          {
            name: "reason",
            label: "What you need",
            kind: "textarea",
          },
        ],
      };
    case "decide":
      return {
        title: "Decide",
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
              ["verified-potential", "Potential"],
              ["verified-actual", "Actual"],
              ["not-verified", "None"],
            ],
          },
          {
            name: "inScope",
            label: "In scope",
            kind: "checkbox",
          },
          {
            name: "relatedParty",
            label: "Related party",
            info: "Owner, employee, sponsor or approver",
            kind: "checkbox",
          },
          {
            name: "rootCauseKey",
            label: "Root cause key",
            kind: "text",
            optional: true,
            initial: proposal?.rootCauseKey ?? "",
            placeholder: "root-cause-key",
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
            label: "Evidence ref",
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
        : null;
      return {
        title: "Award",
        submit: "Save",
        fields: [
          {
            name: "decision",
            label: "Decision",
            kind: "select",
            options: [
              ["amount", "Award"],
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
            chip: direct
              ? undefined
              : available
                ? `Available ${available}`
                : "No verified funds",
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
            label: `Approve award for @${record.reporter?.githubLogin ?? "the reporter"}`,
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
              ["fixing", "Fixing"],
              ["retest", "Retest"],
              ["resolved", "Resolved"],
              ["mitigation-verified", "Mitigated"],
              ["reopened", "Reopened"],
            ],
          },
          {
            name: "evidenceReference",
            label: "Evidence ref",
            kind: "text",
            optional: true,
            requiredWhen: {
              field: "remediationState",
              values: ["resolved", "mitigation-verified"],
            },
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
              ["redaction-approved", "Redaction approved"],
              ["disclosed", "Disclosed"],
            ],
          },
          {
            name: "evidenceReference",
            label: "Approval ref",
            kind: "text",
          },
          {
            name: "redactedContentDigest",
            label: "Redacted SHA-256",
            kind: "text",
            optional: true,
            requiredWhen: {
              field: "disclosureState",
              values: ["redaction-approved", "disclosed"],
            },
          },
          {
            name: "embargoChange",
            label: "Embargo change",
            kind: "textarea",
            optional: true,
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
            label: "GitHub ID",
            kind: "text",
          },
          { name: "githubLogin", label: "Login", kind: "text" },
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
            label: "Public name",
            kind: "select",
            // The current choice is listed first, so the form shows it.
            options: (
              [
                ["private", "Off"],
                ["opt-in", "On"],
              ] as [string, string][]
            ).sort(([value]) => (value === record.recognition ? -1 : 1)),
          },
        ],
      };
    case "appeal":
      return {
        title: "Appeal",
        submit: "Send appeal",
        fields: [
          {
            name: "reason",
            label: "Reason",
            kind: "textarea",
            private: true,
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
              ["uphold", "Uphold"],
              ["return", "Return"],
            ],
          },
          REASON,
        ],
      };
    case "decide-related-party":
      return {
        title: "Related-party review",
        submit: "Record review",
        fields: [
          {
            name: "outcome",
            label: "Outcome",
            kind: "select",
            options: [
              [
                "approve",
                record.award && record.terms
                  ? `Approve ${money(record.award.grossMinor, record.terms)}`
                  : "Approve",
              ],
              ["refuse", "Refuse"],
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
            ? "Visibility"
            : record.settlement
              ? "Refresh payment"
              : "Prepare payment",
        submit:
          action === "consent-payment"
            ? "Accept"
            : record.settlement
              ? "Refresh"
              : "Prepare",
        fields: [
          {
            name: "network",
            label: "Network",
            kind: "select",
            options: record.paymentNetworks.map((n) => [n, n]),
          },
          {
            name: "confirmation",
            label:
              action === "consent-payment"
                ? record.paymentRail === "direct"
                  ? "On-chain: wallet, time, amount public"
                  : "On-chain: GitHub ID, wallet, time, amount public"
                : `Approve ${awardAmounts(record) ?? awardText(record)}`,
            publicNotice: action === "consent-payment",
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
            placeholder: "One per line",
          },
          {
            name: "confirmation",
            label: "Pays this award",
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
            ? "Resume"
            : recovery.mode === "cancellation-required" ||
                recovery.mode === "retirement-required"
              ? "Verify"
              : "Check",
        fields: [
          ...(["cancellation-required", "retirement-required"].includes(
            recovery.mode,
          )
            ? [
                {
                  name: "cancellationTransactionId",
                  label: "Transaction ID",
                  kind: "text" as const,
                },
              ]
            : []),
          {
            name: "confirmation",
            label: "Approve recovery to this wallet",
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
      onDone("allowedActions" in response.case ? response.case : null, "Saved");
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
              {field.publicNotice ? <Eye aria-hidden="true" size={14} /> : null}
              {field.label}
              {field.info ? <InfoTip text={field.info} /> : null}
            </label>
          );
        if (
          field.kind === "select" &&
          field.name === "network" &&
          field.options.length === 1
        )
          return (
            <p key={field.name}>
              <StatusBadge title={field.label}>
                <NetworkName chain={field.options[0][0]}>
                  {field.options[0][1]}
                </NetworkName>
              </StatusBadge>
            </p>
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
        if (field.kind === "amount") {
          const minor = decimalToMinor(
            String(values[field.name]),
            field.decimals,
          );
          const fullAward = isFullAwardSplit(record.terms?.split);
          const shares =
            minor !== null &&
            BigInt(minor) > 0n &&
            (fullAward || BigInt(minor) % 4n === 0n)
              ? securityBountyShares(BigInt(minor), fullAward)
              : null;
          return (
            <label key={field.name}>
              <span>
                {field.label}{" "}
                {field.readOnly ? (
                  <span role="img" aria-label="Fixed" title="Fixed">
                    <LockKeyhole aria-hidden="true" size={14} />
                  </span>
                ) : null}
              </span>
              <input
                autoComplete="off"
                inputMode="decimal"
                readOnly={field.readOnly}
                onChange={(event) => set(event.target.value)}
                required
                value={String(values[field.name])}
              />
              {field.chip ? (
                <small className="field-hint">
                  <StatusBadge>{field.chip}</StatusBadge>
                </small>
              ) : null}
              {minor !== null && record.terms ? (
                <small className="field-hint" role="status">
                  {shares
                    ? fullAward
                      ? `100% researcher ${money(shares.researcher.toString(), record.terms)}`
                      : `75% researcher ${money(shares.researcher.toString(), record.terms)} | 25% Slop ${money(shares.slop.toString(), record.terms)}`
                    : "Not divisible 75/25"}
                </small>
              ) : null}
            </label>
          );
        }
        const required =
          !field.optional ||
          (field.requiredWhen?.values.includes(
            String(values[field.requiredWhen.field]),
          ) ??
            false);
        const label = (
          <span>
            {field.label}{" "}
            {field.private ? (
              <span role="img" aria-label="Private" title="Private">
                <LockKeyhole aria-hidden="true" size={14} />
              </span>
            ) : null}
          </span>
        );
        if (field.kind === "textarea")
          return (
            <label key={field.name}>
              {label}
              <textarea
                onChange={(event) => set(event.target.value)}
                placeholder={field.placeholder}
                required={required}
                rows={3}
                value={String(values[field.name])}
              />
            </label>
          );
        return (
          <label key={field.name}>
            {label}
            <input
              autoComplete="off"
              onChange={(event) => set(event.target.value)}
              placeholder={field.placeholder}
              required={required}
              spellCheck={false}
              value={String(values[field.name])}
            />
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

/** The gross award with its researcher and Slop parts, or null without one. */
function awardAmounts(record: SecurityCase): string | null {
  if (record.award === null || record.terms === null) return null;
  return `${money(record.award.grossMinor, record.terms)} (${money(record.award.researcherMinor, record.terms)} + ${money(record.award.slopMinor, record.terms)} Slop)`;
}

/** Why a selected award is not yet approved, or null once it is decided. */
function awardPending(record: SecurityCase): string | null {
  if (record.award === null || record.awardState !== "pending") return null;
  return record.relatedPartyReview === "pending"
    ? "In review"
    : record.paymentRail === "direct"
      ? "Awaiting approval"
      : "Unfunded";
}

function awardText(record: SecurityCase): string {
  const amount = awardAmounts(record);
  if (amount === null)
    return record.paymentRail === "direct" && record.awardState === "approved"
      ? "Approved"
      : (AWARD_LABELS[record.awardState] ?? record.awardState);
  const pending = awardPending(record);
  return pending ? `${pending} · ${amount}` : amount;
}

/** The award as a list chip: its state, then the gross amount when one exists. */
function awardShort(record: SecurityCase): string {
  if (record.award === null || record.terms === null) return awardText(record);
  const gross = money(record.award.grossMinor, record.terms);
  const pending = awardPending(record);
  return pending ? `${pending} · ${gross}` : gross;
}

function DueChip({ at }: { at: string }) {
  return (
    <StatusBadge icon={<Clock />} title="Due">
      <span className="visually-hidden">Due </span>
      {formatUtc(at)}
    </StatusBadge>
  );
}

function paymentLabel(record: SecurityCase): string {
  if (
    record.paymentRail === "direct" &&
    record.settlement?.state === "awaiting-external-payment"
  ) {
    const confirmed = record.settlement.confirmedTransactionIds?.length ?? 0;
    return confirmed > 0
      ? `${confirmed}/${confirmed + (record.settlement.remainingTransfers?.length ?? 0)} paid`
      : "Ready";
  }
  if (
    record.paymentRail === "direct" &&
    record.paymentState === "awaiting-owner-commitment"
  )
    return "Payer";
  return PAYMENT_LABELS[record.paymentState] ?? record.paymentState;
}

const RELATED_PARTY_LABELS: Record<
  SecurityCase["relatedPartyReview"],
  [string, Tone]
> = {
  "not-applicable": ["None", "neutral"],
  pending: ["Pending", "warning"],
  approved: ["Approved", "success"],
  refused: ["Refused", "danger"],
};

const LOSS_LABELS: Record<string, [string, Tone]> = {
  likely: ["Likely", "danger"],
  unlikely: ["Unlikely", "success"],
  unclear: ["Unclear", "neutral"],
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
  const canRun = record.allowedActions.includes("analyze");
  if (analysis === null && !canRun) return null;
  return (
    <section aria-labelledby={`analysis-${record.id}`}>
      <h4 id={`analysis-${record.id}`}>
        <Sparkles aria-hidden="true" size={16} /> AI summary
      </h4>
      {analysis === null ? null : analysis.state === "running" ? (
        <Spinner label="Analyzing the private report…" />
      ) : analysis.state === "complete" ? (
        <>
          <p>{analysis.summary}</p>
          <dl className="admin-facts">
            <Fact term="Proposed severity">
              {analysis.proposedSeverity ?? "—"}
            </Fact>
            <Fact term="Loss of funds">
              {analysis.potentialLoss ? (
                <StatusBadge tone={LOSS_LABELS[analysis.potentialLoss][1]}>
                  {LOSS_LABELS[analysis.potentialLoss][0]}
                </StatusBadge>
              ) : (
                "—"
              )}
            </Fact>
            <Fact term="Possible duplicates">
              {analysis.duplicateCaseIds.length === 0
                ? "None found"
                : analysis.duplicateCaseIds.join(", ")}
            </Fact>
            <Fact term="Remediation">{analysis.remediation ?? "—"}</Fact>
          </dl>
          <p>
            <StatusBadge>AI</StatusBadge>{" "}
            <InfoTip text="AI proposal; you decide" />
          </p>
        </>
      ) : analysis.state === "unavailable" ? (
        <p className="admin-status">
          <StatusBadge>Unavailable</StatusBadge>
        </p>
      ) : (
        <p className="admin-status">
          <StatusBadge tone="danger">Failed</StatusBadge>
        </p>
      )}
      {canRun ? (
        <RetryButton
          busy={busy}
          label={busy ? "Starting…" : "Run the analysis again"}
          onClick={retry}
        />
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
  const canRun = record.allowedActions.includes("triage-appeal");
  if (triage === null && !canRun) return null;
  const confidence =
    triage?.confidence == null ? null : Math.round(triage.confidence * 100);
  return (
    <section aria-labelledby={`appeal-triage-${record.id}`}>
      <h4 id={`appeal-triage-${record.id}`}>
        <Bot aria-hidden="true" size={16} /> Appeal draft
      </h4>
      {triage === null ? null : triage.state === "running" ? (
        <Spinner label="Slopbot is drafting a resolution…" />
      ) : triage.state === "complete" ? (
        <>
          <p>
            <StatusBadge title="Drafted resolution">
              {triage.proposedOutcome === "return" ? "Return" : "Uphold"}
            </StatusBadge>{" "}
            {confidence === null ? null : (
              <>
                <meter
                  aria-label="Confidence"
                  max={100}
                  min={0}
                  title="Confidence"
                  value={confidence}
                />{" "}
                {confidence}%{" "}
              </>
            )}
            <StatusBadge
              title={triage.escalationReasons
                .map((reason) => ESCALATION_LABELS[reason] ?? reason)
                .join("; ")}
            >
              Moderator decides
            </StatusBadge>
          </p>
          <p>{triage.rationale}</p>
        </>
      ) : triage.state === "unavailable" ? (
        <p className="admin-status">
          <StatusBadge>Unavailable</StatusBadge>
        </p>
      ) : (
        <p className="admin-status">
          <StatusBadge tone="danger">Failed</StatusBadge>
        </p>
      )}
      {canRun ? (
        <RetryButton
          busy={busy}
          label={busy ? "Starting…" : "Run the appeal triage again"}
          onClick={retry}
        />
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
        <legend className="visually-hidden">Review actions</legend>
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
          <summary aria-label="Other case actions" title="Other case actions">
            <Ellipsis aria-hidden="true" />
          </summary>
          <label>
            <span className="visually-hidden">Action</span>
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

const CASE_CHANGED = "Changed — review and retry.";

type RecoveryParty = "Reporter" | "Payer" | "Slop review";

/** The recovery step and who must take it. */
function recoveryStep(mode: string): [RecoveryParty | null, string] {
  switch (mode) {
    case "wallet-required":
      return ["Reporter", "Confirm wallet"];
    case "consent-required":
      return ["Reporter", "Accept visibility"];
    case "fee-pending":
      return ["Payer", "Verify fee"];
    case "retirement-required":
      return ["Payer", "Verify old transaction"];
    case "retirement-unproven":
    case "payer-review":
    case "legacy-manual":
      return ["Slop review", "Manual review"];
    case "resume-original":
      return ["Payer", "Resume wallet"];
    case "cancellation-required":
      return ["Payer", "Cancel old transfer"];
    case "payment-found":
      return ["Payer", "Verify found payment"];
    case "signature-required":
    case "history-check":
      return ["Payer", "Check expired request"];
    default:
      return [null, "Awaiting expiry"];
  }
}

function WalletLink() {
  return (
    <Link href="/account#wallets">
      <Wallet aria-hidden="true" size={14} /> Wallet
    </Link>
  );
}

function PaymentProgress({
  confirmed,
  remaining,
}: {
  confirmed: number;
  remaining: number;
}) {
  const total = confirmed + remaining;
  return (
    <>
      <progress
        aria-label="Transfers confirmed"
        max={total}
        value={confirmed}
      />{" "}
      {confirmed}/{total}
    </>
  );
}

function RecoveryStatus({
  mode,
  payer,
  reporter,
}: {
  mode: string;
  payer: boolean;
  reporter: boolean;
}) {
  const [party, step] = recoveryStep(mode);
  const mine =
    (party === "Payer" && payer) || (party === "Reporter" && reporter);
  return (
    <p role="status">
      {party && !mine ? (
        <>
          <StatusBadge icon={<Hourglass />} title={`Waiting on ${party}`}>
            <span className="visually-hidden">Waiting on </span>
            {party}
          </StatusBadge>{" "}
        </>
      ) : null}
      {step}
    </p>
  );
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
  const [state, reload, replaceData] = useSecurityData<{
    case: SecurityCase;
  }>(`security-cases/${encodeURIComponent(caseId)}`);
  const replace = useCallback(
    (value: { case: SecurityCase }) =>
      replaceData(value, (previous) =>
        value.case.revision === previous.case.revision
          ? "refresh"
          : value.case.revision > previous.case.revision,
      ),
    [replaceData],
  );
  const [note, setNote] = useState<string | null>(null);
  if (state.status === "loading") return <Spinner label="Loading case…" />;
  if (state.status === "signed-out")
    return (
      <div role="alert">
        <SignInPanel
          next={`${window.location.pathname}${window.location.search}`}
          state={{ status: "signed-out" }}
        />
      </div>
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
  /** Refuses a recovery signature once the request shown has changed. */
  const stillRecoverable = async (
    request: (
      recovery: NonNullable<SecurityCase["settlement"]>["recovery"],
    ) => unknown,
    message: string,
    isCurrent?: () => boolean,
  ) => {
    const current = await privateRequest<{ case: SecurityCase }>(
      "GET",
      `security-cases/${encodeURIComponent(record.id)}`,
      undefined,
      { isCurrent },
    );
    if (isCurrent && !isCurrent()) return;
    if (
      current.case.revision !== record.revision ||
      !current.case.allowedActions.includes("recover-payment") ||
      current.case.settlement?.recovery?.generation !==
        record.settlement?.recovery?.generation ||
      JSON.stringify(request(current.case.settlement?.recovery)) !==
        JSON.stringify(request(record.settlement?.recovery))
    ) {
      replace(current);
      onChanged();
      throw new Error(message);
    }
  };
  const authorizeExistingPayment = async (isCurrent?: () => boolean) => {
    const current = await privateRequest<{ case: SecurityCase }>(
      "GET",
      `security-cases/${encodeURIComponent(record.id)}`,
      undefined,
      { isCurrent },
    );
    if (isCurrent && !isCurrent()) return;
    if (
      !current.case.allowedActions.includes("verify-payment") ||
      current.case.settlement?.generation !== record.settlement?.generation
    ) {
      replace(current);
      onChanged();
      throw new Error(CASE_CHANGED);
    }
  };
  const verifyExistingPayment = async (
    hashes: string[],
    isCurrent?: () => boolean,
  ) => {
    const current = await privateRequest<{ case: SecurityCase }>(
      "GET",
      `security-cases/${encodeURIComponent(record.id)}`,
      undefined,
      { isCurrent },
    );
    if (isCurrent && !isCurrent()) return;
    if (
      !current.case.allowedActions.includes("verify-payment") ||
      current.case.settlement?.generation !== record.settlement?.generation
    ) {
      replace(current);
      onChanged();
      throw new Error(CASE_CHANGED);
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
      { isCurrent },
    );
    if (isCurrent && !isCurrent()) return;
    replace(response);
    onChanged();
  };
  const response = [...(record.events ?? [])]
    .reverse()
    .find((event) => RESPONSE_KINDS.has(event.kind) && event.reason);
  const activeTriagers = (record.triagers ?? []).filter(
    (entry) => entry.revokedAt === null,
  );
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
        <span role="img" aria-label="Private" title="Private">
          <LockKeyhole aria-hidden="true" size={16} />
        </span>
      </header>
      {note ? (
        <p className="admin-status" role="status">
          <StatusBadge tone="success" icon={<Check />}>
            {note}
          </StatusBadge>
        </p>
      ) : null}
      {state.refreshError ? (
        <StaleNotice error={state.refreshError} onRetry={reload} />
      ) : null}
      <p className="security-next-step">
        <ArrowRight aria-hidden="true" />
        <span>
          {record.nextStep}
          {record.nextStepDueAt ? (
            <>
              {" "}
              <DueChip at={record.nextStepDueAt} />
            </>
          ) : null}
        </span>
      </p>
      <dl className="admin-facts">
        <Fact term="Receipt">
          {record.receivedAtSource === "slop-received" ? (
            <StatusBadge
              tone={
                record.submissionState === "verified" ? "success" : "warning"
              }
              icon={<ShieldCheck />}
            >
              Slop received
            </StatusBadge>
          ) : (
            <StatusBadge
              tone={SUBMISSION_LABELS[record.submissionState][1]}
              icon={<GithubIcon />}
            >
              {SUBMISSION_LABELS[record.submissionState][0]}
            </StatusBadge>
          )}
          {record.receivedAt ? ` ${formatUtc(record.receivedAt)}` : ""}
          {record.receivedAt &&
          record.receivedAtSource === "maintainer-attested" ? (
            <>
              {" "}
              <span
                role="img"
                aria-label="Maintainer-attested"
                title="Maintainer-attested"
              >
                <UserRound aria-hidden="true" size={14} />
              </span>
            </>
          ) : null}
          {record.advisory ? (
            <>
              {" "}
              <ExternalLinkAnchor
                href={record.advisory.url}
                label="GitHub advisory"
              >
                <GithubIcon aria-hidden="true" size={16} />
              </ExternalLinkAnchor>
            </>
          ) : null}
        </Fact>
        {record.receiptState ? (
          <Fact term="Owner response">
            <StatusBadge tone={RECEIPT_TONES[record.receiptState] ?? "neutral"}>
              {RECEIPT_LABELS[record.receiptState] ?? record.receiptState}
            </StatusBadge>
            {response?.reason ? (
              <>
                {" "}
                <q>{response.reason}</q>
              </>
            ) : null}
          </Fact>
        ) : null}
        {record.award && record.terms ? null : (
          <Fact term="Award">
            <StatusBadge>{awardText(record)}</StatusBadge>
          </Fact>
        )}
        {record.relatedParty === "related" &&
        record.relatedPartyReview !== "not-applicable" ? (
          <Fact term="Related party">
            <StatusBadge
              tone={RELATED_PARTY_LABELS[record.relatedPartyReview][1]}
            >
              {RELATED_PARTY_LABELS[record.relatedPartyReview][0]}
            </StatusBadge>
          </Fact>
        ) : null}
        <Fact term="Payout">
          <StatusBadge
            tone={
              record.paymentState === "paid"
                ? "success"
                : record.paymentState === "held"
                  ? "warning"
                  : "neutral"
            }
          >
            {paymentLabel(record)}
          </StatusBadge>
          {record.paymentDeadline ? (
            <>
              {" "}
              <StatusBadge icon={<Clock />} title="Payment deadline">
                <span className="visually-hidden">Deadline </span>
                {formatUtc(record.paymentDeadline)}
              </StatusBadge>
            </>
          ) : null}
        </Fact>
      </dl>
      {record.award && record.terms ? (
        <section className="security-offer" aria-label="Award and payment">
          <MetricGrid>
            <MetricTile
              label="Award"
              value={money(record.award.grossMinor, record.terms)}
              detail={
                awardPending(record) ? (
                  <StatusBadge tone="warning">
                    {awardPending(record)}
                  </StatusBadge>
                ) : undefined
              }
            />
          </MetricGrid>
          <div className="security-award-split">
            <div>
              <span>Researcher</span>
              <strong>
                {money(record.award.researcherMinor, record.terms)}
              </strong>
            </div>
            <div>
              <span>Slop</span>
              <strong>{money(record.award.slopMinor, record.terms)}</strong>
            </div>
          </div>
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
          <h4>
            Payment{" "}
            <NetworkName chain={record.settlement.network} iconOnly>
              {record.settlement.network}
            </NetworkName>{" "}
            <InfoTip text={record.settlement.privacyNotice} />
          </h4>
          {record.viewerRoles.includes("reporter") &&
          record.settlement.state !== "paid" ? (
            <p>
              <WalletLink />
            </p>
          ) : null}
          <dl className="operations-facts">
            {record.paymentRail === "direct" &&
            record.settlement.remainingTransfers ? (
              <Fact term="Progress">
                <PaymentProgress
                  confirmed={
                    record.settlement.confirmedTransactionIds?.length ?? 0
                  }
                  remaining={record.settlement.remainingTransfers.length}
                />
              </Fact>
            ) : null}
            {(
              record.settlement.transactionIds ??
              (record.settlement.transactionId
                ? [record.settlement.transactionId]
                : [])
            ).map((transactionId) => (
              <Fact
                term={
                  <span role="img" aria-label="Finalized" title="Finalized">
                    <Check aria-hidden="true" size={14} />
                  </span>
                }
                key={transactionId}
              >
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
              <RecoveryStatus
                mode={record.settlement.recovery.mode}
                payer={canPay}
                reporter={record.viewerRoles.includes("reporter")}
              />
              {record.settlement.recovery.mode === "wallet-required" ? (
                <WalletLink />
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
                  Verify
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
                  revision={record.revision}
                  generation={record.settlement.recovery.generation}
                  payer={record.settlement.recovery.payer}
                  messages={record.settlement.recovery.messages}
                  authorize={(isCurrent) =>
                    stillRecoverable(
                      (recovery) => recovery?.messages,
                      CASE_CHANGED,
                      isCurrent,
                    )
                  }
                  verify={async (signatures, isCurrent) => {
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
                      { isCurrent },
                    );
                    if (isCurrent && !isCurrent()) return;
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
                    authorize={() =>
                      stillRecoverable(
                        (recovery) => recovery?.cancellationRequest,
                        CASE_CHANGED,
                      )
                    }
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
                        throw new Error(CASE_CHANGED);
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
                      throw new Error(CASE_CHANGED);
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
                      throw new Error(CASE_CHANGED);
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
        <summary>History</summary>
        {record.receiptState ? (
          <p>
            {record.severity ? (
              <>
                <SeverityChip severity={record.severity} />{" "}
              </>
            ) : null}
            {record.lossFinding ? (
              <>
                <StatusBadge title="Loss of funds">
                  {record.lossFinding}
                </StatusBadge>{" "}
              </>
            ) : null}
            {record.remediationState ? (
              <>
                <StatusBadge title="Remediation">
                  {record.remediationState}
                </StatusBadge>{" "}
              </>
            ) : null}
            {record.disclosureState ? (
              <>
                <StatusBadge
                  icon={
                    record.disclosureState === "disclosed" ? (
                      <Eye />
                    ) : (
                      <LockKeyhole />
                    )
                  }
                  title="Disclosure"
                >
                  {record.disclosureState}
                </StatusBadge>{" "}
              </>
            ) : null}
            {record.recognition ? (
              <>
                <StatusBadge
                  icon={record.recognition === "opt-in" ? <Eye /> : <EyeOff />}
                  title="Recognition"
                >
                  {record.recognition}
                </StatusBadge>{" "}
              </>
            ) : null}
            {record.appealState && record.appealState !== "none" ? (
              <StatusBadge title="Appeal">
                Appeal {record.appealState}
              </StatusBadge>
            ) : null}
          </p>
        ) : null}
        <dl className="admin-facts">
          <Fact term="Case">
            <CopyIdentifier label="case ID" value={record.id} />
          </Fact>
          <Fact term="Terms">
            {record.terms
              ? money(record.terms.grossMinor, record.terms)
              : "None"}{" "}
            · rev {record.policyRevision ?? "—"}
          </Fact>
          {record.reporter ? (
            <Fact term="Reporter">@{record.reporter.githubLogin}</Fact>
          ) : null}
          {record.payee ? (
            <Fact term="Payee">@{record.payee.githubLogin}</Fact>
          ) : null}
          {owner && record.rootCauseKey ? (
            <Fact term="Root cause">{record.rootCauseKey}</Fact>
          ) : null}
          {owner && record.duplicateOf ? (
            <Fact term="Duplicate of">{record.duplicateOf}</Fact>
          ) : null}
          {owner && activeTriagers.length > 0 ? (
            <Fact term="Triagers">
              {activeTriagers
                .map((entry) => `@${entry.githubLogin}`)
                .join(", ")}
            </Fact>
          ) : null}
        </dl>
        {record.events && record.events.length > 0 ? (
          <ol className="security-history">
            {record.events.map((event) => {
              const digest =
                event.kind === "disclosure"
                  ? event.detail?.redactedContentDigest
                  : null;
              const embargo =
                event.kind === "disclosure"
                  ? event.detail?.embargoChange
                  : null;
              return (
                <li key={event.revision}>
                  <EventActor kind={event.kind} />{" "}
                  <strong>{EVENT_LABELS[event.kind] ?? event.kind}</strong>{" "}
                  {formatUtc(event.at)}
                  {event.reason ||
                  event.evidenceReference ||
                  digest ||
                  embargo ? (
                    <details>
                      <summary>Details</summary>
                      {event.reason ? <p>{event.reason}</p> : null}
                      {event.evidenceReference ? (
                        <p>Evidence: {event.evidenceReference}</p>
                      ) : null}
                      {digest ? <p>SHA-256: {digest}</p> : null}
                      {embargo ? <p>Embargo: {embargo}</p> : null}
                    </details>
                  ) : null}
                </li>
              );
            })}
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
        <GithubIcon aria-hidden="true" size={16} />{" "}
        {busy ? "Checking…" : "Confirm"}
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
  useLayoutEffect(() => {
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
      options?: { expectedActorGithubId?: string; isCurrent?: () => boolean },
    ): Promise<T> => {
      const assertCurrent = () => {
        if (!mounted.current || options?.isCurrent?.() === false)
          throw new Error("This private report action was closed.");
      };
      assertCurrent();
      if (actorId === null)
        throw new Error("Sign in before accessing private reports.");
      const verifyIdentity = async () => {
        let current: Awaited<ReturnType<typeof currentProjectSession>>;
        try {
          current = await currentProjectSession();
        } catch {
          assertCurrent();
          if (mounted.current) setProblem("Session check failed.");
          throw new Error("Your private session could not be verified.");
        }
        assertCurrent();
        if (!current || current.githubId !== actorId) {
          clearAllDrafts();
          setProblem(current ? "Account switched." : "Signed out.");
          onIdentityChange?.(current?.githubId ?? null);
          throw new Error("Your account changed or signed out.");
        }
      };
      await verifyIdentity();
      assertCurrent();
      let value: T;
      try {
        value = await projectApiRequest<T>(method, path, body, {
          expectedActorGithubId: actorId,
        });
      } catch (cause) {
        assertCurrent();
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
              cause.status === 401 ? "Signed out." : "Access revoked.",
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
        assertCurrent();
        throw cause;
      }
      assertCurrent();
      await verifyIdentity();
      assertCurrent();
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
        setProblem("Account mismatch.");
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
          Reload
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
    body = <Spinner label="Checking private session…" />;
  else
    body = (
      <SignInPanel
        next={embedded ? "/inbox?view=reports" : "/security"}
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
    (caseId: string | null) => {
      setSelected(caseId);
      const query = new URLSearchParams(window.location.search);
      if (caseId) query.set("case", caseId);
      else query.delete("case");
      window.history.replaceState(
        window.history.state,
        "",
        `${embedded ? "/inbox" : "/security"}?${query}`,
      );
      if (caseId) reload();
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
    body = <SignInPanel next="/security" state={session} />;
  } else if (list.status === "signed-out") {
    body = (
      <SignInPanel
        next="/security"
        purpose="Your session ended."
        state={{ status: "signed-out" }}
      />
    );
  } else if (list.status === "loading") {
    body = <Spinner label="Loading your cases…" />;
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
        Account changed.{" "}
        <button
          className="text-button"
          type="button"
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      </div>
    );
  } else {
    const maintained = new Set(
      list.value.programs
        .filter((entry) => entry.roles.includes("security-maintainer"))
        .map((entry) => entry.projectId),
    );
    const filterCount = (kind: ReportFilter) =>
      list.value.cases.filter((record) => matchesReport(record, kind)).length;
    body = (
      <>
        {note ? <p role="status">{note}</p> : null}
        {list.refreshError ? (
          <StaleNotice error={list.refreshError} onRetry={reload} />
        ) : null}
        {maintained.size > 0 ? (
          <label>
            <span className="visually-hidden">Show reports</span>
            <select
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value as ReportFilter);
                openCase(null);
              }}
            >
              <option value="all">All</option>
              <option value="review">Review {filterCount("review")}</option>
              <option value="waiting">Waiting {filterCount("waiting")}</option>
              <option value="award">Award {filterCount("award")}</option>
              <option value="resolved">Closed {filterCount("resolved")}</option>
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
            <h2 id="security-cases">Cases</h2>
            {list.value.authorityUnavailable ? (
              <p className="admin-status" role="status">
                <StatusBadge
                  tone="warning"
                  icon={<CircleAlert />}
                  title="Some maintainer access could not be checked"
                >
                  Partial list
                </StatusBadge>{" "}
                <RetryButton label="Retry access check" onClick={reload} />
              </p>
            ) : null}
            {list.value.cases.length === 0 ? (
              <p className="admin-status">No cases</p>
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
                        onClick={() => openCase(record.id)}
                        type="button"
                      >
                        <span>{record.projectId}</span>
                        <strong title={record.id}>{caseTitle(record)}</strong>
                        <span>
                          <StatusBadge
                            tone={
                              RECEIPT_TONES[record.receiptState ?? ""] ??
                              "neutral"
                            }
                          >
                            {record.receiptState
                              ? (RECEIPT_LABELS[record.receiptState] ??
                                record.receiptState)
                              : SUBMISSION_LABELS[record.submissionState][0]}
                          </StatusBadge>{" "}
                          <small>{record.nextStep}</small>
                        </span>
                        <span>
                          <StatusBadge title="Award">
                            {awardShort(record)}
                          </StatusBadge>
                        </span>
                      </button>
                    </li>
                  ))}
              </ul>
            )}
            {selected ? (
              <>
                <button
                  aria-label="Back to reports"
                  type="button"
                  className="text-button"
                  title="Back to reports"
                  onClick={() => openCase(null)}
                >
                  <ArrowLeft aria-hidden="true" />
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
            <summary>
              <GithubIcon aria-hidden="true" size={14} /> Link report
            </summary>
            {automatic ? (
              <section
                aria-label="Verify a GitHub report"
                className="admin-section"
                id="security-link"
              >
                <DirectVerifyForm
                  onUnavailable={() => setDirectUnavailable(true)}
                  programProjects={programProjects}
                />
                {linkFallback || directUnavailable ? (
                  <>
                    <p className="admin-status">
                      Not verified. Link for maintainer review:
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
                aria-label="Link a GitHub report"
                className="admin-section"
                id="security-link"
              >
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
                <h2 id="security-import">Import</h2>
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
