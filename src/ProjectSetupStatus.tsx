import {
  Bot,
  Check,
  CircleAlert,
  Clock,
  KeyRound,
  ShieldCheck,
  Wallet,
} from "lucide-react";
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
  retry: "Unavailable",
};
const INSTALLATION: Record<
  ProjectSetupStatus["checks"]["installation"]["state"],
  string
> = {
  installed: "Installed",
  missing: "Not installed",
  suspended: "Suspended",
  retry: "Unavailable",
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

function StatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: "ready" | "pending" | "warning";
}) {
  const Icon =
    tone === "ready" ? Check : tone === "pending" ? Clock : CircleAlert;
  return (
    <span className={`setup-badge setup-badge--${tone}`}>
      <Icon size={14} aria-hidden="true" />
      {label}
    </span>
  );
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
          <dl className="setup-checks">
            <div className="setup-check">
              <dt>
                <KeyRound size={20} aria-hidden="true" />
                GitHub access
              </dt>
              <dd>
                <StatusBadge
                  label={AUTHORITY[setup.checks.authority.state]}
                  tone={
                    setup.checks.authority.state === "verified"
                      ? "ready"
                      : "warning"
                  }
                />
              </dd>
            </div>
            <div className="setup-check">
              <dt>
                <Bot size={20} aria-hidden="true" />
                Slopbot
              </dt>
              <dd>
                <StatusBadge
                  label={INSTALLATION[setup.checks.installation.state]}
                  tone={
                    setup.checks.installation.state === "installed"
                      ? "ready"
                      : "warning"
                  }
                />
              </dd>
            </div>
            <div className="setup-check">
              <dt>
                <ShieldCheck size={20} aria-hidden="true" />
                Security scan
              </dt>
              <dd>
                <StatusBadge
                  label={
                    setup.checks.scan.exempt
                      ? "Grandfathered"
                      : SCAN[setup.checks.scan.state]
                  }
                  tone={
                    setup.checks.scan.exempt ||
                    setup.checks.scan.state === "cleared"
                      ? "ready"
                      : ["queued", "unscanned"].includes(
                            setup.checks.scan.state,
                          )
                        ? "pending"
                        : "warning"
                  }
                />
              </dd>
            </div>
            <div className="setup-check setup-check--funding">
              <dt>
                <Wallet size={20} aria-hidden="true" />
                Funding <small>Optional</small>
              </dt>
              <dd>
                {setup.funding.mode === "none" ? (
                  <span className="setup-funding-note">
                    Not configured · points only
                  </span>
                ) : (
                  <>
                    <strong>
                      {formatMonthlyAmount(
                        setup.funding.monthlyAmountMinor,
                        setup.funding.decimals,
                        setup.funding.symbol,
                      )}{" "}
                      / month
                    </strong>
                    <span className="setup-funding-note">
                      {REWARD_ASSET_NETWORKS[
                        setup.funding
                          .network as keyof typeof REWARD_ASSET_NETWORKS
                      ]?.name ?? setup.funding.network}
                    </span>
                    <Link href={`/projects/${setup.slug}/funding`}>
                      View vault funds and automatic payment
                    </Link>
                  </>
                )}
              </dd>
            </div>
          </dl>
          <details className="setup-details">
            <summary>Check details</summary>
            <dl>
              <dt>GitHub access</dt>
              <dd>{setup.checks.authority.message}</dd>
              <dt>Slopbot</dt>
              <dd>{setup.checks.installation.message}</dd>
              <dt>Security scan</dt>
              <dd>{setup.checks.scan.message}</dd>
            </dl>
          </details>
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
