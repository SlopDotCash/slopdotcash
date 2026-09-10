import { useEffect, useMemo, useState } from "react";
import { readBoundedJson } from "./lib/browser-json";
import {
  assertQualityEvidence,
  calculateQualityReview,
  QUALITY_TIERS,
  type QualityBurdenDecision,
  type QualityDecision,
  type QualityEvidence,
  type QualityTier,
  qualityEvidenceBinding,
  verifyQualityEventIds,
} from "./lib/contribution-quality";
import { formatUsdc, type ReviewAdjustment } from "./lib/funding-review";
import type { FundingPreparation } from "./lib/funding-review-data";

export function ContributionQualityReview({
  preparation,
  capMinor,
  onApply,
}: {
  preparation: FundingPreparation;
  capMinor: string;
  onApply: (adjustments: ReviewAdjustment[]) => void;
}) {
  const [evidence, setEvidence] = useState<QualityEvidence | null>(null);
  const [decisions, setDecisions] = useState<QualityDecision[]>([]);
  const [burdens, setBurdens] = useState<QualityBurdenDecision[]>([]);
  const [deduction, setDeduction] = useState("0");
  const [selected, setSelected] = useState<string[]>([]);
  const [tier, setTier] = useState<QualityTier>("micro");
  const [reason, setReason] = useState("");
  const [query, setQuery] = useState("");
  const [structuralOnly, setStructuralOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<
    "implementation" | "review" | "evaluation" | "closures"
  >("implementation");
  const draftKey = `slop:quality:${preparation.projectId}:${preparation.cycleId}:${preparation.sourceSnapshotSha256}:${capMinor}`;
  useEffect(() => {
    if (!evidence) return;
    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify({
          decisions,
          burdens,
          binding: qualityEvidenceBinding(evidence),
        }),
      );
    } catch {
      setMessage(
        "Quality decisions could not be saved in this browser. Download them before leaving.",
      );
    }
  }, [draftKey, evidence, decisions, burdens]);
  const actors = useMemo(
    () =>
      new Map(
        preparation.contributors.map((row) => [row.actor.id, row.actor.login]),
      ),
    [preparation],
  );
  const result = useMemo(
    () =>
      evidence
        ? calculateQualityReview(evidence, decisions, capMinor, burdens, actors)
        : null,
    [evidence, decisions, capMinor, burdens, actors],
  );
  const filtered = (
    mode === "closures"
      ? (evidence?.closures ?? [])
      : (evidence?.events.filter((event) => event.kind === mode) ?? [])
  ).filter((event) =>
    `${event.title} ${actors.get(event.actorId ?? "") ?? ("actorLogin" in event ? event.actorLogin : "") ?? ""} ${event.url} ${"flags" in event ? event.flags.join(" ") : ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const visibleRecords =
    structuralOnly && mode !== "closures"
      ? filtered.filter(
          (event) =>
            "flags" in event &&
            event.flags.some((flag) =>
              /^(?:zero-diff|tiny-diff|non-integration|blank-line|matching patch|test-only)/.test(
                flag,
              ),
            ),
        )
      : filtered;
  function selectMatchingPatches() {
    if (!evidence || !selected.length) return;
    const first = evidence.events.find((event) => event.id === selected[0]);
    if (!first) return;
    const groups = first.flags.filter((flag) =>
      flag.startsWith("matching patch group "),
    );
    if (!groups.length) {
      setMessage("Select one event with a matching patch group first.");
      return;
    }
    setSelected(
      evidence.events
        .filter(
          (event) =>
            event.actorId === first.actorId &&
            event.kind === first.kind &&
            event.flags.some((flag) => groups.includes(flag)),
        )
        .map((event) => event.id),
    );
    setMessage(
      "Matching patches selected as candidates. Inspect branch context and explain the shared accepted outcome before grouping.",
    );
  }
  async function load(value?: unknown) {
    setBusy(true);
    setMessage("");
    try {
      if (value === undefined) {
        const response = await fetch("/data/contribution-quality/index.json", {
          signal: AbortSignal.timeout(12000),
        });
        if (!response.ok)
          throw new Error(`Quality index unavailable (${response.status})`);
        const index: unknown = await readBoundedJson(
          response,
          128 * 1024,
          "Quality index",
        );
        if (!Array.isArray(index)) throw new Error("Invalid quality index");
        const match = index.find(
          (row) =>
            row?.projectId === preparation.projectId &&
            row?.cycleId === preparation.cycleId &&
            row?.sourceSnapshotSha256 === preparation.sourceSnapshotSha256,
        );
        if (!match)
          throw new Error(
            "No prepared evidence for this cycle. Import a complete quality evidence file generated from the frozen ledger.",
          );
        const path = `/data/contribution-quality/${preparation.projectId}-${preparation.cycleId}.json`;
        if (match.path !== path)
          throw new Error("Invalid quality evidence path");
        const file = await fetch(path, { signal: AbortSignal.timeout(12000) });
        if (!file.ok)
          throw new Error(`Quality evidence unavailable (${file.status})`);
        value = await readBoundedJson(
          file,
          16 * 1024 * 1024,
          "Quality evidence",
        );
      }
      const validated = assertQualityEvidence(value, preparation);
      await verifyQualityEventIds(validated, preparation);
      let restoredDecisions: QualityDecision[] = [],
        restoredBurdens: QualityBurdenDecision[] = [];
      const stored = localStorage.getItem(draftKey);
      if (stored) {
        const restored = JSON.parse(stored);
        if (
          restored.binding !== qualityEvidenceBinding(validated) ||
          !Array.isArray(restored.decisions) ||
          !Array.isArray(restored.burdens)
        )
          throw new Error(
            "Invalid saved quality decisions; export or clear this browser's saved draft before retrying",
          );
        calculateQualityReview(
          validated,
          restored.decisions,
          capMinor,
          restored.burdens,
        );
        restoredDecisions = restored.decisions;
        restoredBurdens = restored.burdens;
      }
      setEvidence(validated);
      setDecisions(restoredDecisions);
      setBurdens(restoredBurdens);
      setSelected([]);
      setPage(0);
      setMessage(
        "Evidence loaded. All original contributors are retained; decisions below are local proposals.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Quality evidence failed",
      );
    } finally {
      setBusy(false);
    }
  }
  function saveBurden() {
    if (!evidence) return;
    try {
      const closures = evidence.closures.filter((row) =>
        selected.includes(row.id),
      );
      const actorId = closures[0]?.actorId;
      if (!actorId || !closures.every((row) => row.actorId === actorId))
        throw new Error("Select submissions by one contributor");
      if (!/^(?:[1-9][0-9]{0,3}|10000)$/.test(deduction))
        throw new Error(
          "Enter a proposed deduction of 1–10000 basis points (100 basis points = 1%)",
        );
      const next = [
        ...burdens.filter((row) => row.actorId !== actorId),
        {
          actorId,
          closedPrIds: selected,
          deductionBasisPoints: Number(deduction),
          reason,
          evidenceUrls: closures.map((row) => row.url),
        },
      ];
      calculateQualityReview(evidence, decisions, capMinor, next);
      setBurdens(next);
      setSelected([]);
      setReason("");
      setMessage(
        "Burden deduction proposed locally. Withheld money remains unallocated; GitHub review is still required.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Invalid burden proposal",
      );
    }
  }
  function saveOutcome() {
    if (!evidence) return;
    try {
      for (const old of decisions) {
        if (
          old.eventIds.some((id) => selected.includes(id)) &&
          !old.eventIds.every((id) => selected.includes(id))
        )
          throw new Error(
            "Select every event in the existing outcome before replacing it, or reset the quality decisions",
          );
      }
      const next = [
        ...decisions.filter(
          (decision) => !decision.eventIds.some((id) => selected.includes(id)),
        ),
        {
          eventIds: selected,
          tier,
          reason,
          evidenceUrls: [
            ...new Set(
              evidence.events
                .filter((event) => selected.includes(event.id))
                .map((event) => event.url),
            ),
          ],
        },
      ];
      calculateQualityReview(evidence, next, capMinor);
      setDecisions(next);
      setSelected([]);
      setReason("");
      setMessage(
        "Outcome saved in this local proposal. Compare amounts below before applying.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Invalid decision");
    }
  }
  function adjustments(): ReviewAdjustment[] {
    if (!result) return [];
    return preparation.contributors.map((row) => ({
      actorId: row.actor.id,
      decision: "include",
      amountMinor: result.after.get(row.actor.id) ?? "0",
      reason: `Proposed outcome-quality recalculation: ${result.reviewedEvents} source events reviewed; ${result.unresolvedEvents} retain their original weights. Proposed review-burden deductions, if any, remain unallocated. See attached source-bound quality decisions for reasons.`,
    }));
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              schemaVersion: "1",
              kind: "contribution-quality-proposal",
              projectId: preparation.projectId,
              cycleId: preparation.cycleId,
              sourceSnapshotSha256: preparation.sourceSnapshotSha256,
              sourceQualityBinding: evidence
                ? qualityEvidenceBinding(evidence)
                : null,
              capMinor,
              decisions,
              burdens,
              retainedMinor: result?.retainedMinor,
              adjustments: adjustments(),
              unresolvedEvents: result?.unresolvedEvents,
              paymentAuthorized: false,
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${preparation.projectId}-${preparation.cycleId}-quality-proposal.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <details className="funding-quality-review">
      <summary>Review contribution quality and compare allocations</summary>
      <p>
        Credit accepted outcomes once. Group split fixes and release promotions,
        explain the value, and assign a tier. Small diffs can solve important
        problems. Ordinary review volume does not establish maintenance value.
      </p>
      <button type="button" disabled={busy} onClick={() => void load()}>
        {busy ? "Loading evidence…" : "Load cycle evidence"}
      </button>
      <label>
        Import cycle evidence
        <input
          type="file"
          accept="application/json,.json"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            if (file.size > 16 * 1024 * 1024) {
              setMessage("Evidence exceeds 16 MiB.");
              return;
            }
            void file
              .text()
              .then((text) => load(JSON.parse(text)))
              .catch(() => setMessage("Invalid evidence JSON"));
          }}
        />
      </label>
      <button
        type="button"
        onClick={() => {
          localStorage.removeItem(draftKey);
          setEvidence(null);
          setDecisions([]);
          setBurdens([]);
          setSelected([]);
          setMessage(
            "Saved quality draft cleared. Recipient adjustments are kept separately.",
          );
        }}
      >
        Clear saved quality draft
      </button>
      {evidence && (
        <label>
          Import saved quality decisions
          <input
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              if (file.size > 4 * 1024 * 1024) {
                setMessage("Decision file exceeds 4 MiB.");
                return;
              }
              void file
                .text()
                .then((text) => {
                  const value = JSON.parse(text);
                  if (
                    value.schemaVersion !== "1" ||
                    value.kind !== "contribution-quality-proposal" ||
                    value.projectId !== preparation.projectId ||
                    value.cycleId !== preparation.cycleId ||
                    value.sourceSnapshotSha256 !==
                      preparation.sourceSnapshotSha256 ||
                    value.sourceQualityBinding !==
                      qualityEvidenceBinding(evidence) ||
                    value.capMinor !== capMinor ||
                    value.paymentAuthorized !== false ||
                    !Array.isArray(value.decisions) ||
                    !Array.isArray(value.burdens)
                  )
                    throw new Error(
                      "Decision file does not match this exact cycle, source and budget",
                    );
                  calculateQualityReview(
                    evidence,
                    value.decisions,
                    capMinor,
                    value.burdens,
                  );
                  setDecisions(value.decisions);
                  setBurdens(value.burdens);
                  setSelected([]);
                  setMessage(
                    "Saved decisions imported and amounts recalculated from this cycle's evidence. No approval imported.",
                  );
                })
                .catch((error) =>
                  setMessage(
                    error instanceof Error
                      ? error.message
                      : "Invalid decisions",
                  ),
                );
            }}
          />
        </label>
      )}
      <p role="status">{message}</p>
      {evidence && result && (
        <>
          <p>
            Repository closure census observed{" "}
            {evidence.closureCensus.observedAt}. {evidence.closures.length}{" "}
            unmerged closures are retained for review.
          </p>
          <p>
            {result.reviewedEvents} of {evidence.events.length} source events
            reviewed. {result.unresolvedEvents} retain their original weights.
            This is a partial comparison until all required reviews are
            complete.
          </p>
          <label>
            Contribution type
            <select
              value={mode}
              onChange={(event) => {
                setMode(event.target.value as typeof mode);
                setPage(0);
                setSelected([]);
              }}
            >
              <option value="implementation">Accepted implementation</option>
              <option value="review">Review and maintenance</option>
              <option value="evaluation">Reviewed evaluations</option>
              <option value="closures">Closed without merge</option>
            </select>
          </label>
          <label>
            Find contributor or PR
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
            />
          </label>
          {mode !== "closures" && (
            <label>
              <input
                type="checkbox"
                checked={structuralOnly}
                onChange={(event) => {
                  setStructuralOnly(event.target.checked);
                  setPage(0);
                }}
              />
              Structural flags only
            </label>
          )}
          {mode === "closures" && (
            <p>
              These submissions already receive zero implementation credit.
              Review the closure reason, replacement and salvaged authorship
              before proposing a deduction. Older backlog is shown separately
              from submissions created this cycle. A closure is not a spam
              verdict. Useful blocking reviews and repairs can be proposed
              through a reviewed evaluation, including on rejected PRs.
            </p>
          )}
          <ul>
            {visibleRecords.slice(page * 25, page * 25 + 25).map((event) => (
              <li key={event.id}>
                {
                  <input
                    type="checkbox"
                    aria-label={`Select ${event.title}`}
                    checked={selected.includes(event.id)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, event.id]
                          : selected.filter((id) => id !== event.id),
                      )
                    }
                  />
                }
                <a href={event.url} target="_blank" rel="noreferrer">
                  {event.title}
                </a>
                {" — "}
                {actors.get(event.actorId ?? "") ??
                  ("actorLogin" in event ? event.actorLogin : null) ??
                  "Unknown author"}
                {"kind" in event ? (
                  <small>
                    {" "}
                    ·{" "}
                    {event.flags.join("; ") ||
                      "No structural flags; assess accepted value"}
                  </small>
                ) : (
                  <small>
                    {" "}
                    ·{" "}
                    {event.createdInCycle
                      ? "Submitted this cycle"
                      : "Older backlog"}{" "}
                    · {event.flags.join("; ")}
                  </small>
                )}
              </li>
            ))}
          </ul>
          <p>
            {visibleRecords.length} matching records. Page {page + 1} of{" "}
            {Math.max(1, Math.ceil(visibleRecords.length / 25))}
          </p>
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            Previous records
          </button>
          <button
            type="button"
            disabled={(page + 1) * 25 >= visibleRecords.length}
            onClick={() => setPage(page + 1)}
          >
            Next records
          </button>
          {mode === "closures" && (
            <fieldset>
              <legend>
                Propose a deduction for repeated avoidable review burden
              </legend>
              <p>
                Select at least two submissions created this cycle by one
                credited contributor. Explain the repeated duplicate, irrelevant
                or policy-contradicting work and the maintainer responses. Do
                not include superseded fixes, salvaged work or harmless
                withdrawals merely because they closed. No automatic penalty
                rate is recommended.
              </p>
              <label>
                Proposed deduction in basis points (100 = 1%)
                <input
                  inputMode="numeric"
                  value={deduction}
                  onChange={(event) => setDeduction(event.target.value)}
                />
              </label>
              <label>
                Public evidence and reason
                <textarea
                  value={reason}
                  maxLength={1000}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <button
                type="button"
                disabled={selected.length < 2}
                onClick={saveBurden}
              >
                Propose review-burden deduction
              </button>
            </fieldset>
          )}
          {mode !== "closures" && (
            <fieldset>
              <legend>
                One accepted outcome ({selected.length} source events selected)
              </legend>
              <p>
                Group only the same contributor and contribution type. Shared
                authorship needs a separate reviewed allocation. A grouped
                outcome earns one tier, regardless of how many PRs it spans.
                Evaluations already approved through GitHub should only change
                with a successor decision.
              </p>
              <button
                type="button"
                disabled={!selected.length}
                onClick={selectMatchingPatches}
              >
                Select matching patch candidates
              </button>
              <label>
                Outcome tier
                <select
                  value={tier}
                  onChange={(event) =>
                    setTier(event.target.value as QualityTier)
                  }
                >
                  {Object.entries(QUALITY_TIERS).map(([name, thirds]) => (
                    <option key={name} value={name}>
                      {name} ({thirds}/3 points)
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Public reason
                <textarea
                  value={reason}
                  maxLength={1000}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <button
                type="button"
                disabled={!selected.length}
                onClick={saveOutcome}
              >
                Save outcome proposal
              </button>
            </fieldset>
          )}
          <p>
            Outcome tier changes redistribute the fixed simulation cap; no funds
            are moved. Untouched work retains its original weight, including
            existing evidence bonuses. Retiered work uses the outcome tier
            alone.
          </p>
          <p>
            Retained after proposed deductions:{" "}
            {formatUsdc(result.retainedMinor)} USDC.
          </p>
          <div className="table-scroll">
            <table>
              <caption>All contributors: original and proposed USDC</caption>
              <thead>
                <tr>
                  <th>Contributor</th>
                  <th>Original</th>
                  <th>Proposed</th>
                </tr>
              </thead>
              <tbody>
                {preparation.contributors.map((row) => (
                  <tr key={row.actor.id}>
                    <th>{row.actor.login}</th>
                    <td>
                      {formatUsdc(result.before.get(row.actor.id) ?? "0")}
                    </td>
                    <td>{formatUsdc(result.after.get(row.actor.id) ?? "0")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            disabled={!decisions.length && !burdens.length}
            onClick={download}
          >
            Download decisions and comparison
          </button>
          <button
            type="button"
            disabled={!decisions.length && !burdens.length}
            onClick={() => {
              onApply(adjustments());
              setMessage(
                "Proposed amounts copied into the recipient draft. Attach the downloaded decisions to the GitHub proposal for review.",
              );
            }}
          >
            Use proposed amounts in recipient draft
          </button>
          <button
            type="button"
            disabled={!decisions.length && !burdens.length}
            onClick={() => {
              setDecisions([]);
              setBurdens([]);
              setSelected([]);
              setMessage(
                "Local quality decisions reset. Recipient draft changes are retained separately.",
              );
            }}
          >
            Reset quality decisions
          </button>
        </>
      )}
    </details>
  );
}
