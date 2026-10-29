import {
  Bot,
  Check,
  CircleAlert,
  Clock,
  KeyRound,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "./Link";
import "./owner-review.css";
import { errorMessage } from "./lib/errors";
import { checkProjectSetup } from "./lib/project-api";
import type { ProjectSetupStatus } from "./lib/project-contracts";
import { formatMonthlyAmount } from "./lib/project-proposal";
import { REWARD_ASSET_NETWORKS } from "./lib/reward-asset.mjs";
import { NetworkName, StatusBadge } from "./Presentation";

const HEADINGS: Record<ProjectSetupStatus["state"], string> = {
  ready: "Ready",
  action_required: "Action needed",
  waiting: "Waiting for the security scan",
  retry: "Unavailable",
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

function SetupBadge({
  label,
  tone,
}: {
  label: string;
  tone: "ready" | "pending" | "warning";
}) {
  const Icon =
    tone === "ready" ? Check : tone === "pending" ? Clock : CircleAlert;
  return (
    <StatusBadge
      tone={
        tone === "ready" ? "success" : tone === "pending" ? "info" : "warning"
      }
      icon={<Icon size={14} />}
    >
      {label}
    </StatusBadge>
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
  onSetup,
  showProjectLink = true,
}: {
  projectId: string;
  initial?: ProjectSetupStatus;
  /** Tells the page the current setup, such as the scan exemption. */
  onSetup?: (setup: ProjectSetupStatus) => void;
  showProjectLink?: boolean;
}) {
  const [setup, setSetup] = useState<ProjectSetupStatus | null>(
    initial ?? null,
  );
  useEffect(() => {
    if (setup !== null) onSetup?.(setup);
  }, [onSetup, setup]);
  const [busy, setBusy] = useState(initial === undefined);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const check = useCallback(
    (requestScan = false) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      setError(null);
      void checkProjectSetup(projectId, requestScan)
        .then(
          (body) => setSetup(body.setup),
          (caught: unknown) =>
            setError(errorMessage(caught, "The setup check did not finish.")),
        )
        .finally(() => {
          inFlight.current = false;
          setBusy(false);
        });
    },
    [projectId],
  );
  useEffect(() => {
    if (initial === undefined) check();
  }, [check, initial]);
  useEffect(() => {
    if (!setup || setup.state === "ready" || setup.state === "restricted")
      return;
    const refresh = () => {
      if (!busy && document.visibilityState === "visible") check();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [busy, check, setup]);
  return (
    <section
      aria-labelledby={`setup-${projectId}`}
      className={`owner-section project-setup-status${setup?.state === "ready" ? " is-ready" : ""}`}
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
          {setup.state !== "ready" ? (
            <p role="status">{setup.nextAction.message}</p>
          ) : showProjectLink ? (
            <Link href={`/projects/${setup.slug}`}>View project</Link>
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
                <SetupBadge
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
                <SetupBadge
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
                <SetupBadge
                  label={
                    setup.checks.scan.exempt
                      ? "Exempt"
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
                Contribution funding <small>Optional</small>
              </dt>
              <dd>
                {setup.funding.mode === "none" ? (
                  <span className="setup-funding-note">Points only</span>
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
                      <NetworkName chain={setup.funding.network}>
                        {REWARD_ASSET_NETWORKS[
                          setup.funding
                            .network as keyof typeof REWARD_ASSET_NETWORKS
                        ]?.name ?? setup.funding.network}
                      </NetworkName>
                    </span>
                    <a href={`/projects/${setup.slug}/manage#project-vault`}>
                      Vault funding
                    </a>
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
