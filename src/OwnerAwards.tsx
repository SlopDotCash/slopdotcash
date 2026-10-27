import { type FormEvent, useCallback, useEffect, useState } from "react";
import type { MonthlyOwnerView } from "../backend/payments/monthly";
import { loginHref } from "./lib/browser-deployment";
import { readBoundedJson } from "./lib/browser-json";
import { errorMessage } from "./lib/errors";
import { formatBaseUnits } from "./lib/payments/contracts";
import { parseVaultAmount } from "./lib/payments/vault-amount";
import { apiRequest } from "./lib/project-api";
import type { ProjectDefinition } from "./lib/projects.mjs";
import { useAction } from "./lib/use-action";
import OwnerCommitment, { recoverOwnerCommitments } from "./OwnerCommitment";
import OwnerReserveRelease from "./OwnerReserveRelease";
import { formatDateTime } from "./Presentation";

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
}: {
  project: ProjectDefinition;
}) {
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
  const [monthRequest, setMonthRequest] = useState(() => ({
    period: previousMonth(),
    revision: 0,
  }));
  const { period } = monthRequest;
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
  }, [accept, call, monthRequest, setActionError]);
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
        "Monthly payment setting",
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
  return (
    <main className="shell route-main owner-awards-page">
      <h1>Monthly awards</h1>
      {recovery.error && <p role="alert">{recovery.error}</p>}
      {recovery.pending.map((entry) => (
        <OwnerCommitment
          key={`recovery:${entry.cycleId}:${entry.expected.network}:${entry.expected.githubUserId}`}
          projectId={project.id}
          cycleId={entry.cycleId}
          expected={entry.expected}
        />
      ))}
      <form onSubmit={load}>
        <label>
          Contribution month
          <input
            type="month"
            required
            value={period}
            disabled={busy}
            onChange={(event) => {
              setMonthRequest({
                period: event.target.value,
                revision: monthRequest.revision,
              });
              setView(null);
            }}
          />
        </label>
        <button className="button primary-button" type="submit" disabled={busy}>
          {loading ? "Loading…" : "Refresh awards"}
        </button>
      </form>
      {signedOut && (
        <p>
          <a href={loginHref(`/projects/${project.slug}/awards`)}>
            Sign in with GitHub
          </a>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {view && (
        <section aria-label="Monthly awards">
          <h2>{view.period} awards</h2>
          <p>
            Automatic monthly payment is{" "}
            <strong>{view.automatic ? "on" : "off"}</strong>.{" "}
            {view.automatic
              ? cutoffPassed
                ? "The cutoff has passed. Current allocations are finalized automatically."
                : view.cutoffAt
                  ? `Unless you finalize earlier, the current allocations are finalized at ${formatDateTime(view.cutoffAt)}.`
                  : "Automatic payment starts later. Finalize this month yourself."
              : "Finalize each month yourself."}
            {project.reward.paymentMode !== "enabled" &&
              " Payments are disabled for this project."}
          </p>
          <button
            className="button secondary-button"
            type="button"
            disabled={busy}
            onClick={() => void toggleAutomatic()}
          >
            {view.automatic
              ? "Turn off automatic payment"
              : "Turn on automatic payment"}
          </button>
          {!view.proposal ? (
            <p>No allocation is proposed for this month yet.</p>
          ) : !view.run ? (
            <>
              <p>
                Allocated{" "}
                {amount(
                  view.proposal.allocations
                    .reduce((sum, row) => sum + BigInt(row.grossBase), 0n)
                    .toString(),
                )}{" "}
                of {amount(view.proposal.capBase)}.
              </p>
              {view.proposal.allocations.length === 0 ? (
                <p>No one has an allocation this month.</p>
              ) : (
                <ul className="owner-award-list" aria-label="Allocations">
                  {view.proposal.allocations.map((row) => {
                    const id = `allocation-${row.githubUserId}`;
                    return (
                      <li key={row.githubUserId}>
                        <h3>{row.login}</h3>
                        <dl>
                          <dt>Proposed</dt>
                          <dd>{amount(row.proposedGrossBase)}</dd>
                        </dl>
                        <label htmlFor={id}>
                          Award for {row.login}
                          {decimals === null ? " (base units)" : ""}
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
                          onClick={() => void save(row.githubUserId)}
                        >
                          Save {row.login}
                        </button>
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
                {view.run.trigger === "automatic" ? "automatically" : "by you"}{" "}
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
                      <h3>{award.login}</h3>
                      <dl>
                        <dt>Award</dt>
                        <dd>{amount(award.grossBase)}</dd>
                        <dt>Contributor receives</dt>
                        <dd>{amount(award.netBase)}</dd>
                        <dt>Status</dt>
                        <dd>{STATE_TEXT[award.state]}</dd>
                      </dl>
                      {reservable && award.state === "awaiting-reservation" && (
                        <button
                          className="button secondary-button"
                          type="button"
                          onClick={() => setSelectedActor(award.githubUserId)}
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
        </section>
      )}
      <p>
        <a href={`/projects/${project.slug}`}>{project.name}</a> ·{" "}
        <a href={`/projects/${project.slug}/funding`}>Project funding</a> ·{" "}
        <a href={`/projects/${project.slug}/manage`}>Project settings</a>
      </p>
      {view?.deployment && (
        <OwnerReserveRelease
          key={`${view.projectId}:${view.period}:${view.manifestSha256}`}
          view={view}
        />
      )}
    </main>
  );
}
