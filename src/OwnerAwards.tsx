import { type FormEvent, useState } from "react";
import type { MonthlyOwnerView } from "../backend/payments/monthly";
import { readBoundedJson } from "./lib/browser-json";
import { formatBaseUnits } from "./lib/payments/contracts";
import { parseVaultAmount } from "./lib/payments/vault-amount";
import type { ProjectDefinition } from "./lib/projects.mjs";
import OwnerCommitment, { recoverOwnerCommitments } from "./OwnerCommitment";
import OwnerReserveRelease from "./OwnerReserveRelease";
import { loginHref } from "./Points";
import { formatDateTime } from "./Presentation";

function previousMonth() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    .toISOString()
    .slice(0, 7);
}
/** Base units as a plain decimal an owner can edit, without grouping separators. */
function editableUnits(base: string, decimals: number | null) {
  if (decimals === null || decimals === 0) return base;
  const digits = base.padStart(decimals + 1, "0");
  const whole = digits.slice(0, -decimals);
  const fraction = digits.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
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
  underfunded: "Underfunded: waiting for free vault funds",
  excluded: "Excluded: account banned",
  "awaiting-reservation": "Approved and funded: ready for your reservation",
  reserved: "Reserved in the vault; payment not yet verified",
  paid: "Paid",
  conflict: "Conflict: a different award is reserved under this award's source",
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
        error:
          reason instanceof Error
            ? reason.message
            : "Saved commitments are unavailable.",
      };
    }
  });
  const [period, setPeriod] = useState(previousMonth);
  const [view, setView] = useState<MonthlyOwnerView | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [selectedActor, setSelectedActor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [signedOut, setSignedOut] = useState(false);
  const base = `/api/v1/payments/projects/${encodeURIComponent(project.id)}`;
  const decimals = view?.asset?.assetDecimals ?? null;
  const symbol = view?.asset?.symbol ?? null;
  const amount = (value: string) =>
    decimals === null
      ? `${value} token base units`
      : `${formatBaseUnits(value, decimals)}${symbol ? ` ${symbol}` : ""}`;

  function accept(body: MonthlyOwnerView, month: string) {
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
  }
  async function call(
    path: string,
    init: RequestInit | undefined,
    label: string,
  ) {
    const response = await fetch(`${base}${path}`, {
      ...init,
      signal: AbortSignal.timeout(120000),
    });
    const body = (await readBoundedJson(
      response,
      8 * 1024 * 1024,
      label,
    )) as Record<string, unknown> & { message?: string };
    if (response.status === 401) {
      setSignedOut(true);
      return null;
    }
    if (!response.ok)
      throw new Error(body.message ?? "Awards are unavailable. Retry.");
    return body;
  }
  const post = (path: string, body: unknown, label: string) =>
    call(
      path,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      label,
    );
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    setSignedOut(false);
    try {
      await action();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Awards are unavailable.",
      );
    } finally {
      setBusy(false);
    }
  }
  function load(event: FormEvent) {
    event.preventDefault();
    setView(null);
    setSelectedActor(null);
    void run(async () => {
      const body = await call(
        `/monthly/${period}`,
        undefined,
        "Monthly awards",
      );
      if (body) accept(body as unknown as MonthlyOwnerView, period);
    });
  }
  const save = (githubUserId: string) =>
    run(async () => {
      if (!view?.proposal) return;
      const draft = drafts[githubUserId];
      if (draft === undefined) return;
      const body = await post(
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
      const body = await post(
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
      const body = await post(
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
  const total = view?.proposal?.allocations.reduce(
    (sum, row) => sum + BigInt(row.grossBase),
    0n,
  );
  const reservable =
    view?.run && view.deployment?.network === view.run.network
      ? view.deployment.network
      : null;
  return (
    <main className="shell route-main owner-awards-page">
      <p>
        <a href={`/projects/${project.slug}`}>{project.name}</a> / Awards
      </p>
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
              setPeriod(event.target.value);
              setView(null);
            }}
          />
        </label>
        <button className="button primary-button" type="submit" disabled={busy}>
          {busy && !view ? "Checking authority…" : "Load awards"}
        </button>
      </form>
      {signedOut && (
        <p>
          <a href={loginHref(`/projects/${project.slug}/awards`)}>
            Sign in with GitHub to manage this project’s awards
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
                ? "The cutoff has passed. The automatic process finalizes the current allocations."
                : view.cutoffAt
                  ? `Unless you finalize earlier, the current allocations are finalized at ${formatDateTime(view.cutoffAt)}.`
                  : "Automatic payment starts with a later month, so finalize this month yourself when it is ready."
              : "Finalize each month yourself."}
            {project.reward.paymentMode !== "enabled" &&
              " Payments are disabled for this project, so no award is paid until payments are enabled."}
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
                Changes are private. Slop publishes final awards and payment
                evidence, never the changes.
              </p>
              <p>
                Allocated {amount(String(total ?? 0n))} of{" "}
                {amount(view.proposal.capBase)}. Unallocated funds stay in the
                vault and never raise a later month.
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
                Finalize these awards now
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
                .{" "}
                {view.run.funded
                  ? "Funding is recorded for eligible awards. Excluded entries receive no payment."
                  : "Awards wait until the vault's free balance covers them."}
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
