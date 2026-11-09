import {
  Bot,
  Check,
  CircleAlert,
  Clock,
  KeyRound,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Link } from "./Link";
import "./owner-review.css";
import { errorMessage } from "./lib/errors";
import {
  checkProjectSetup,
  currentProjectSession,
  ProjectApiError,
} from "./lib/project-api";
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
  quarantined: "Not cleared",
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
type ProjectSetupStatusProps = {
  actorId: string;
  projectId: string;
  initial?: ProjectSetupStatus;
  /** Clear the parent's setup projection when its private access is lost. */
  onSetup?: (setup: ProjectSetupStatus | null) => void;
  showProjectLink?: boolean;
  compact?: boolean;
};

export function ProjectSetupStatusPanel(props: ProjectSetupStatusProps) {
  return (
    <ProjectSetupStatusForActor
      key={`${props.projectId}:${props.actorId}`}
      {...props}
    />
  );
}

function ProjectSetupStatusForActor({
  actorId,
  projectId,
  initial,
  onSetup,
  showProjectLink = true,
  compact = false,
}: ProjectSetupStatusProps) {
  const [setup, setSetup] = useState<ProjectSetupStatus | null>(
    initial ?? null,
  );
  useEffect(() => {
    onSetup?.(setup);
  }, [onSetup, setup]);
  const [busy, setBusy] = useState(initial === undefined);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const generation = useRef(0);
  const inFlight = useRef<number | null>(null);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
      inFlight.current = null;
    };
  }, []);
  const check = useCallback(
    (requestScan = false) => {
      if (!mounted.current || inFlight.current !== null) return;
      const request = ++generation.current;
      inFlight.current = request;
      const owns = () => mounted.current && inFlight.current === request;
      const requireActor = async () => {
        let session;
        try {
          session = await currentProjectSession();
        } catch {
          throw new ProjectApiError(
            0,
            "identity_unavailable",
            "Your account could not be checked. Try again.",
          );
        }
        if (session?.githubId !== actorId)
          throw new ProjectApiError(
            409,
            "actor_changed",
            "Your account changed. Reload the project setup.",
          );
      };
      setBusy(true);
      setError(null);
      void (async () => {
        try {
          await requireActor();
          if (!owns()) return;
          const body = await checkProjectSetup(projectId, requestScan, actorId);
          if (!owns()) return;
          await requireActor();
          if (!owns()) return;
          if (body.setup.projectId !== projectId)
            throw new ProjectApiError(
              0,
              "invalid_response",
              "The setup response did not match this project. Try again.",
            );
          setSetup(body.setup);
        } catch (caught) {
          if (!owns()) return;
          const accessLost =
            caught instanceof ProjectApiError &&
            ([401, 403, 404, 410].includes(caught.status) ||
              [
                "actor_changed",
                "identity_unavailable",
                "invalid_response",
              ].includes(caught.code));
          if (accessLost) {
            setSetup(null);
          } else {
            try {
              await requireActor();
            } catch (identityError) {
              if (!owns()) return;
              setSetup(null);
              setError(
                errorMessage(
                  identityError,
                  "Your account could not be checked.",
                ),
              );
              return;
            }
            if (!owns()) return;
          }
          setError(errorMessage(caught, "The setup check did not finish."));
        } finally {
          if (owns()) {
            inFlight.current = null;
            setBusy(false);
          }
        }
      })();
    },
    [actorId, projectId],
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
  const checkDetails = setup ? (
    <dl>
      <dt>GitHub access</dt>
      <dd>{setup.checks.authority.message}</dd>
      <dt>Slopbot</dt>
      <dd>{setup.checks.installation.message}</dd>
      <dt>Security scan</dt>
      <dd>{setup.checks.scan.message}</dd>
    </dl>
  ) : null;
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
            setup.nextAction.kind !== "restricted" &&
            setup.nextAction.kind !== "complete_skill_fields" ? (
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
                {setup.funding.mode === "bounty" ? (
                  "Private bounty"
                ) : (
                  <>
                    Contribution funding <small>Optional</small>
                  </>
                )}
              </dt>
              <dd>
                {setup.funding.mode === "none" ? (
                  <span className="setup-funding-note">Points only</span>
                ) : setup.funding.mode === "bounty" ? (
                  <>
                    <strong>
                      {formatMonthlyAmount(
                        setup.funding.awardAmountMinor,
                        setup.funding.decimals,
                        setup.funding.symbol,
                      )}{" "}
                      / accepted finding
                    </strong>
                    <span className="setup-funding-note">
                      {setup.funding.network ? (
                        <>
                          <NetworkName chain={setup.funding.network}>
                            {REWARD_ASSET_NETWORKS[
                              setup.funding
                                .network as keyof typeof REWARD_ASSET_NETWORKS
                            ]?.name ?? setup.funding.network}
                          </NetworkName>
                          {" · "}
                        </>
                      ) : null}
                      {setup.funding.state === "pledged"
                        ? "Pledged"
                        : "Funding verified"}
                    </span>
                  </>
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
          {compact ? (
            <div className="setup-details setup-details-compact">
              {checkDetails}
            </div>
          ) : (
            <details className="setup-details">
              <summary>Check details</summary>
              {checkDetails}
            </details>
          )}
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
