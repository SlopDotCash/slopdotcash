import { useEffect, useMemo, useRef, useState } from "react";
import { ContributionQualityReview } from "./ContributionQualityReview";
import { readBoundedJson } from "./lib/browser-json";
import type { CycleIndex } from "./lib/cycle-index";
import type { ProjectFundingIndex } from "./lib/funding";
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
import { SquadsTracking } from "./SquadsTracking";

type ReviewState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; index: FundingReviewIndex };
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
  const [rawAmounts, setRawAmounts] = useState<Record<string, string>>({});
  const [missingOnly, setMissingOnly] = useState(false);
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
  function saveDraft() {
    if (
      !canEdit ||
      !selection.result ||
      Object.values(invalidAmounts).some(Boolean)
    )
      return;
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
  let vaultError: string | null = null;
  let vaultLedger: ReturnType<typeof reviewedVaultFunding> | null = null;
  try {
    if (vault?.kind === "squads-v4-vault" && funding)
      vaultLedger = reviewedVaultFunding(
        project.id,
        vault,
        funding.commitments,
      );
  } catch (error: unknown) {
    vaultError =
      error instanceof Error ? error.message : "Vault ledger unavailable.";
  }
  async function refreshVault() {
    if (vault?.kind !== "squads-v4-vault") return;
    const requestContext = currentContext.current;
    setVaultChecking(true);
    setVaultMessage("");
    setVaultObservation(null);
    try {
      const response = await fetch(
        `https://api.slop.cash/api/v1/projects/${encodeURIComponent(project.id)}/funding/${cycleId}`,
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
  const visible = recipients.filter(
    (r) =>
      r.actor.login.toLowerCase().includes(query.toLowerCase()) &&
      (!missingOnly || (!r.wallet && !r.lookupUnavailable)),
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
    if (Object.values(invalidAmounts).some(Boolean)) {
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
  const requestUrl = `${repo}/issues/new?${new URLSearchParams({ title: `Funding review: ${project.id} ${cycleId}`, body: `Please review the attached funding review for ${project.name}, contribution month ${cycleId}.\n\nSource snapshot: ${review?.sourceSnapshotSha256 ?? published?.files.sourceSnapshot.sha256 ?? "No complete preparation published"}\n\nAttach the downloaded review JSON. It contains all contributors, original amounts, proposed changes and reasons. This request is not payment approval.` })}`;
  return (
    <section
      className="funding-workbench"
      aria-labelledby="funding-review-title"
    >
      <div className="simple-heading">
        <div>
          <h2 id="funding-review-title">Manage payouts</h2>
          <p>Review a month, fund its vault, and follow every payment.</p>
          <a href={`${repo}/blob/develop/funding/maintainer-payouts.md`}>
            Step-by-step guide
          </a>
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
          <nav aria-label="Payout steps" className="payout-steps">
            {[
              "Review recipients",
              "Prepare funding",
              "Approve cycle",
              "Track payments",
            ].map((label, index) => (
              <button
                type="button"
                key={label}
                aria-current={step === index + 1 ? "step" : undefined}
                onClick={() => setStep(index + 1)}
              >
                <span>{index + 1}</span>
                {label}
              </button>
            ))}
          </nav>
          {project.reward.kind === "external-prize-share" ? (
            <p className="data-notice">
              This project publishes external-prize shares. It does not use the
              USDC vault payment flow.
            </p>
          ) : (
            <>
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
                  <strong>
                    {
                      recipients.filter(
                        (r) => !r.wallet && !r.lookupUnavailable,
                      ).length
                    }
                  </strong>
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
              {step === 1 && (
                <>
                  <h3>Review recipients</h3>
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
                      ? "Published cycle records are shown below. Amount changes need a reviewed successor of the proposal and restart its 14-day review."
                      : "These are cap-based suggestions from the complete monthly census. Everyone remains included until maintainers review a reasoned change."}
                  </p>
                  <p>
                    Registered is a public receiving-address claim. Locked means
                    that exact destination is frozen in the published cycle.
                    Neither status means paid.
                  </p>
                  <div className="review-filters">
                    <label>
                      Find contributor
                      <input
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={missingOnly}
                        onChange={(e) => setMissingOnly(e.target.checked)}
                      />{" "}
                      Missing wallets only
                    </label>
                  </div>
                  <p>
                    {visible.length} of {recipients.length} contributors shown.
                    Changes are local until downloaded; no automatic
                    redistribution.
                  </p>
                  <section
                    className="plain-table-wrap"
                    aria-label="Scrollable payout records"
                  >
                    <table className="plain-table">
                      <caption className="visually-hidden">
                        {project.name} {cycleId} payout review
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">Contributor</th>
                          <th scope="col">Suggested USDC</th>
                          <th scope="col">Destination</th>
                          <th scope="col">Proposed award</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visible.map((r) => {
                          const a = adjustments[r.actor.id];
                          const decision =
                            a?.decision ??
                            ("state" in r && r.state === "excluded"
                              ? "exclude"
                              : "include");
                          return (
                            <tr key={`${cycleId}:${r.actor.id}`}>
                              <th scope="row">
                                <a
                                  href={`https://github.com/${encodeURIComponent(r.actor.login)}`}
                                >
                                  {r.actor.login}
                                </a>
                              </th>
                              <td>{displayUsdc(r.simulatedMinor)}</td>
                              <td>
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
                                  <span>
                                    {r.lookupUnavailable
                                      ? "Wallet lookup unavailable"
                                      : "Missing registration"}
                                  </span>
                                )}
                                <small>
                                  {cycleIndex
                                    ? walletLockLabel(published, r.actor.id)
                                    : "Lock status unavailable"}
                                </small>
                                {published?.contributors.find(
                                  (c) => c.actor.id === r.actor.id,
                                )?.wallet && (
                                  <a href={published.files.proposal.url}>
                                    View locked proposal
                                  </a>
                                )}
                              </td>
                              <td>
                                <label
                                  className="visually-hidden"
                                  htmlFor={`decision-${r.actor.id}`}
                                >
                                  Decision for {r.actor.login}
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
                                  <option value="include">Include</option>
                                  <option value="exclude">
                                    Propose exclusion
                                  </option>
                                </select>
                                <label>
                                  USDC for {r.actor.login}
                                  <input
                                    aria-label={`USDC for ${r.actor.login}`}
                                    inputMode="decimal"
                                    disabled={
                                      !!published || a?.decision === "exclude"
                                    }
                                    value={
                                      rawAmounts[r.actor.id] ??
                                      displayUsdc(
                                        a?.amountMinor ?? r.simulatedMinor,
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
                                </label>
                                <label
                                  className="visually-hidden"
                                  htmlFor={`reason-${r.actor.id}`}
                                >
                                  Reason for {r.actor.login}
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
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </section>
                  {selection.error && <p role="alert">{selection.error}</p>}
                  {selection.result && (
                    <p>
                      Proposed principal:{" "}
                      {displayUsdc(selection.result.totalMinor)} USDC ·
                      Unallocated:{" "}
                      {displayUsdc(selection.result.unallocatedMinor)} USDC ·
                      Maximum fee:{" "}
                      {displayUsdc(selection.result.maximumFeeMinor)} USDC. Fees
                      apply only to principal approved for payment.
                    </p>
                  )}
                  <div className="review-actions">
                    <button
                      type="button"
                      disabled={
                        !selection.result ||
                        !canEdit ||
                        Object.values(invalidAmounts).some(Boolean)
                      }
                      onClick={saveDraft}
                    >
                      Save draft on this device
                    </button>
                    <button
                      type="button"
                      disabled={
                        !selection.result ||
                        !canEdit ||
                        Object.values(invalidAmounts).some(Boolean)
                      }
                      onClick={() => void exportReview()}
                    >
                      Download review
                    </button>
                    <a
                      href={
                        published
                          ? `${repo}/upload/develop/cycles/${project.id}/${cycleId}`
                          : requestUrl
                      }
                      target="_blank"
                      rel="noreferrer"
                    >
                      {published ? "Open proposal PR" : "Open GitHub review"}
                    </a>
                    <a href="/wallet">Register your payout wallet</a>
                    {!published && (
                      <a
                        href={`${repo}/actions/workflows/prepare-funding-review.yml`}
                      >
                        Refresh registered wallets
                      </a>
                    )}
                  </div>
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
                  {vaultError && (
                    <p role="alert">Vault funding unavailable: {vaultError}</p>
                  )}
                  <p>
                    Use your existing Phantom wallet, or create a dedicated
                    wallet in Phantom. Signing stays in your wallet.
                  </p>
                  {selection.result && (
                    <p>
                      Current draft: {formatUsdc(selection.result.totalMinor)}{" "}
                      USDC in awards, plus up to{" "}
                      {formatUsdc(selection.result.maximumFeeMinor)} USDC in
                      platform fees. The final approved plan determines the
                      amount to send. Keep SOL in the signing wallet for network
                      fees and in the vault for any new recipient token
                      accounts.
                    </p>
                  )}
                  <ol>
                    <li>
                      Review recipients and resolve missing wallet
                      registrations.
                    </li>
                    <li>
                      Create this month’s vault in Squads with the funder and
                      independent co-signer, then submit its configuration for
                      review.
                    </li>
                    <li>
                      After the vault configuration and payout protocol are
                      reviewed, send Solana USDC from Phantom to its exact
                      address and verify the deposit.
                    </li>
                    <li>
                      Complete allocation review, then review and sign the
                      payout proposal in Squads. Return here to verify
                      settlement.
                    </li>
                  </ol>
                  {vault?.kind === "squads-v4-vault" ? (
                    <>
                      <p>
                        Reviewed vault for {cycleId}:{" "}
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
                      <p>
                        Verified net funding ledger:{" "}
                        {vaultLedger
                          ? `${displayUsdc(vaultLedger.netMinor)} USDC`
                          : "Unavailable"}
                        . This is published deposit minus release/refund
                        evidence, not a live wallet balance.
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
                            Fees and signer readiness are checked separately.
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
                    </>
                  ) : instrument?.kind === "sablier-lockup-v4" ? (
                    <p>
                      This month has a reviewed Sablier instrument on{" "}
                      {instrument.network}. Its funding remains separate; this
                      Solana payout flow requires a reviewed Squads vault. Do
                      not deposit into a second instrument for the same month.
                    </p>
                  ) : (
                    <>
                      <p>
                        No reviewed monthly vault yet. A funder and an
                        independent co-signer must approve the 2-of-2 vault
                        configuration before depositing.
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
                          onChange={(e) => setFeeAddress(e.target.value.trim())}
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
                  )}
                  {project.reward.paymentMode === "disabled" && (
                    <p className="data-notice">
                      Payments are disabled for this project. Complete the vault
                      configuration and payout protocol review before
                      depositing.{" "}
                      <a href={`${repo}/issues/333`}>
                        View outstanding requirements
                      </a>
                    </p>
                  )}
                  <details>
                    <summary>
                      Record a funding transaction for verification
                    </summary>
                    <p>
                      <a
                        href={`${repo}/actions/workflows/verify-funding-deposit.yml`}
                      >
                        Verify deposit on GitHub
                      </a>{" "}
                      — select develop and enter project {project.id}, month{" "}
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
                        !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(transaction) ||
                        !vault
                      }
                      onClick={() => {
                        download(
                          {
                            kind: "funding-evidence-request",
                            status: "unverified",
                            projectId: project.id,
                            cycleId,
                            vault:
                              vault?.kind === "squads-v4-vault"
                                ? vault.vault
                                : null,
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
                </>
              )}
              {step === 3 && (
                <>
                  <h3>Approve cycle</h3>
                  {published ? (
                    <>
                      <p>
                        Published state: {published.state}. Review ends:{" "}
                        {published.reviewEndsAt ?? "Not applicable"}.
                      </p>
                      <a href={published.files.proposal.url}>
                        Read the exact proposal
                      </a>
                      {published.files.allocation && (
                        <p>
                          <a href={published.files.allocation.url}>
                            Read approved allocation
                          </a>
                        </p>
                      )}
                      <p>
                        Wallet destinations are frozen in the proposal. Missing
                        wallets remain unclaimed; changes observed after
                        freezing apply to a later cycle.
                      </p>
                    </>
                  ) : (
                    <p>
                      Publish the verified funding policy first, then generate
                      the complete funded proposal. The public review lasts 14
                      days. Any material amount change restarts that period.
                    </p>
                  )}
                  <p>
                    GitHub review and maintainer approval are authoritative.
                    Related-party awards require separate approval. An app draft
                    cannot approve an allocation.
                  </p>
                  <a
                    href={`${repo}/actions/workflows/reward-cycle-actions.yml`}
                  >
                    Open cycle workflow
                  </a>
                  <p>
                    Select develop, project {project.id}, month {cycleId}, and
                    action{" "}
                    <code>
                      {!published
                        ? "propose"
                        : published.files.executionPlan
                          ? "verify-settlement"
                          : published.files.allocation
                            ? "reserve-settlement"
                            : "finalize-allocation"}
                    </code>
                    . The workflow prepares a GitHub PR for review.
                  </p>
                  <p>
                    Required source SHA-256:{" "}
                    <code>
                      {published?.files.executionPlan?.sha256 ??
                        published?.files.allocation?.sha256 ??
                        published?.files.proposal.sha256 ??
                        review?.sourceSnapshotSha256}
                    </code>
                  </p>
                  {published?.files.allocation &&
                    !published.files.executionPlan && (
                      <p>
                        First merge the reservation PR. Then run{" "}
                        <code>prepare-settlement</code> with the same allocation
                        hash to release its exact unsigned plan. Reuse that plan
                        on retries; do not create a replacement payout.
                      </p>
                    )}
                  {!published && (
                    <p>
                      Proposing also requires the original snapshot artifact
                      from the preparation run. For an independently audited
                      import, retain and use its exact archived source; do not
                      substitute a newly generated snapshot.
                    </p>
                  )}
                </>
              )}
              {step === 4 && (
                <>
                  <h3>Track payments</h3>
                  {published?.files.executionPlan && (
                    <>
                      <SquadsTracking cycle={published} />
                      <p>
                        <a
                          href={`${repo}/actions/workflows/link-squads-execution.yml`}
                        >
                          Link your Squads proposal
                        </a>{" "}
                        — select develop, {project.id}/{cycleId}, its public
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
                      <p>
                        Approved: {displayUsdc(published.reward.approvedMinor)}{" "}
                        USDC · Paid: {displayUsdc(published.reward.paidMinor)}{" "}
                        USDC · Fee: {displayUsdc(published.reward.feeMinor)}{" "}
                        USDC.
                      </p>
                      {published.files.executionPlan ? (
                        <a href={published.files.executionPlan.url}>
                          Download unsigned execution plan
                        </a>
                      ) : (
                        <p>No execution plan has been published.</p>
                      )}
                      {published.files.executionPlan && (
                        <p>
                          <a
                            href={`${repo}/actions/workflows/reward-cycle-actions.yml`}
                          >
                            Verify settlement on GitHub
                          </a>{" "}
                          — choose verify-settlement for {project.id}/{cycleId}{" "}
                          and bind the transaction evidence to plan SHA-256{" "}
                          <code>{published.files.executionPlan.sha256}</code>.
                        </p>
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
                        aria-label="Scrollable payout records"
                      >
                        <table className="plain-table">
                          <caption className="visually-hidden">
                            Payment status by contributor
                          </caption>
                          <thead>
                            <tr>
                              <th scope="col">Contributor</th>
                              <th scope="col">State</th>
                              <th scope="col">Approved USDC</th>
                              <th scope="col">Paid USDC</th>
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
                                <td>{r.state.replaceAll("-", " ")}</td>
                                <td>{displayUsdc(r.approvedMinor)}</td>
                                <td>{displayUsdc(r.paidMinor)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </section>
                    </>
                  )}
                  <p>
                    Both vault members sign externally. A Squads approval or
                    transaction submission is not a completed payment; finalized
                    principal and fee evidence must reconcile first.
                  </p>
                  {vaultLedger && (
                    <section
                      className="plain-table-wrap"
                      aria-label="Scrollable payout records"
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
