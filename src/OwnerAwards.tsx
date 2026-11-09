import "./owner-review.css";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { MonthlyOwnerView } from "../backend/payments/monthly";
import { loginHref } from "./lib/browser-deployment";
import { readBoundedJson } from "./lib/browser-json";
import { errorMessage } from "./lib/errors";
import { ESCROW_NETWORKS } from "./lib/escrow-policy.mjs";
import { networkLabel } from "./lib/network-names";
import { formatBaseUnits, ordinaryFee } from "./lib/payments/contracts";
import {
  PRD_MONTHLY_SCHEDULE,
  shiftPeriod,
  utcPeriodOf,
} from "./lib/payments/monthly-allocation";
import { parseVaultAmount } from "./lib/payments/vault-amount";
import {
  apiRequest,
  currentProjectSession,
  subscribeProjectSessionChange,
} from "./lib/project-api";
import type { ProjectDefinition } from "./lib/projects.mjs";
import { useTimeBoundary, useUtcDay } from "./lib/use-time-boundary";
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
function hasSubmittedRelease(projectId: string, suffix = "") {
  try {
    const prefix = `${releaseStoragePrefix(projectId)}${suffix}`;
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
  useUtcDay();
  const months = [...new Set(awardMonths)].sort();
  // Monthly proposals are private records, and a new proposal never enters
  // the public cycle index, so that index cannot list the months an owner
  // may review. A monthly-pool project always offers the review entry, and
  // month navigation walks calendar months from the first monthly period
  // (or the earliest public cycle, when one is older) to the last closed
  // month. The server still authorizes every month read.
  const monthlyProject = project.reward.kind === "monthly-pool";
  const lastClosedMonth = shiftPeriod(utcPeriodOf(new Date()), -1);
  const firstMonth =
    months.length && months[0] < PRD_MONTHLY_SCHEDULE.firstPeriod
      ? months[0]
      : PRD_MONTHLY_SCHEDULE.firstPeriod;
  const latestPublicMonth = months.at(-1);
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
    period:
      latestPublicMonth && latestPublicMonth > lastClosedMonth
        ? latestPublicMonth
        : lastClosedMonth,
    revision: 0,
  }));
  const { period } = monthRequest;
  const [view, setView] = useState<MonthlyOwnerView | null>(null);
  const [viewActor, setViewActor] = useState<string | null>(null);
  const knownActor = useRef<string | null>(null);
  const mounted = useRef(true);
  const generation = useRef(0);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, []);
  const [drafts, setDrafts] = useState<
    Record<string, Record<string, { value: string; base: string }>>
  >({});
  const [selectedActor, setSelectedActor] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
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
    (body: MonthlyOwnerView, month: string, actorId: string) => {
      if (
        body.projectId !== project.id ||
        body.period !== month ||
        typeof body.automatic !== "boolean" ||
        typeof body.canManage !== "boolean" ||
        (body.proposal !== null && !Array.isArray(body.proposal.allocations)) ||
        (body.run !== null && !Array.isArray(body.run.awards))
      )
        throw new Error("The award response could not be verified.");
      setView(body);
      setViewActor(actorId);
      knownActor.current = actorId;
      setDrafts((previous) => {
        const rows = new Map(
          body.proposal?.allocations.map((row) => [
            row.githubUserId,
            row.grossBase,
          ]),
        );
        return {
          ...previous,
          [month]: Object.fromEntries(
            Object.entries(previous[month] ?? {}).filter(
              ([actor, draft]) => rows.get(actor) === draft.base,
            ),
          ),
        };
      });
    },
    [project.id],
  );
  const clearPrivate = useCallback(() => {
    setView(null);
    setViewActor(null);
    knownActor.current = null;
    setSelectedActor(null);
    setDrafts({});
    setNotice("");
  }, []);
  useEffect(
    () =>
      subscribeProjectSessionChange(() => {
        generation.current += 1;
        clearPrivate();
        setSignedOut(true);
        setLoading(false);
        setActionBusy(false);
        setActionError(null);
        setLoadError(null);
      }),
    [clearPrivate],
  );
  const call = useCallback(
    async (
      path: string,
      request: unknown,
      label: string,
      expectedActor: string | null,
      owns: () => boolean,
      signal?: AbortSignal,
    ) => {
      const current = () => mounted.current && owns() && !signal?.aborted;
      if (!current()) return null;
      const checkSession = async () => {
        try {
          return await currentProjectSession();
        } catch {
          if (current()) clearPrivate();
          throw new Error(
            "Your private session could not be checked. Refresh awards.",
          );
        }
      };
      const session = await checkSession();
      if (!current()) return null;
      if (
        !session ||
        (expectedActor !== null && session.githubId !== expectedActor)
      ) {
        clearPrivate();
        setSignedOut(session === null);
        if (session) throw new Error("Your account changed. Refresh awards.");
        return null;
      }
      if (
        knownActor.current !== null &&
        knownActor.current !== session.githubId
      )
        clearPrivate();
      let body: (Record<string, unknown> & { message?: string }) | null = null;
      let failure: unknown;
      let failed = false;
      try {
        const response = await apiRequest(`${base}${path}`, {
          body: request,
          timeoutMs: 120_000,
          signal,
          headers: { "x-slop-expected-github-id": session.githubId },
        });
        if (current() && [401, 403, 404, 410].includes(response.status)) {
          clearPrivate();
          setSignedOut(response.status === 401);
        }
        body = (await readBoundedJson(
          response,
          8 * 1024 * 1024,
          label,
        )) as Record<string, unknown> & { message?: string };
        if (!response.ok)
          throw new Error(body.message ?? "Awards are unavailable. Retry.");
      } catch (cause) {
        failed = true;
        failure = cause;
      }
      if (!current()) return null;
      const after = await checkSession();
      if (!current()) return null;
      if (after?.githubId !== session.githubId) {
        clearPrivate();
        setSignedOut(after === null);
        throw new Error("Your account changed. Refresh awards.");
      }
      if (failed) throw failure;
      return { body, actorId: session.githubId };
    },
    [base, clearPrivate],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: context changes retire pending work during layout cleanup.
  useEffect(() => {
    if (!opened) return;
    setView(null);
    setSelectedActor(null);
    setLoadError(null);
    setActionError(null);
    setActionBusy(false);
    setNotice("");
    setSignedOut(false);
    setLoading(false);
    const month = monthRequest.period;
    if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) {
      setLoadError("Choose a valid contribution month.");
      return;
    }
    const controller = new AbortController();
    const current = ++generation.current;
    const owns = () => mounted.current && generation.current === current;
    setLoading(true);
    void call(
      `/monthly/${month}`,
      undefined,
      "Monthly awards",
      null,
      owns,
      controller.signal,
    )
      .then((result) => {
        if (owns() && !controller.signal.aborted && result?.body)
          accept(
            result.body as unknown as MonthlyOwnerView,
            month,
            result.actorId,
          );
      })
      .catch((reason) => {
        if (owns() && !controller.signal.aborted)
          setLoadError(errorMessage(reason, "Awards are unavailable."));
      })
      .finally(() => {
        if (owns() && !controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [accept, call, monthRequest, opened, setActionError]);
  async function run(action: (owns: () => boolean) => Promise<void>) {
    if (!mounted.current) return;
    const current = ++generation.current;
    const owns = () => mounted.current && generation.current === current;
    setNotice("");
    setLoadError(null);
    setSignedOut(false);
    setActionBusy(true);
    setActionError(null);
    try {
      await action(owns);
    } catch (reason) {
      if (owns())
        setActionError(errorMessage(reason, "Awards are unavailable."));
    } finally {
      if (owns()) setActionBusy(false);
    }
  }
  function load(event: FormEvent) {
    event.preventDefault();
    setMonthRequest((current) => ({
      ...current,
      revision: current.revision + 1,
    }));
  }
  const save = (githubUserId: string) =>
    run(async (owns) => {
      if (!view?.proposal) return;
      const draft = drafts[view.period]?.[githubUserId];
      if (draft === undefined) return;
      const body = await call(
        `/monthly/${view.period}/allocations`,
        {
          githubUserId,
          grossBase: baseUnitsOf(draft.value, decimals),
          expectedSequence: view.proposal.allocationSequence,
        },
        "Monthly allocation",
        viewActor,
        owns,
      );
      if (body?.body && owns()) {
        accept(
          body.body as unknown as MonthlyOwnerView,
          view.period,
          body.actorId,
        );
        setDrafts((previous) => {
          const next = { ...previous };
          const month = { ...(next[view.period] ?? {}) };
          delete month[githubUserId];
          next[view.period] = month;
          return next;
        });
        setNotice("Allocation saved privately.");
      }
    });
  const finalize = () =>
    run(async (owns) => {
      if (!view?.proposal) return;
      const body = await call(
        `/monthly/${view.period}/finalize`,
        { expectedSequence: view.proposal.allocationSequence },
        "Monthly finalization",
        viewActor,
        owns,
      );
      if (body?.body && owns()) {
        accept(
          body.body as unknown as MonthlyOwnerView,
          view.period,
          body.actorId,
        );
        setDrafts((previous) => {
          const next = { ...previous };
          delete next[view.period];
          return next;
        });
        setNotice("This month's awards are final.");
      }
    });
  const toggleAutomatic = () =>
    run(async (owns) => {
      if (!view) return;
      const body = await call(
        "/monthly-settings",
        { automatic: !view.automatic },
        "Monthly finalization setting",
        viewActor,
        owns,
      );
      if (owns() && body?.body && typeof body.body.automatic === "boolean")
        setView({ ...view, automatic: body.body.automatic });
    });

  useTimeBoundary(
    view?.automatic && !view.run && view.cutoffAt
      ? Date.parse(view.cutoffAt)
      : null,
  );

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
    !monthlyProject &&
    months.length === 0 &&
    recovery.pending.length === 0 &&
    !recovery.error &&
    !opened
  )
    return null;
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
      {!signedOut &&
        recovery.pending.map((entry) => (
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
                disabled={busy || period <= firstMonth}
                onClick={() => selectMonth(shiftPeriod(period, -1))}
              >
                <ChevronLeft aria-hidden="true" />
              </button>
              <span aria-live="polite">{formatCycleMonth(period)}</span>
              <button
                type="button"
                className="button secondary-button icon-button"
                aria-label="Next award month"
                disabled={busy || period >= lastClosedMonth}
                onClick={() => selectMonth(shiftPeriod(period, 1))}
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
                            .
                            {view.canManage
                              ? " You can finalize earlier."
                              : null}
                          </>
                        ) : view.canManage ? (
                          "Finalize this month manually."
                        ) : null
                      ) : view.canManage ? (
                        "Finalize each month manually."
                      ) : null}
                    </span>
                  </p>
                  {view.canManage ? (
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
                  ) : (
                    <p role="status">View only</p>
                  )}
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
                            {view.canManage && (
                              <div className="owner-award-edit">
                                <label htmlFor={id}>
                                  <span aria-hidden="true">
                                    {drafts[view.period]?.[row.githubUserId] ===
                                    undefined
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
                                    drafts[view.period]?.[row.githubUserId]
                                      ?.value ??
                                    editableUnits(row.grossBase, decimals)
                                  }
                                  onChange={(event) =>
                                    setDrafts({
                                      ...drafts,
                                      [view.period]: {
                                        ...(drafts[view.period] ?? {}),
                                        [row.githubUserId]: {
                                          value: event.target.value,
                                          base: row.grossBase,
                                        },
                                      },
                                    })
                                  }
                                />
                                <button
                                  className="button secondary-button"
                                  type="button"
                                  disabled={
                                    busy ||
                                    cutoffPassed ||
                                    drafts[view.period]?.[row.githubUserId] ===
                                      undefined
                                  }
                                  aria-label={`Save ${row.login}`}
                                  onClick={() => void save(row.githubUserId)}
                                >
                                  Save
                                </button>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {view.canManage && (
                    <button
                      className="button primary-button"
                      type="button"
                      disabled={busy}
                      onClick={() => void finalize()}
                    >
                      Finalize awards
                    </button>
                  )}
                </>
              ) : (
                <>
                  <p role="status">
                    Finalized{" "}
                    {view.run.trigger === "automatic"
                      ? "automatically"
                      : view.canManage
                        ? "by you"
                        : "by the owner"}{" "}
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
          {view?.deployment &&
            (view.canManage ||
              hasSubmittedRelease(
                project.id,
                `${view.period}:${view.deployment.network}`,
              )) && (
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
