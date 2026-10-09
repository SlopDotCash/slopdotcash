import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ContributionQualityReview } from "./ContributionQualityReview";
import { browserDeployment } from "./lib/browser-deployment";
import { readBoundedJson } from "./lib/browser-json";
import { copyText } from "./lib/copy-text";
import type { CycleIndex, CycleIndexEntry } from "./lib/cycle-index";
import type { ProjectFundingIndex } from "./lib/funding";
import { commitmentVerifiedNetMinor } from "./lib/funding-commitment";
import {
  assertLiveVaultObservation,
  displayUsdc,
  formatUsdc,
  type LiveVaultObservation,
  parseUsdc,
  prepareReviewAdjustments,
  type ReviewAdjustment,
  reviewedVaultFunding,
  walletLockLabel,
} from "./lib/funding-review";
import {
  assertFundingReviewIndex,
  type FundingReviewIndex,
} from "./lib/funding-review-data";
import { applyFundingReviewSubmission } from "./lib/funding-review-submission";
import type { ProjectDefinition } from "./lib/projects.mjs";
import { isSolanaAddress } from "./lib/wallets";
import { formatDate, formatMicroUsdc } from "./Presentation";
import { SquadsTracking } from "./SquadsTracking";

type ReviewState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; index: FundingReviewIndex };
type RecipientFilter = "all" | "missing" | "changed" | "excluded" | "review";
const PAGE_SIZE = 25;
const STEPS = [
  "Review recipients",
  "Prepare funding",
  "Approve cycle",
  "Track payments",
] as const;
const FILTERS: { id: RecipientFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "missing", label: "Missing destination" },
  { id: "changed", label: "Changed amount" },
  { id: "excluded", label: "Proposed exclusion" },
  { id: "review", label: "Needs review" },
];
const PAYMENT_STATE_LABELS: Record<
  CycleIndexEntry["contributors"][number]["state"],
  string
> = {
  proposed: "Proposed, not approved",
  approved: "Approved, not paid",
  unclaimed: "Approved, needs a destination",
  held: "Held",
  "held-below-minimum": "Held below minimum",
  excluded: "Excluded",
  paid: "Paid, verified",
  "external-share": "External share",
};

function download(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([`${JSON.stringify(value, null, 2)}\n`], {
      type: "application/json",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function StepStatus({
  tone,
  children,
}: {
  tone: "done" | "blocked" | "waiting";
  children: string;
}) {
  return (
    <p className={`step-status step-status-${tone}`}>
      <strong>
        {tone === "done" ? "Ready" : tone === "blocked" ? "Blocked" : "Waiting"}
      </strong>{" "}
      {children}
    </p>
  );
}

export function FundingReview({
  project,
  sourceRepositoryUrl,
  cycleIndex,
  funding,
}: {
  project: ProjectDefinition;
  sourceRepositoryUrl: string;
  cycleIndex: CycleIndex | null;
  funding: ProjectFundingIndex | null;
}) {
  const repo = sourceRepositoryUrl;
  const [state, setState] = useState<ReviewState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [selectedCycle, setSelectedCycle] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RecipientFilter>("all");
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [rawAmounts, setRawAmounts] = useState<Record<string, string>>({});
  const [adjustments, setAdjustments] = useState<
    Record<string, ReviewAdjustment>
  >({});
  const [message, setMessage] = useState("");
  const [invalidAmounts, setInvalidAmounts] = useState<Record<string, boolean>>(
    {},
  );
  const [step, setStep] = useState(1);
  const [funder, setFunder] = useState("");
  const [steward, setSteward] = useState("");
  const [funderAddress, setFunderAddress] = useState("");
  const [stewardAddress, setStewardAddress] = useState("");
  const [feeAddress, setFeeAddress] = useState("");
  const [transaction, setTransaction] = useState("");
  const [vaultObservation, setVaultObservation] =
    useState<LiveVaultObservation | null>(null);
  const [vaultChecking, setVaultChecking] = useState(false);
  const [vaultMessage, setVaultMessage] = useState("");
  const [copied, setCopied] = useState<"inputs" | "request" | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    setState({ status: "loading" });
    void fetch(`/data/funding-reviews.json?attempt=${attempt}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            `Funding review request failed (${response.status}).`,
          );
        return assertFundingReviewIndex(
          await readBoundedJson(response, 4 * 1024 * 1024, "Funding review"),
        );
      })
      .then((index) => {
        if (active) setState({ status: "ready", index });
      })
      .catch((error: unknown) => {
        if (active)
          setState({
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "Funding review unavailable.",
          });
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [attempt]);
  const reviews =
    state.status === "ready"
      ? state.index.reviews.filter((r) => r.projectId === project.id)
      : [];
  const cycleIds = [
    ...new Set([
      ...reviews.map((r) => r.cycleId),
      ...(cycleIndex?.cycles
        .filter((c) => c.projectId === project.id)
        .map((c) => c.cycleId) ?? []),
    ]),
  ]
    .sort()
    .reverse();
  const cycleId = cycleIds.includes(selectedCycle)
    ? selectedCycle
    : cycleIds[0] || "";
  const currentContext = useRef("");
  currentContext.current = `${project.id}:${cycleId}`;
  const review = reviews.find((r) => r.cycleId === cycleId);
  const published = cycleIndex?.cycles.find(
    (c) => c.projectId === project.id && c.cycleId === cycleId,
  );
  const recipients = useMemo(
    () =>
      published
        ? published.contributors.map((r) => ({
            ...r,
            simulatedMinor: r.suggestedMinor,
            lookupUnavailable: false,
          }))
        : (review?.contributors ?? []).map((r) => ({
            ...r,
            simulatedMinor: r.simulatedMinor ?? "0",
          })),
    [published, review],
  );
  const canEdit =
    !!cycleIndex &&
    state.status === "ready" &&
    !!(published || review) &&
    (!published ||
      (published.state === "review" &&
        !!published.reviewEndsAt &&
        Date.parse(published.reviewEndsAt) > Date.now()));
  const capMinor = published?.reward.capMinor ?? review?.capMinor ?? "0";
  const availableReviewMinor = (
    BigInt(capMinor) +
    BigInt(published?.reward.reviewBudgetCapMinor ?? "0") +
    BigInt(published?.reward.carriedMinor ?? "0")
  ).toString();
  const selection = useMemo(() => {
    try {
      return {
        result: prepareReviewAdjustments(
          recipients,
          Object.values(adjustments),
          availableReviewMinor,
        ),
        error: null,
      };
    } catch (error: unknown) {
      return {
        result: null,
        error: error instanceof Error ? error.message : "Review is invalid.",
      };
    }
  }, [recipients, adjustments, availableReviewMinor]);
  const draftKey = `slop:funding-review:${project.id}:${cycleId}:${published?.files.proposal.sha256 ?? review?.sourceSnapshotSha256 ?? "unavailable"}:${capMinor}`;
  useEffect(() => {
    setAdjustments({});
    setRawAmounts({});
    setInvalidAmounts({});
    setExpanded({});
    setMessage("");
    try {
      const stored = localStorage.getItem(draftKey);
      if (!stored) return;
      const value: unknown = JSON.parse(stored);
      if (
        !Array.isArray(value) ||
        value.some(
          (r) =>
            !r ||
            typeof r !== "object" ||
            Object.keys(r).sort().join() !==
              "actorId,amountMinor,decision,reason" ||
            typeof r.actorId !== "string" ||
            typeof r.reason !== "string" ||
            !["include", "exclude"].includes(r.decision) ||
            typeof r.amountMinor !== "string",
        )
      )
        throw new Error("Invalid saved draft.");
      const candidate = value as ReviewAdjustment[];
      prepareReviewAdjustments(recipients, candidate, availableReviewMinor);
      setAdjustments(Object.fromEntries(candidate.map((r) => [r.actorId, r])));
      setMessage("Saved draft restored for this exact source and budget.");
    } catch {
      setMessage(
        "Saved draft could not be restored. Source records remain unchanged.",
      );
    }
  }, [draftKey, recipients, availableReviewMinor]);
  const hasInvalidAmount = Object.values(invalidAmounts).some(Boolean);
  const exportable = canEdit && !!selection.result && !hasInvalidAmount;
  function saveDraft() {
    if (!exportable) return;
    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify(Object.values(adjustments)),
      );
      setMessage(
        "Draft saved on this device. GitHub review is still required.",
      );
    } catch {
      setMessage("This browser cannot save the draft. Download it instead.");
    }
  }
  const instrument = project.funding.commitments?.find(
    (v) => v.monthlyCommitment?.cycleId === cycleId,
  );
  const vault = instrument?.kind === "squads-v4-vault" ? instrument : undefined;
  const projectVault =
    instrument?.kind === "squads-project-vault" ? instrument : undefined;
  let vaultError: string | null = null;
  let vaultLedger: ReturnType<typeof reviewedVaultFunding> | null = null;
  try {
    if (vault && funding)
      vaultLedger = reviewedVaultFunding(
        project.id,
        vault,
        funding.commitments,
      );
  } catch (error: unknown) {
    vaultError =
      error instanceof Error ? error.message : "Vault ledger unavailable.";
  }
  const projectVaultRecords =
    projectVault && funding
      ? funding.commitments.filter(
          (r) =>
            r.projectId === project.id &&
            "vault" in r.instrument &&
            r.instrument.vault === projectVault.vault &&
            r.instrument.multisig === projectVault.multisig,
        )
      : [];
  const verifiedNetMinor = vaultLedger
    ? vaultLedger.netMinor
    : projectVaultRecords.length > 0
      ? commitmentVerifiedNetMinor(projectVaultRecords).toString()
      : null;
  // A zero or negative verified net is not a deposit; never show it as done.
  const hasVerifiedDeposit =
    verifiedNetMinor !== null && BigInt(verifiedNetMinor) > 0n;
  async function refreshVault() {
    if (!vault) return;
    const requestContext = currentContext.current;
    setVaultChecking(true);
    setVaultMessage("");
    setVaultObservation(null);
    try {
      const response = await fetch(
        `${browserDeployment.api}/api/v1/projects/${encodeURIComponent(project.id)}/funding/${cycleId}`,
        { cache: "no-store", signal: AbortSignal.timeout(35000) },
      );
      if (!response.ok)
        throw new Error(
          response.status === 404
            ? "No reviewed vault is available on the verification service."
            : "Vault verification is unavailable. No balance is assumed.",
        );
      const observation = assertLiveVaultObservation(
        await readBoundedJson(response, 32000, "Vault observation"),
        project.id,
        cycleId,
        vault,
      );
      if (currentContext.current !== requestContext) return;
      setVaultObservation(observation);
      setVaultMessage(
        "Finalized vault state verified. This does not authorize payment.",
      );
    } catch (error: unknown) {
      if (currentContext.current !== requestContext) return;
      setVaultMessage(
        error instanceof Error ? error.message : "Vault verification failed.",
      );
    } finally {
      if (currentContext.current === requestContext) setVaultChecking(false);
    }
  }
  const rowFacts = (r: (typeof recipients)[number]) => {
    const a = adjustments[r.actor.id];
    const decision =
      a?.decision ??
      ("state" in r && r.state === "excluded" ? "exclude" : "include");
    const amountMinor =
      decision === "exclude" ? "0" : (a?.amountMinor ?? r.simulatedMinor);
    const changed =
      !!a && (a.decision === "exclude" || a.amountMinor !== r.simulatedMinor);
    const missing = !r.wallet && !r.lookupUnavailable;
    const needsReview =
      (changed && !a?.reason.trim()) ||
      r.lookupUnavailable ||
      !!invalidAmounts[r.actor.id];
    return { a, decision, amountMinor, changed, missing, needsReview };
  };
  const counts = {
    all: recipients.length,
    missing: 0,
    changed: 0,
    excluded: 0,
    review: 0,
  };
  for (const r of recipients) {
    const facts = rowFacts(r);
    if (facts.missing) counts.missing += 1;
    if (facts.changed) counts.changed += 1;
    if (facts.decision === "exclude") counts.excluded += 1;
    if (facts.needsReview) counts.review += 1;
  }
  const matching = recipients.filter((r) => {
    if (!r.actor.login.toLowerCase().includes(query.trim().toLowerCase()))
      return false;
    const facts = rowFacts(r);
    if (filter === "missing") return facts.missing;
    if (filter === "changed") return facts.changed;
    if (filter === "excluded") return facts.decision === "exclude";
    if (filter === "review") return facts.needsReview;
    return true;
  });
  const pageCount = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = matching.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE,
  );
  const change = (actorId: string, patch: Partial<ReviewAdjustment>) => {
    const recipient = recipients.find((r) => r.actor.id === actorId);
    if (!recipient) return;
    setAdjustments((previous) => ({
      ...previous,
      [actorId]: {
        ...(previous[actorId] ?? {
          actorId,
          decision: "include",
          amountMinor: recipient.simulatedMinor,
          reason: "",
        }),
        ...patch,
      },
    }));
    setMessage("");
  };
  async function exportReview() {
    if (!canEdit) {
      setMessage(
        "A current complete cycle and proposal state are required before exporting.",
      );
      return;
    }
    if (hasInvalidAmount) {
      setMessage("Correct invalid USDC amounts before downloading.");
      return;
    }
    if (!selection.result) {
      setMessage(selection.error ?? "Review unavailable.");
      return;
    }
    if (published) {
      try {
        const response = await fetch(published.files.proposal.url, {
          cache: "no-store",
          signal: AbortSignal.timeout(12000),
        });
        if (!response.ok)
          throw new Error(
            "Exact proposal is unavailable. Retry before exporting.",
          );
        const source = new Uint8Array(await response.arrayBuffer());
        if (source.byteLength > 8 * 1024 * 1024)
          throw new Error("Proposal exceeds supported size.");
        const submission = {
          schemaVersion: "1",
          kind: "funding-review-submission",
          projectId: project.id,
          cycleId,
          sourceProposalSha256: published.files.proposal.sha256,
          adjustments: Object.values(adjustments).map((row) => ({
            ...row,
            amountMinor: row.decision === "exclude" ? "0" : row.amountMinor,
          })),
        };
        const candidate = await applyFundingReviewSubmission(
          source,
          submission,
        );
        download(candidate, "proposal.json");
        setMessage(
          "Validated proposal downloaded. Upload it through a GitHub PR; no awards or payments are approved.",
        );
      } catch (error: unknown) {
        setMessage(
          error instanceof Error ? error.message : "Proposal export failed.",
        );
      }
      return;
    }
    download(
      {
        schemaVersion: "1",
        kind: "funding-review-request",
        status: "draft",
        projectId: project.id,
        cycleId,
        sourceSnapshotSha256: review?.sourceSnapshotSha256,
        proposalSha256: null,
        capMinor,
        ...selection.result,
        createdAt: new Date().toISOString(),
      },
      `${project.id}-${cycleId}-funding-review.json`,
    );
    setMessage(
      "Review downloaded. Upload it to the GitHub review; nothing has been approved or paid.",
    );
  }
  async function copyValue(kind: "inputs" | "request", value: string) {
    try {
      await copyText(value);
      setCopied(kind);
      setCopyFailed(false);
    } catch {
      setCopied(kind);
      setCopyFailed(true);
    }
  }
  const sourceSha =
    review?.sourceSnapshotSha256 ??
    published?.files.sourceSnapshot.sha256 ??
    "No complete preparation published";
  const requestText = `Funding review: ${project.id} ${cycleId}\n\nPlease review the attached funding review for ${project.name}, contribution month ${cycleId}.\n\nSource snapshot: ${sourceSha}\n\nThe attached review JSON contains all contributors, original amounts, proposed changes and reasons. This request is not payment approval.`;
  const cycleAction = !published
    ? "propose"
    : published.files.executionPlan
      ? "verify-settlement"
      : published.files.allocation
        ? "reserve-settlement"
        : "finalize-allocation";
  const requiredSha =
    published?.files.executionPlan?.sha256 ??
    published?.files.allocation?.sha256 ??
    published?.files.proposal.sha256 ??
    review?.sourceSnapshotSha256 ??
    "";
  const workflowInputs = `branch: main\nproject: ${project.id}\nmonth: ${cycleId}\naction: ${cycleAction}\nsource SHA-256: ${requiredSha}`;
  const paymentsDisabled = project.reward.paymentMode === "disabled";
  const reviewOpen =
    published?.state === "review" &&
    !!published.reviewEndsAt &&
    Date.parse(published.reviewEndsAt) > Date.now();
  const stepStatus: {
    tone: "done" | "blocked" | "waiting";
    text: string;
  }[] = [
    !cycleIndex
      ? { tone: "blocked", text: "Cycle records are unavailable." }
      : !canEdit
        ? {
            tone: published ? "done" : "waiting",
            text: published
              ? "The published proposal is read only."
              : "No complete preparation is available.",
          }
        : selection.error || hasInvalidAmount
          ? {
              tone: "blocked",
              text: hasInvalidAmount
                ? "Correct the invalid amounts."
                : (selection.error ?? "Review is invalid."),
            }
          : {
              tone: "done",
              text: `${counts.missing} missing destination${counts.missing === 1 ? "" : "s"}, ${counts.changed} changed.`,
            },
    !vault && !projectVault
      ? { tone: "waiting", text: "No reviewed vault for this month." }
      : paymentsDisabled
        ? { tone: "blocked", text: "Payments are disabled. Do not deposit." }
        : !hasVerifiedDeposit || verifiedNetMinor === null
          ? { tone: "waiting", text: "No verified deposit." }
          : {
              tone: "done",
              text: `${formatMicroUsdc(verifiedNetMinor)} verified.`,
            },
    !published
      ? { tone: "waiting", text: "No funded proposal is published." }
      : published.files.allocation
        ? { tone: "done", text: "Allocation approved." }
        : reviewOpen && published.reviewEndsAt
          ? {
              tone: "waiting",
              text: `Review open until ${formatDate(published.reviewEndsAt)}.`,
            }
          : { tone: "waiting", text: "Waiting for maintainer approval." },
    !published?.files.executionPlan
      ? { tone: "waiting", text: "Payments are not authorized." }
      : published.files.settlement
        ? { tone: "done", text: "Settlement evidence published." }
        : { tone: "waiting", text: "Unsigned plan published. Not paid." },
  ];
  return (
    <section
      className="funding-workbench"
      aria-labelledby="funding-review-title"
    >
      <div className="simple-heading">
        <div>
          <h2 id="funding-review-title">Manage payouts</h2>
          <p>
            Drafts stay on this device. GitHub review approves awards; signers
            send payments outside Slop.{" "}
            <a
              href={`${repo}/blob/${browserDeployment.branch}/funding/maintainer-payouts.md`}
            >
              Step-by-step guide
            </a>
          </p>
        </div>
      </div>
      {state.status === "loading" ? (
        <p role="status">Loading complete monthly reviews…</p>
      ) : state.status === "error" ? (
        <div role="alert">
          <p>{state.message}</p>
          <button type="button" onClick={() => setAttempt((n) => n + 1)}>
            Retry funding reviews
          </button>
        </div>
      ) : null}
      {state.status === "ready" && cycleIds.length === 0 ? (
        <div className="data-notice">
          <p>No complete monthly review has been published for this project.</p>
          <a href={`${repo}/actions/workflows/prepare-funding-review.yml`}>
            Prepare a closed month on GitHub
          </a>
        </div>
      ) : null}
      {cycleIds.length > 0 && (
        <>
          <label className="review-cycle-selector">
            Contribution month
            <select
              value={cycleId}
              onChange={(event) => {
                setSelectedCycle(event.target.value);
                setAdjustments({});
                setInvalidAmounts({});
                setRawAmounts({});
                setExpanded({});
                setPage(0);
                setVaultObservation(null);
                setVaultMessage("");
                setVaultChecking(false);
                setMessage("");
              }}
            >
              {cycleIds.map((id) => (
                <option key={id}>{id}</option>
              ))}
            </select>
          </label>
          {project.reward.kind === "external-prize-share" ? (
            <p className="data-notice">
              This project publishes external-prize shares. It does not use the
              USDC vault payment flow.
            </p>
          ) : (
            <>
              {paymentsDisabled ? (
                <p className="payments-disabled-notice" role="note">
                  <strong>Payments are disabled for this project.</strong> Do
                  not deposit yet.{" "}
                  <a href={`${repo}/issues/333`}>
                    View outstanding requirements
                  </a>
                </p>
              ) : null}
              <div className="payout-summary">
                <p>
                  <small>Month’s cap</small>
                  <strong>{formatUsdc(capMinor)} USDC</strong>
                </p>
                <p>
                  <small>Contributors</small>
                  <strong>{recipients.length}</strong>
                </p>
                <p>
                  <small>Missing destinations</small>
                  <strong>{counts.missing}</strong>
                </p>
                <p>
                  <small>Verified paid</small>
                  <strong>
                    {cycleIndex
                      ? `${displayUsdc(published?.reward.paidMinor ?? "0")} USDC`
                      : "Unavailable"}
                  </strong>
                </p>
              </div>
              <nav aria-label="Payout steps">
                <ol className="payout-steps">
                  {STEPS.map((label, index) => (
                    <li key={label}>
                      <button
                        type="button"
                        aria-current={step === index + 1 ? "step" : undefined}
                        onClick={() => setStep(index + 1)}
                      >
                        <span className="step-number">{index + 1}</span>
                        <span className="step-label">{label}</span>
                        <small
                          className={`step-tone step-tone-${stepStatus[index].tone}`}
                        >
                          {stepStatus[index].text}
                        </small>
                      </button>
                    </li>
                  ))}
                </ol>
              </nav>
              {step === 1 && (
                <>
                  <h3>Review recipients</h3>
                  <StepStatus tone={stepStatus[0].tone}>
                    {stepStatus[0].text}
                  </StepStatus>
                  {review &&
                    review.rewardKind === "monthly-pool" &&
                    !published &&
                    canEdit && (
                      <ContributionQualityReview
                        key={`${review.projectId}:${review.cycleId}:${review.sourceSnapshotSha256}`}
                        preparation={review}
                        capMinor={capMinor}
                        onApply={(rows) => {
                          setAdjustments((previous) =>
                            Object.fromEntries(
                              rows.map((row) => [
                                row.actorId,
                                previous[row.actorId]?.decision === "exclude"
                                  ? previous[row.actorId]
                                  : row,
                              ]),
                            ),
                          );
                          setRawAmounts({});
                          setInvalidAmounts({});
                        }}
                      />
                    )}
                  {published?.reward.carriedMinor &&
                    published.reward.carriedMinor !== "0" && (
                      <p>
                        Retained principal from prior cycles:{" "}
                        {formatUsdc(published.reward.carriedMinor)} USDC. This
                        does not raise this month’s cap.
                      </p>
                    )}
                  {published?.reward.reviewBudgetCapMinor && (
                    <p>
                      Separate review budget:{" "}
                      {formatUsdc(published.reward.reviewBudgetCapMinor)} USDC.
                    </p>
                  )}
                  {!published && project.reward.reviewBudget && (
                    <p>
                      This preparation covers the shared pool. The separate
                      review budget is verified in the funded proposal.
                    </p>
                  )}
                  {!cycleIndex && (
                    <p role="alert">
                      Published cycle state is unavailable. Review actions are
                      disabled until it loads.
                    </p>
                  )}
                  {recipients.some((r) => r.lookupUnavailable) && (
                    <p role="alert">
                      Some wallet lookups failed. These contributors remain
                      included; refresh their proofs before freezing.
                    </p>
                  )}
                  <p>
                    {published
                      ? "Published cycle records. An amount change needs a reviewed successor proposal and restarts its 14-day review."
                      : "Suggestions from the complete monthly census. Everyone stays included until a maintainer gives a reason for a change."}
                  </p>
                  <div className="review-working-summary" aria-live="polite">
                    {selection.result ? (
                      <p>
                        Proposed{" "}
                        <strong>
                          {formatUsdc(selection.result.totalMinor)} USDC
                        </strong>{" "}
                        · Unallocated{" "}
                        {formatUsdc(selection.result.unallocatedMinor)} USDC ·
                        Maximum fee{" "}
                        {formatUsdc(selection.result.maximumFeeMinor)} USDC
                      </p>
                    ) : (
                      <p role="alert">{selection.error}</p>
                    )}
                    <div className="review-actions">
                      <button
                        type="button"
                        disabled={!exportable}
                        onClick={saveDraft}
                      >
                        Save draft on this device
                      </button>
                      <button
                        type="button"
                        disabled={!exportable}
                        onClick={() => void exportReview()}
                      >
                        Download review
                      </button>
                      {published ? (
                        <a
                          href={`${repo}/upload/development/cycles/${project.id}/${cycleId}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open proposal PR
                        </a>
                      ) : (
                        <>
                          <a
                            href={`${repo}/issues/new`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open GitHub review
                          </a>
                          <button
                            type="button"
                            onClick={() =>
                              void copyValue("request", requestText)
                            }
                          >
                            {copied === "request"
                              ? copyFailed
                                ? "Copy unavailable; select the request text"
                                : "Request text copied"
                              : "Copy request text"}
                          </button>
                        </>
                      )}
                    </div>
                    {copied === "request" && copyFailed ? (
                      <textarea
                        aria-label="Funding review request text"
                        readOnly
                        value={requestText}
                      />
                    ) : null}
                  </div>
                  <div className="review-filters">
                    <label>
                      Find contributor
                      <input
                        type="search"
                        value={query}
                        onChange={(e) => {
                          setQuery(e.target.value);
                          setPage(0);
                        }}
                      />
                    </label>
                    <fieldset>
                      <legend>Show</legend>
                      {FILTERS.map((option) => (
                        <button
                          aria-pressed={filter === option.id}
                          key={option.id}
                          onClick={() => {
                            setFilter(option.id);
                            setPage(0);
                          }}
                          type="button"
                        >
                          {option.label} ({counts[option.id]})
                        </button>
                      ))}
                    </fieldset>
                  </div>
                  <p aria-live="polite">
                    {matching.length === 0
                      ? `0 of ${recipients.length} contributors match.`
                      : `Showing ${currentPage * PAGE_SIZE + 1}–${currentPage * PAGE_SIZE + visible.length} of ${matching.length} matching contributors (${recipients.length} total).`}{" "}
                    Edits stay while you search, filter or change pages.
                  </p>
                  <section
                    className="plain-table-wrap"
                    aria-label="Scrollable payout records"
                  >
                    <table className="plain-table recipient-table">
                      <caption className="visually-hidden">
                        {project.name} {cycleId} payout review
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">Contributor</th>
                          <th scope="col">Award</th>
                          <th scope="col">Destination</th>
                          <th scope="col">Decision</th>
                          <th scope="col">
                            <span className="visually-hidden">Details</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {visible.map((r) => {
                          const { a, decision, amountMinor, changed } =
                            rowFacts(r);
                          const open = !!expanded[r.actor.id];
                          const panelId = `recipient-${r.actor.id}`;
                          const lockLabel = cycleIndex
                            ? walletLockLabel(published, r.actor.id)
                            : "Lock status unavailable";
                          return (
                            <Fragment key={`${cycleId}:${r.actor.id}`}>
                              <tr className="recipient-row">
                                <th scope="row">
                                  <a
                                    href={`https://github.com/${encodeURIComponent(r.actor.login)}`}
                                  >
                                    {r.actor.login}
                                  </a>
                                </th>
                                <td>
                                  {invalidAmounts[r.actor.id]
                                    ? "Invalid amount"
                                    : formatMicroUsdc(amountMinor)}
                                  {changed ? (
                                    <small>
                                      was {formatMicroUsdc(r.simulatedMinor)}
                                    </small>
                                  ) : null}
                                </td>
                                <td>
                                  {r.wallet
                                    ? "Registered"
                                    : r.lookupUnavailable
                                      ? "Wallet lookup unavailable"
                                      : "Missing registration"}
                                  <small>{lockLabel}</small>
                                </td>
                                <td>
                                  {decision === "exclude"
                                    ? "Proposed exclusion"
                                    : "Include"}
                                  {changed && !a?.reason.trim() ? (
                                    <small>Needs a reason</small>
                                  ) : null}
                                </td>
                                <td>
                                  <button
                                    aria-controls={panelId}
                                    aria-expanded={open}
                                    aria-label={`Details for ${r.actor.login}`}
                                    onClick={() =>
                                      setExpanded((value) => ({
                                        ...value,
                                        [r.actor.id]: !open,
                                      }))
                                    }
                                    type="button"
                                  >
                                    Details
                                  </button>
                                </td>
                              </tr>
                              {open ? (
                                <tr className="recipient-details" id={panelId}>
                                  <td colSpan={5}>
                                    <div className="recipient-detail-grid">
                                      <div>
                                        <p>
                                          Suggested exact:{" "}
                                          <code>
                                            {displayUsdc(r.simulatedMinor)} USDC
                                          </code>
                                        </p>
                                        {r.wallet ? (
                                          <>
                                            <a href={r.wallet.sourceUrl}>
                                              Registered · view proof
                                            </a>
                                            <code className="wallet-address">
                                              {r.wallet.address}
                                            </code>
                                          </>
                                        ) : (
                                          <p>
                                            {r.lookupUnavailable
                                              ? "Wallet lookup unavailable."
                                              : "No registered destination. An approved award stays unclaimed until the contributor registers."}
                                          </p>
                                        )}
                                        <p>{lockLabel}</p>
                                        {published?.contributors.find(
                                          (c) => c.actor.id === r.actor.id,
                                        )?.wallet && (
                                          <a
                                            href={published.files.proposal.url}
                                          >
                                            View locked proposal
                                          </a>
                                        )}
                                      </div>
                                      <div>
                                        <label
                                          htmlFor={`decision-${r.actor.id}`}
                                        >
                                          Decision
                                          <span className="visually-hidden">
                                            {" "}
                                            for {r.actor.login}
                                          </span>
                                        </label>
                                        <select
                                          id={`decision-${r.actor.id}`}
                                          value={decision}
                                          disabled={!canEdit}
                                          onChange={(e) =>
                                            change(r.actor.id, {
                                              decision: e.target.value as
                                                | "include"
                                                | "exclude",
                                            })
                                          }
                                        >
                                          <option value="include">
                                            Include
                                          </option>
                                          <option value="exclude">
                                            Propose exclusion
                                          </option>
                                        </select>
                                        <label htmlFor={`amount-${r.actor.id}`}>
                                          USDC
                                          <span className="visually-hidden">
                                            {" "}
                                            for {r.actor.login}
                                          </span>
                                        </label>
                                        <input
                                          id={`amount-${r.actor.id}`}
                                          inputMode="decimal"
                                          disabled={
                                            !!published ||
                                            a?.decision === "exclude"
                                          }
                                          value={
                                            rawAmounts[r.actor.id] ??
                                            displayUsdc(
                                              a?.amountMinor ??
                                                r.simulatedMinor,
                                            )
                                          }
                                          onChange={(e) => {
                                            setRawAmounts((v) => ({
                                              ...v,
                                              [r.actor.id]: e.target.value,
                                            }));
                                            try {
                                              change(r.actor.id, {
                                                amountMinor: parseUsdc(
                                                  e.target.value,
                                                ),
                                              });
                                              e.target.setCustomValidity("");
                                              setInvalidAmounts((v) => ({
                                                ...v,
                                                [r.actor.id]: false,
                                              }));
                                            } catch {
                                              setInvalidAmounts((v) => ({
                                                ...v,
                                                [r.actor.id]: true,
                                              }));
                                              e.target.setCustomValidity(
                                                "Enter an exact USDC amount with up to six decimals.",
                                              );
                                              e.target.reportValidity();
                                            }
                                          }}
                                        />
                                        <label htmlFor={`reason-${r.actor.id}`}>
                                          Reason
                                          <span className="visually-hidden">
                                            {" "}
                                            for {r.actor.login}
                                          </span>
                                        </label>
                                        <textarea
                                          id={`reason-${r.actor.id}`}
                                          disabled={!canEdit}
                                          placeholder="Public reason for a change"
                                          value={a?.reason ?? ""}
                                          onChange={(e) =>
                                            change(r.actor.id, {
                                              reason: e.target.value,
                                            })
                                          }
                                        />
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              ) : null}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </section>
                  {pageCount > 1 ? (
                    <nav
                      aria-label="Recipient pages"
                      className="recipient-pagination"
                    >
                      <button
                        disabled={currentPage === 0}
                        onClick={() => setPage(currentPage - 1)}
                        type="button"
                      >
                        Previous page
                      </button>
                      <span>
                        Page {currentPage + 1} of {pageCount}
                      </span>
                      <button
                        disabled={currentPage >= pageCount - 1}
                        onClick={() => setPage(currentPage + 1)}
                        type="button"
                      >
                        Next page
                      </button>
                    </nav>
                  ) : null}
                  <p className="review-footnote">
                    Registered is a public receiving-address claim. Locked means
                    that exact destination is frozen in the published cycle.
                    Neither status means paid.{" "}
                    <a href="/account#wallets">Register your payout wallet</a>
                    {!published ? (
                      <>
                        {" · "}
                        <a
                          href={`${repo}/actions/workflows/prepare-funding-review.yml`}
                        >
                          Refresh registered wallets
                        </a>
                      </>
                    ) : null}
                  </p>
                  {review && (
                    <details>
                      <summary>Source and wallet observations</summary>
                      <p>
                        Snapshot SHA-256:{" "}
                        <code>{review.sourceSnapshotSha256}</code>
                      </p>
                      <p>
                        Wallet observations: {review.observedAt}. Refresh
                        registrations before freezing the funded proposal using
                        the wallet refresh workflow for this project and month.
                        A later registration applies to a later cycle.
                      </p>
                    </details>
                  )}
                </>
              )}
              {step === 2 && (
                <>
                  <h3>Prepare funding</h3>
                  <StepStatus tone={stepStatus[1].tone}>
                    {stepStatus[1].text}
                  </StepStatus>
                  {vaultError && (
                    <p role="alert">Vault funding unavailable: {vaultError}</p>
                  )}
                  <ol className="readiness-checklist">
                    <li data-state={published ? "done" : "open"}>
                      <strong>Recipients:</strong>{" "}
                      {published
                        ? "Proposal published."
                        : "Draft only. Export it from step 1."}{" "}
                      {counts.missing} missing destination
                      {counts.missing === 1 ? "" : "s"}.
                    </li>
                    <li data-state={vault || projectVault ? "done" : "open"}>
                      <strong>Monthly vault:</strong>{" "}
                      {vault || projectVault
                        ? "Reviewed configuration published."
                        : instrument?.kind === "sablier-lockup-v4"
                          ? "A Sablier instrument covers this month. This Solana flow needs a reviewed Squads vault."
                          : "No reviewed vault."}
                    </li>
                    <li data-state={paymentsDisabled ? "blocked" : "done"}>
                      <strong>Payout protocol:</strong>{" "}
                      {paymentsDisabled
                        ? "Payments are disabled in the project manifest."
                        : "Payments are enabled in the project manifest."}
                    </li>
                    <li data-state={hasVerifiedDeposit ? "done" : "open"}>
                      <strong>Deposit:</strong>{" "}
                      {hasVerifiedDeposit && verifiedNetMinor
                        ? `${formatUsdc(verifiedNetMinor)} USDC in the verified ledger. This is not a live balance.`
                        : "No verified deposit."}
                    </li>
                  </ol>
                  <h4>Next action</h4>
                  {!vault && !projectVault ? (
                    instrument?.kind === "sablier-lockup-v4" ? (
                      <p>
                        Do not deposit into a second instrument for the same
                        month. The reviewed Sablier instrument on{" "}
                        {instrument.network} stays separate.
                      </p>
                    ) : project.reward.chain !== "solana" ? (
                      <p>
                        This project settles on {project.reward.chain}. The
                        Squads vault intake on this page applies to Solana
                        projects only. A reviewed project vault on this network
                        is required before any deposit.
                      </p>
                    ) : (
                      <>
                        <p>
                          Submit the vault configuration for review. A funder
                          and an independent co-signer must approve the 2-of-2
                          vault before any deposit. Signing stays in your
                          wallet.
                        </p>
                        <label>
                          Funder GitHub account
                          <input
                            value={funder}
                            onChange={(e) => setFunder(e.target.value)}
                          />
                        </label>
                        <label>
                          Independent co-signer GitHub account
                          <input
                            value={steward}
                            onChange={(e) => setSteward(e.target.value)}
                          />
                        </label>
                        <label>
                          Funder’s public Solana address
                          <input
                            value={funderAddress}
                            maxLength={44}
                            spellCheck={false}
                            onChange={(e) =>
                              setFunderAddress(e.target.value.trim())
                            }
                          />
                        </label>
                        <label>
                          Co-signer’s public Solana address
                          <input
                            value={stewardAddress}
                            maxLength={44}
                            spellCheck={false}
                            onChange={(e) =>
                              setStewardAddress(e.target.value.trim())
                            }
                          />
                        </label>
                        <label>
                          Reviewed platform fee address
                          <input
                            value={feeAddress}
                            maxLength={44}
                            spellCheck={false}
                            onChange={(e) =>
                              setFeeAddress(e.target.value.trim())
                            }
                          />
                        </label>
                        <button
                          type="button"
                          disabled={
                            !/^[a-zA-Z0-9-]{1,39}$/.test(funder) ||
                            !/^[a-zA-Z0-9-]{1,39}$/.test(steward) ||
                            funder.toLowerCase() === steward.toLowerCase() ||
                            !isSolanaAddress(funderAddress) ||
                            !isSolanaAddress(stewardAddress) ||
                            !isSolanaAddress(feeAddress) ||
                            funderAddress === stewardAddress
                          }
                          onClick={() => {
                            download(
                              {
                                kind: "monthly-funding-intake",
                                status: "draft",
                                projectId: project.id,
                                cycleId,
                                principalCapMinor: capMinor,
                                funderGithub: funder,
                                independentStewardGithub: steward,
                                funderPublicAddress: funderAddress,
                                independentStewardPublicAddress: stewardAddress,
                                platformFeePublicAddress: feeAddress,
                              },
                              `${project.id}-${cycleId}-funding-intake.json`,
                            );
                            setMessage(
                              "Funding intake downloaded for review. No wallet was created or funded.",
                            );
                          }}
                        >
                          Download funding intake
                        </button>
                        <p>
                          <a href="https://docs.squads.so/main/getting-started/quickstart-guide">
                            Squads setup guide
                          </a>
                        </p>
                      </>
                    )
                  ) : paymentsDisabled ? (
                    <p>
                      Wait for the payout protocol review. Do not deposit into
                      the vault while payments are disabled.
                    </p>
                  ) : !vault ? (
                    <p>
                      Project vault deposit verification is not available in
                      this version. Do not submit a deposit for verification.
                    </p>
                  ) : (
                    <details open={!hasVerifiedDeposit}>
                      <summary>
                        Record a funding transaction for verification
                      </summary>
                      <p>
                        <a
                          href={`${repo}/actions/workflows/verify-funding-deposit.yml`}
                        >
                          Verify deposit on GitHub
                        </a>{" "}
                        — select main and enter project {project.id}, month{" "}
                        {cycleId}, and the public transaction signature. Review
                        the resulting evidence PR.
                      </p>
                      <label>
                        Public Solana transaction signature
                        <input
                          value={transaction}
                          onChange={(e) => setTransaction(e.target.value)}
                        />
                      </label>
                      <button
                        type="button"
                        disabled={
                          !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(transaction)
                        }
                        onClick={() => {
                          download(
                            {
                              kind: "funding-evidence-request",
                              status: "unverified",
                              projectId: project.id,
                              cycleId,
                              vault: vault.vault,
                              transactionId: transaction,
                            },
                            `${project.id}-${cycleId}-funding-evidence.json`,
                          );
                          setMessage(
                            "Verification request downloaded. A submitted signature is not verified funding.",
                          );
                        }}
                      >
                        Download verification request
                      </button>
                    </details>
                  )}
                  {vault ? (
                    <details>
                      <summary>Reviewed vault for {cycleId}</summary>
                      <p>
                        <a
                          href={`https://explorer.solana.com/address/${vault.vault}`}
                        >
                          {vault.vault}
                        </a>
                      </p>
                      <p>
                        Funder: <code>{vault.funderMember}</code> · Independent
                        steward: {vault.stewardGithub?.login ?? "Unspecified"}
                      </p>
                      <button
                        type="button"
                        onClick={() => void refreshVault()}
                        disabled={vaultChecking}
                      >
                        {vaultChecking
                          ? "Checking vault…"
                          : "Check live vault balance"}
                      </button>
                      {vaultObservation?.projectId === project.id &&
                        vaultObservation.cycleId === cycleId && (
                          <p>
                            Observed balance:{" "}
                            {displayUsdc(vaultObservation.balanceMinor)} USDC at{" "}
                            {vaultObservation.observedAt}.{" "}
                            {vaultObservation.coversCommitment
                              ? "Covers the declared principal."
                              : "Below the declared principal."}{" "}
                            Balance does not show signer capability or approve
                            payment.
                          </p>
                        )}
                      <p role="status">{vaultMessage}</p>
                      <a
                        href="https://app.squads.so"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open Squads
                      </a>
                    </details>
                  ) : projectVault ? (
                    <details>
                      <summary>Reviewed project vault for {cycleId}</summary>
                      <p>
                        <a
                          href={`https://explorer.solana.com/address/${projectVault.vault}`}
                        >
                          {projectVault.vault}
                        </a>
                      </p>
                      <p>
                        2-of-3 members: creator{" "}
                        <code>{projectVault.creatorMember}</code>, Slop
                        vote-only <code>{projectVault.slopMember}</code>,
                        independent {projectVault.independentGithub.login}. Time
                        lock: {projectVault.timeLockSeconds} seconds.
                      </p>
                      <p>
                        A live balance check is not available for this vault
                        type. The verified ledger above uses published evidence
                        only.
                      </p>
                    </details>
                  ) : null}
                </>
              )}
              {step === 3 && (
                <>
                  <h3>Approve cycle</h3>
                  <StepStatus tone={stepStatus[2].tone}>
                    {stepStatus[2].text}
                  </StepStatus>
                  {published ? (
                    <p>
                      Published state: {published.state.replaceAll("-", " ")}.
                      {published.reviewEndsAt
                        ? ` Review ends ${formatDate(published.reviewEndsAt)}.`
                        : ""}{" "}
                      Missing wallets stay unclaimed. A wallet change after the
                      freeze applies to a later cycle.
                    </p>
                  ) : (
                    <p>
                      Publish the verified funding policy first, then propose
                      the complete funded cycle. The public review lasts 14
                      days. A material amount change restarts it.
                    </p>
                  )}
                  <p>
                    GitHub review and maintainer approval decide. Related-party
                    awards need separate approval. A draft on this page cannot
                    approve an allocation.
                  </p>
                  <h4>Next action</h4>
                  <p>
                    Run the cycle workflow with these inputs. It prepares a
                    GitHub PR for review.
                  </p>
                  <dl className="workflow-inputs">
                    <dt>Branch</dt>
                    <dd>
                      <code>main</code>
                    </dd>
                    <dt>Project</dt>
                    <dd>
                      <code>{project.id}</code>
                    </dd>
                    <dt>Month</dt>
                    <dd>
                      <code>{cycleId}</code>
                    </dd>
                    <dt>Action</dt>
                    <dd>
                      <code>{cycleAction}</code>
                    </dd>
                    <dt>Source SHA-256</dt>
                    <dd>
                      <code>{requiredSha || "Unavailable"}</code>
                    </dd>
                  </dl>
                  <div className="review-actions">
                    <a
                      className="button primary-button"
                      href={`${repo}/actions/workflows/reward-cycle-actions.yml`}
                    >
                      Open cycle workflow
                    </a>
                    <button
                      type="button"
                      onClick={() => void copyValue("inputs", workflowInputs)}
                    >
                      {copied === "inputs"
                        ? copyFailed
                          ? "Copy unavailable; select the inputs"
                          : "Inputs copied"
                        : "Copy inputs"}
                    </button>
                  </div>
                  <details>
                    <summary>Source evidence</summary>
                    {published ? (
                      <ul>
                        <li>
                          <a href={published.files.proposal.url}>
                            Exact proposal
                          </a>{" "}
                          <code>{published.files.proposal.sha256}</code>
                        </li>
                        {published.files.allocation ? (
                          <li>
                            <a href={published.files.allocation.url}>
                              Approved allocation
                            </a>{" "}
                            <code>{published.files.allocation.sha256}</code>
                          </li>
                        ) : null}
                        <li>
                          Source snapshot{" "}
                          <code>{published.files.sourceSnapshot.sha256}</code>
                        </li>
                      </ul>
                    ) : (
                      <p>
                        Source snapshot <code>{sourceSha}</code>. Proposing also
                        needs the original snapshot artifact from the
                        preparation run. For an audited import, use its exact
                        archived source. Do not substitute a new snapshot.
                      </p>
                    )}
                    {published?.files.allocation &&
                      !published.files.executionPlan && (
                        <p>
                          First merge the reservation PR. Then run{" "}
                          <code>prepare-settlement</code> with the same
                          allocation hash to release its exact unsigned plan.
                          Reuse that plan on retries; do not create a
                          replacement payout.
                        </p>
                      )}
                  </details>
                </>
              )}
              {step === 4 && (
                <>
                  <h3>Track payments</h3>
                  <StepStatus tone={stepStatus[3].tone}>
                    {stepStatus[3].text}
                  </StepStatus>
                  {published?.files.executionPlan && (
                    <>
                      <SquadsTracking cycle={published} />
                      <p>
                        <a
                          href={`${repo}/actions/workflows/link-squads-execution.yml`}
                        >
                          Link your Squads proposal
                        </a>{" "}
                        — select main, {project.id}/{cycleId}, its public
                        transaction index, and single or batch mode. The
                        workflow checks every transfer before opening a binding
                        PR.
                      </p>
                    </>
                  )}
                  {!cycleIndex ? (
                    <p role="alert">
                      Payment records are unavailable. Retry the page’s data
                      request.
                    </p>
                  ) : !published ? (
                    <p>
                      No funded cycle has been published for this month yet.
                      Payments have not been authorized.
                    </p>
                  ) : (
                    <>
                      <p className="money-summary">
                        <span>
                          Approved {formatUsdc(published.reward.approvedMinor)}{" "}
                          USDC
                        </span>
                        <strong>
                          Paid {formatUsdc(published.reward.paidMinor)} USDC
                        </strong>
                        <span>
                          Fee {formatUsdc(published.reward.feeMinor)} USDC
                        </span>
                      </p>
                      {published.files.executionPlan ? (
                        <>
                          <a href={published.files.executionPlan.url}>
                            Download unsigned execution plan
                          </a>
                          <p>
                            <a
                              href={`${repo}/actions/workflows/reward-cycle-actions.yml`}
                            >
                              Verify settlement on GitHub
                            </a>{" "}
                            — choose verify-settlement for {project.id}/
                            {cycleId} and bind the transaction evidence to plan
                            SHA-256{" "}
                            <code>{published.files.executionPlan.sha256}</code>.
                          </p>
                        </>
                      ) : (
                        <p>No execution plan has been published.</p>
                      )}
                      {published.files.settlement && (
                        <p>
                          <a href={published.files.settlement.url}>
                            View finalized settlement evidence
                          </a>
                        </p>
                      )}
                      <section
                        className="plain-table-wrap"
                        aria-label="Scrollable payment status records"
                      >
                        <table className="plain-table">
                          <caption className="visually-hidden">
                            Payment status by contributor
                          </caption>
                          <thead>
                            <tr>
                              <th scope="col">Contributor</th>
                              <th scope="col">Status</th>
                              <th scope="col">Approved</th>
                              <th scope="col">Paid</th>
                            </tr>
                          </thead>
                          <tbody>
                            {published.contributors.map((r) => (
                              <tr key={`${cycleId}:${r.actor.id}`}>
                                <th scope="row">
                                  <a
                                    href={`/contributors/${encodeURIComponent(r.actor.login)}`}
                                  >
                                    {r.actor.login}
                                  </a>
                                </th>
                                <td>{PAYMENT_STATE_LABELS[r.state]}</td>
                                <td>{formatMicroUsdc(r.approvedMinor)}</td>
                                <td>{formatMicroUsdc(r.paidMinor)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </section>
                    </>
                  )}
                  <p>
                    Vault members sign outside Slop. A Squads approval or a
                    submitted transaction is not a payment. Paid needs finalized
                    principal and fee evidence that reconciles.
                  </p>
                  {vaultLedger && (
                    <section
                      className="plain-table-wrap"
                      aria-label="Scrollable vault funding records"
                    >
                      <table className="plain-table">
                        <caption>Vault funding history</caption>
                        <thead>
                          <tr>
                            <th scope="col">Event</th>
                            <th scope="col">USDC</th>
                            <th scope="col">Evidence state</th>
                          </tr>
                        </thead>
                        <tbody>
                          {vaultLedger.records.map((r) => (
                            <tr key={r.recordId}>
                              <td>
                                <a
                                  href={`https://explorer.solana.com/tx/${r.transactionId}`}
                                >
                                  {r.event}
                                </a>
                              </td>
                              <td>{displayUsdc(r.amountMinor)}</td>
                              <td>{r.state}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </section>
                  )}
                </>
              )}
            </>
          )}
          <p role="status">{message}</p>
        </>
      )}
    </section>
  );
}
