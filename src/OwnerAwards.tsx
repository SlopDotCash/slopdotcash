import "./owner-review.css";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import type { MonthlyOwnerView } from "../backend/payments/monthly";
import { loginHref } from "./lib/browser-deployment";
import { readBoundedJson } from "./lib/browser-json";
import { errorMessage } from "./lib/errors";
import { ESCROW_NETWORKS } from "./lib/escrow-policy.mjs";
import { networkLabel } from "./lib/network-names";
import { formatBaseUnits, ordinaryFee } from "./lib/payments/contracts";
import { parseVaultAmount } from "./lib/payments/vault-amount";
import { apiRequest } from "./lib/project-api";
import type { ProjectDefinition } from "./lib/projects.mjs";
import { useAction } from "./lib/use-action";
import OwnerCommitment, { recoverOwnerCommitments } from "./OwnerCommitment";
import OwnerReserveRelease, {
  releaseStoragePrefix,
} from "./OwnerReserveRelease";
import {
  formatCycleMonth,
  formatDateTime,
  MetricGrid,
  MetricTile,
  NetworkName,
  StatusBadge,
} from "./Presentation";

function previousMonth() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    .toISOString()
    .slice(0, 7);
}
/** Base units as a plain decimal an owner can edit, without grouping separators. */
function editableUnits(base: string, decimals: number | null) {
  return decimals === null
    ? base
    : formatBaseUnits(base, decimals, { grouping: false });
}
function baseUnitsOf(value: string, decimals: number | null) {
  const trimmed = value.trim();
  if (/^0*(\.0*)?$/.test(trimmed) && /\d/.test(trimmed)) return "0";
  if (decimals === null) {
    if (!/^[1-9][0-9]{0,19}$/.test(trimmed))
      throw new Error("Enter a whole number of token base units.");
    return trimmed;
  }
  return parseVaultAmount(trimmed, decimals).toString();
}
/** A release this browser submitted must stay visible until it settles. */
function hasSubmittedRelease(projectId: string) {
  try {
    const prefix = releaseStoragePrefix(projectId);
    return Object.keys(sessionStorage).some((key) => key.startsWith(prefix));
  } catch {
    return false;
  }
}
const STATE_TEXT: Record<
  NonNullable<MonthlyOwnerView["run"]>["awards"][number]["state"],
  string
> = {
  underfunded: "Underfunded",
  excluded: "Excluded: account banned",
  "awaiting-reservation": "Approved: ready to reserve",
  reserved: "Reserved, not yet paid",
  paid: "Paid",
  conflict: "Conflict: another award holds this source",
};

export default function OwnerAwards({
  project,
  awardMonths,
}: {
  project: ProjectDefinition;
  awardMonths: readonly string[];
}) {
  const months = [...new Set(awardMonths)].sort();
  const [recovery] = useState(() => {
    try {
      return { pending: recoverOwnerCommitments(project.id), error: "" };
    } catch (reason) {
      return {
        pending: [],
        error: errorMessage(reason, "Saved commitments are unavailable."),
      };
    }
  });
  // The funding page is public, so private award reads wait for the owner,
  // unless this browser has a submitted release to reconcile.
  const [opened, setOpened] = useState(() => hasSubmittedRelease(project.id));
  const [monthRequest, setMonthRequest] = useState(() => ({
    period: months.at(-1) ?? previousMonth(),
    revision: 0,
  }));
  const { period } = monthRequest;
  useEffect(() => {
    const latest = [...awardMonths].sort().at(-1);
    if (latest && !awardMonths.includes(period)) {
      setMonthRequest((current) => ({ ...current, period: latest }));
    }
  }, [awardMonths, period]);
  const [view, setView] = useState<MonthlyOwnerView | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [selectedActor, setSelectedActor] = useState<string | null>(null);
  const {
    busy: actionBusy,
    error: actionError,
    setError: setActionError,
    run: act,
  } = useAction();
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const busy = loading || actionBusy;
  const error = loadError ?? actionError;
  const [notice, setNotice] = useState("");
  const [signedOut, setSignedOut] = useState(false);
  const base = `payments/projects/${encodeURIComponent(project.id)}`;
  const decimals = view?.asset?.assetDecimals ?? null;
  const symbol = view?.asset?.symbol ?? null;
  const amount = (value: string) =>
    decimals === null
      ? `${value} token base units`
      : `${formatBaseUnits(value, decimals)}${symbol ? ` ${symbol}` : ""}`;

  const accept = useCallback(
    (body: MonthlyOwnerView, month: string) => {
      if (
        body.projectId !== project.id ||
        body.period !== month ||
        typeof body.automatic !== "boolean" ||
        (body.proposal !== null && !Array.isArray(body.proposal.allocations)) ||
        (body.run !== null && !Array.isArray(body.run.awards))
      )
        throw new Error("The award response could not be verified.");
      setView(body);
      setDrafts({});
    },
    [project.id],
  );
  const call = useCallback(
    async (
      path: string,
      request: unknown,
      label: string,
      signal?: AbortSignal,
    ) => {
      const response = await apiRequest(`${base}${path}`, {
        body: request,
        timeoutMs: 120_000,
        signal,
      });
      const body = (await readBoundedJson(
        response,
        8 * 1024 * 1024,
        label,
      )) as Record<string, unknown> & { message?: string };
      if (signal?.aborted) return null;
      if (response.status === 401) {
        setSignedOut(true);
        return null;
      }
      if (!response.ok)
        throw new Error(body.message ?? "Awards are unavailable. Retry.");
      return body;
    },
    [base],
  );
  useEffect(() => {
    if (!opened) return;
    setView(null);
    setSelectedActor(null);
    setLoadError(null);
    setActionError(null);
    setNotice("");
    setSignedOut(false);
    setLoading(false);
    const month = monthRequest.period;
    if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) {
      setLoadError("Choose a valid contribution month.");
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    void call(
      `/monthly/${month}`,
      undefined,
      "Monthly awards",
      controller.signal,
    )
      .then((body) => {
        if (!controller.signal.aborted && body)
          accept(body as unknown as MonthlyOwnerView, month);
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setLoadError(errorMessage(reason, "Awards are unavailable."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [accept, call, monthRequest, opened, setActionError]);
  function run(action: () => Promise<void>) {
    setNotice("");
    setLoadError(null);
    setSignedOut(false);
    return act(action, (reason) =>
      errorMessage(reason, "Awards are unavailable."),
    );
  }
  function load(event: FormEvent) {
    event.preventDefault();
    setMonthRequest((current) => ({
      ...current,
      revision: current.revision + 1,
    }));
  }
  const save = (githubUserId: string) =>
    run(async () => {
      if (!view?.proposal) return;
      const draft = drafts[githubUserId];
      if (draft === undefined) return;
      const body = await call(
        `/monthly/${view.period}/allocations`,
        {
          githubUserId,
          grossBase: baseUnitsOf(draft, decimals),
          expectedSequence: view.proposal.allocationSequence,
        },
        "Monthly allocation",
      );
      if (body) {
        accept(body as unknown as MonthlyOwnerView, view.period);
        setNotice("Allocation saved privately.");
      }
    });
  const finalize = () =>
    run(async () => {
      if (!view?.proposal) return;
      const body = await call(
        `/monthly/${view.period}/finalize`,
        { expectedSequence: view.proposal.allocationSequence },
        "Monthly finalization",
      );
      if (body) {
        accept(body as unknown as MonthlyOwnerView, view.period);
        setNotice("This month's awards are final.");
      }
    });
  const toggleAutomatic = () =>
    run(async () => {
      if (!view) return;
      const body = await call(
        "/monthly-settings",
        { automatic: !view.automatic },
        "Monthly finalization setting",
      );
      if (body && typeof body.automatic === "boolean")
        setView({ ...view, automatic: body.automatic });
    });

  // Decision D1: with the automatic default on, the cutoff fixes the
  // allocations until the coordinator freezes them.
  const cutoffPassed =
    view?.automatic === true &&
    view.cutoffAt !== null &&
    Date.now() >= Date.parse(view.cutoffAt);
  const reservable =
    view?.run && view.deployment?.network === view.run.network
      ? view.deployment.network
      : null;
  const currentDeployment = view?.deployment;
  const authorizationDeployment = currentDeployment
    ? project.escrow?.deployments.find(
        (deployment) =>
          deployment.network === currentDeployment.network &&
          deployment.vault === currentDeployment.vault,
      )
    : null;
  if (
    months.length === 0 &&
    recovery.pending.length === 0 &&
    !recovery.error &&
    !opened
  )
    return null;
  const monthIndex = months.indexOf(period);
  const selectMonth = (month: string) => {
    setMonthRequest((current) => ({
      period: month,
      revision: current.revision,
    }));
    setView(null);
  };
  return (
    <section
      id="monthly-awards"
      className="section owner-awards"
      aria-labelledby="monthly-awards-heading"
    >
      <h2 id="monthly-awards-heading">
        <CalendarDays size={22} aria-hidden="true" /> Monthly awards
      </h2>
      {recovery.error && <p role="alert">{recovery.error}</p>}
      {recovery.pending.map((entry) => (
        <OwnerCommitment
          key={`recovery:${entry.cycleId}:${entry.expected.network}:${entry.expected.githubUserId}`}
          projectId={project.id}
          cycleId={entry.cycleId}
          expected={entry.expected}
        />
      ))}
      {!opened ? (
        <>
          <p>Review allocations and reserve finalized awards.</p>
          <button
            className="button secondary-button"
            type="button"
            onClick={() => setOpened(true)}
          >
            Review monthly awards
          </button>
        </>
      ) : (
        <>
          <form className="award-month-toolbar" onSubmit={load}>
            <nav
              className="award-month-navigation"
              aria-label="Contribution month"
            >
              <button
                type="button"
                className="button secondary-button icon-button"
                aria-label="Previous award month"
                disabled={busy || monthIndex <= 0}
                onClick={() => selectMonth(months[monthIndex - 1])}
              >
                <ChevronLeft aria-hidden="true" />
              </button>
              <span aria-live="polite">{formatCycleMonth(period)}</span>
              <button
                type="button"
                className="button secondary-button icon-button"
                aria-label="Next award month"
                disabled={
                  busy || monthIndex < 0 || monthIndex >= months.length - 1
                }
                onClick={() => selectMonth(months[monthIndex + 1])}
              >
                <ChevronRight aria-hidden="true" />
              </button>
            </nav>
            <button
              className="button primary-button"
              type="submit"
              disabled={busy}
            >
              {loading ? "Loading…" : "Refresh awards"}
            </button>
          </form>
          {signedOut && (
            <p>
              <a
                href={loginHref(
                  `/projects/${project.slug}/funding#monthly-awards`,
                )}
              >
                Sign in with GitHub
              </a>
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          {notice && <p role="status">{notice}</p>}
          {view && (
            <div>
              {view.deployment ? (
                <NetworkName
                  chain={ESCROW_NETWORKS[view.deployment.network].chain}
                >
                  {networkLabel(view.deployment.network)}
                </NetworkName>
              ) : null}
              <section
                className="owner-monthly-settings"
                aria-label="Monthly payment settings"
              >
                <div className="owner-award-finalization">
                  <h3>Allocation finalization</h3>
                  <p>
                    Automatic finalization{" "}
                    <StatusBadge tone={view.automatic ? "success" : "neutral"}>
                      {view.automatic ? "On" : "Off"}
                    </StatusBadge>
                    <span>
                      {view.run ? (
                        "This month is finalized."
                      ) : view.automatic ? (
                        cutoffPassed ? (
                          "Cutoff passed · allocations are fixed while finalization completes."
                        ) : view.cutoffAt ? (
                          <>
                            Finalizes{" "}
                            <time dateTime={view.cutoffAt}>
                              {formatDateTime(view.cutoffAt)}
                            </time>
                            . You can finalize earlier.
                          </>
                        ) : (
                          "Finalize this month manually."
                        )
                      ) : (
                        "Finalize each month manually."
                      )}
                    </span>
                  </p>
                  <button
                    className="button secondary-button"
                    type="button"
                    disabled={busy}
                    onClick={() => void toggleAutomatic()}
                  >
                    {view.automatic
                      ? "Turn off automatic finalization"
                      : "Turn on automatic finalization"}
                  </button>
                </div>
                {authorizationDeployment && (
                  <p className="owner-award-authorization">
                    <strong>Vault payment authorization</strong>{" "}
                    <a
                      href={`/projects/${project.slug}/manage#vault-monthly-${authorizationDeployment.network}-${authorizationDeployment.vault}`}
                    >
                      Review current setting and cap
                    </a>
                    <span>
                      Owner wallet review required; separate from allocation
                      finalization.
                    </span>
                  </p>
                )}
              </section>
              {project.reward.paymentMode !== "enabled" && (
                <p role="status">Payments are disabled for this project.</p>
              )}
              {!view.proposal ? (
                <p>No allocation is proposed for this month yet.</p>
              ) : !view.run ? (
                <>
                  <MetricGrid>
                    <MetricTile
                      label="Allocated"
                      value={amount(
                        view.proposal.allocations
                          .reduce((sum, row) => sum + BigInt(row.grossBase), 0n)
                          .toString(),
                      )}
                      tone="info"
                    />
                    <MetricTile
                      label="Monthly cap"
                      value={amount(view.proposal.capBase)}
                    />
                  </MetricGrid>
                  {view.proposal.allocations.length === 0 ? (
                    <p>No one has an allocation this month.</p>
                  ) : (
                    <ul className="owner-award-list" aria-label="Allocations">
                      {view.proposal.allocations.map((row) => {
                        const id = `allocation-${row.githubUserId}`;
                        // Finalization uses saved allocations, not unsaved input.
                        // Frozen awards below retain the fee returned by the API.
                        const fee = ordinaryFee(BigInt(row.grossBase));
                        return (
                          <li key={row.githubUserId}>
                            <div className="owner-award-recipient">
                              <h4>{row.login}</h4>
                              <details>
                                <summary>Allocation basis</summary>
                                <dl>
                                  <dt>Proposed gross</dt>
                                  <dd>{amount(row.proposedGrossBase)}</dd>
                                </dl>
                              </details>
                            </div>
                            <AwardAmounts
                              gross={amount(row.grossBase)}
                              net={amount(
                                (BigInt(row.grossBase) - fee).toString(),
                              )}
                              fee={amount(fee.toString())}
                              saved
                            />
                            <div className="owner-award-edit">
                              <label htmlFor={id}>
                                <span aria-hidden="true">
                                  {drafts[row.githubUserId] === undefined
                                    ? "Edit gross"
                                    : "Unsaved gross"}
                                </span>
                                <span className="visually-hidden">
                                  Award for {row.login}
                                  {decimals === null ? " (base units)" : ""}
                                </span>
                              </label>
                              <input
                                id={id}
                                inputMode="decimal"
                                spellCheck={false}
                                disabled={busy || cutoffPassed}
                                value={
                                  drafts[row.githubUserId] ??
                                  editableUnits(row.grossBase, decimals)
                                }
                                onChange={(event) =>
                                  setDrafts({
                                    ...drafts,
                                    [row.githubUserId]: event.target.value,
                                  })
                                }
                              />
                              <button
                                className="button secondary-button"
                                type="button"
                                disabled={
                                  busy ||
                                  cutoffPassed ||
                                  drafts[row.githubUserId] === undefined
                                }
                                aria-label={`Save ${row.login}`}
                                onClick={() => void save(row.githubUserId)}
                              >
                                Save
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <button
                    className="button primary-button"
                    type="button"
                    disabled={busy}
                    onClick={() => void finalize()}
                  >
                    Finalize awards
                  </button>
                </>
              ) : (
                <>
                  <p role="status">
                    Finalized{" "}
                    {view.run.trigger === "automatic"
                      ? "automatically"
                      : "by you"}{" "}
                    on{" "}
                    <time dateTime={view.run.frozenAt}>
                      {formatDateTime(view.run.frozenAt)}
                    </time>
                    .
                    {view.run.funded
                      ? ""
                      : " Awards wait until the vault's free balance covers them."}
                  </p>
                  {view.run.awards.length === 0 ? (
                    <p>No awards this month.</p>
                  ) : (
                    <ul className="owner-award-list" aria-label="Final awards">
                      {view.run.awards.map((award) => (
                        <li key={award.githubUserId}>
                          <h4>{award.login}</h4>
                          <dl>
                            <AwardAmounts
                              gross={amount(award.grossBase)}
                              net={amount(award.netBase)}
                              fee={amount(award.feeBase)}
                              fragment
                            />
                            <div className="owner-award-state">
                              <dt>Status</dt>
                              <dd>
                                <StatusBadge
                                  tone={
                                    award.state === "paid"
                                      ? "success"
                                      : "warning"
                                  }
                                >
                                  {STATE_TEXT[award.state]}
                                </StatusBadge>
                              </dd>
                            </div>
                          </dl>
                          {reservable &&
                            award.state === "awaiting-reservation" && (
                              <button
                                className="button secondary-button"
                                type="button"
                                onClick={() =>
                                  setSelectedActor(award.githubUserId)
                                }
                              >
                                Reserve award for {award.login}
                              </button>
                            )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {selectedActor &&
                    reservable &&
                    !recovery.pending.some(
                      (entry) =>
                        entry.cycleId === view.period &&
                        entry.expected.network === reservable &&
                        entry.expected.githubUserId === selectedActor,
                    ) && (
                      <OwnerCommitment
                        key={`${view.run.snapshotSha256}:${selectedActor}`}
                        projectId={project.id}
                        cycleId={view.period}
                        expected={{
                          network: reservable,
                          githubUserId: selectedActor,
                          manifestSha256: view.manifestSha256,
                          snapshotSha256: view.run.snapshotSha256,
                        }}
                      />
                    )}
                </>
              )}
            </div>
          )}
          {view?.deployment && (
            <OwnerReserveRelease
              key={`${view.projectId}:${view.period}:${view.manifestSha256}`}
              view={view}
            />
          )}
        </>
      )}
    </section>
  );
}

function AwardAmounts({
  gross,
  net,
  fee,
  saved = false,
  fragment = false,
}: {
  gross: string;
  net: string;
  fee: string;
  saved?: boolean;
  fragment?: boolean;
}) {
  const fields = (
    <>
      <div>
        <dt>{saved ? "Saved gross" : "Award"}</dt>
        <dd>{gross}</dd>
      </div>
      <div>
        <dt>Contributor receives</dt>
        <dd>{net}</dd>
      </div>
      <div>
        <dt>Fee</dt>
        <dd>{fee}</dd>
      </div>
    </>
  );
  return fragment ? (
    fields
  ) : (
    <dl className="owner-award-breakdown">{fields}</dl>
  );
}
