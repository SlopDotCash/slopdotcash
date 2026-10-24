import { useCallback, useEffect, useState } from "react";
import { Link } from "./Link";
import { checkProjectSetup } from "./lib/project-api";
import type { ProjectSetupStatus } from "./lib/project-contracts";
import { formatMonthlyAmount } from "./lib/project-proposal";
import { REWARD_ASSET_NETWORKS } from "./lib/reward-asset.mjs";

const HEADINGS: Record<ProjectSetupStatus["state"], string> = {
  ready: "Ready",
  action_required: "Action needed",
  waiting: "Waiting for the security scan",
  retry: "Check again",
  restricted: "Closed to contributors",
};

const AUTHORITY: Record<
  ProjectSetupStatus["checks"]["authority"]["state"],
  string
> = {
  verified: "Confirmed",
  denied: "Not confirmed",
  retry: "Not checked yet",
};
const INSTALLATION: Record<
  ProjectSetupStatus["checks"]["installation"]["state"],
  string
> = {
  installed: "Installed",
  missing: "Not installed",
  suspended: "Suspended",
  retry: "Not checked yet",
};
const SCAN: Record<ProjectSetupStatus["checks"]["scan"]["state"], string> = {
  cleared: "Passed",
  queued: "Queued",
  unscanned: "Not scanned",
  stale: "Needs a new scan",
  quarantined: "Did not finish",
  banned: "Blocked",
  unverified: "Not verified",
  unavailable: "Unavailable",
};

function fundingText(funding: ProjectSetupStatus["funding"]): string {
  if (funding.mode === "none")
    return "No monthly funding. Contributors still earn Slop Score for accepted work.";
  const network =
    REWARD_ASSET_NETWORKS[funding.network as keyof typeof REWARD_ASSET_NETWORKS]
      ?.name ?? funding.network;
  return `${formatMonthlyAmount(funding.monthlyAmountMinor, funding.symbol)} per month on ${network} · ${funding.state === "committed" ? "committed in the vault" : "pledged, not yet deposited"} · payments ${funding.payments}`;
}

/**
 * One setup status per project (PRD section 4 and 7): the result, the next
 * action and each check, with funding shown separately. Checking runs every
 * setup check on the server; a project that passes activates then.
 */
export function ProjectSetupStatusPanel({
  projectId,
  initial,
}: {
  projectId: string;
  initial?: ProjectSetupStatus;
}) {
  const [setup, setSetup] = useState<ProjectSetupStatus | null>(
    initial ?? null,
  );
  const [busy, setBusy] = useState(initial === undefined);
  const [error, setError] = useState<string | null>(null);
  const check = useCallback(
    (requestScan = false) => {
      setBusy(true);
      setError(null);
      checkProjectSetup(projectId, requestScan).then(
        (body) => {
          setSetup(body.setup);
          setBusy(false);
        },
        (caught: unknown) => {
          setError(
            caught instanceof Error
              ? caught.message
              : "The setup check did not finish.",
          );
          setBusy(false);
        },
      );
    },
    [projectId],
  );
  useEffect(() => {
    if (initial === undefined) check();
  }, [check, initial]);
  return (
    <section
      aria-labelledby={`setup-${projectId}`}
      className="owner-section project-setup-status"
    >
      <h2 id={`setup-${projectId}`}>
        Setup status
        {setup ? `: ${HEADINGS[setup.state]}` : ""}
      </h2>
      {setup === null ? (
        error ? null : (
          <p role="status">Checking setup…</p>
        )
      ) : (
        <>
          <p role="status">{setup.nextAction.message}</p>
          {setup.activatedRevision !== null ? (
            <p>
              The project is now active as revision {setup.activatedRevision}.{" "}
              <Link href={`/projects/${setup.slug}`}>View project</Link>
            </p>
          ) : null}
          <div className="handoff-actions">
            {setup.nextAction.kind === "install_slopbot" &&
            setup.nextAction.href ? (
              <a
                className="button primary-button"
                href={setup.nextAction.href}
                rel="noreferrer"
                target="_blank"
              >
                Install Slopbot
              </a>
            ) : null}
            {setup.nextAction.kind === "request_scan" ? (
              <button
                className="button primary-button"
                disabled={busy}
                onClick={() => check(true)}
                type="button"
              >
                {busy ? "Requesting…" : "Request a new scan"}
              </button>
            ) : null}
            {setup.nextAction.kind !== "none" &&
            setup.nextAction.kind !== "restricted" ? (
              <button
                className="button secondary-button"
                disabled={busy}
                onClick={() => check()}
                type="button"
              >
                {busy ? "Checking…" : "Check again"}
              </button>
            ) : null}
          </div>
          <dl className="proposal-facts">
            <div>
              <dt>GitHub access</dt>
              <dd>
                {AUTHORITY[setup.checks.authority.state]}.{" "}
                {setup.checks.authority.message}
              </dd>
            </div>
            <div>
              <dt>Slopbot</dt>
              <dd>
                {INSTALLATION[setup.checks.installation.state]}.{" "}
                {setup.checks.installation.message}
              </dd>
            </div>
            <div>
              <dt>Security scan</dt>
              <dd>
                {SCAN[setup.checks.scan.state]}. {setup.checks.scan.message}
              </dd>
            </div>
            <div>
              <dt>Funding (optional)</dt>
              <dd>{fundingText(setup.funding)}</dd>
            </div>
          </dl>
        </>
      )}
      {error ? (
        <div role="alert" className="form-error">
          <p>{error}</p>
          <button
            className="button secondary-button"
            disabled={busy}
            onClick={() => check()}
            type="button"
          >
            Try again
          </button>
        </div>
      ) : null}
    </section>
  );
}
