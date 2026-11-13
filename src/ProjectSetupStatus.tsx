import {
  Bot,
  Check,
  CircleAlert,
  Clock,
  KeyRound,
  Lock,
  RefreshCw,
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
import { ScanClearanceBadges } from "./ScanClearanceBadges";

const STATES: Record<
  ProjectSetupStatus["state"],
  {
    label: string;
    tone: "success" | "warning" | "info" | "danger";
    Icon: typeof Check;
  }
> = {
  ready: { label: "Ready", tone: "success", Icon: Check },
  action_required: {
    label: "Action needed",
    tone: "warning",
    Icon: CircleAlert,
  },
  waiting: { label: "Scanning", tone: "info", Icon: Clock },
  retry: { label: "Unavailable", tone: "warning", Icon: CircleAlert },
  restricted: { label: "Closed", tone: "danger", Icon: Lock },
};

/** The one coloured badge that names a project's setup state. */
export function SetupStateBadge({
  state,
}: {
  state: ProjectSetupStatus["state"];
}) {
  const { label, tone, Icon } = STATES[state];
  return (
    <StatusBadge tone={tone} icon={<Icon size={14} />}>
      {label}
    </StatusBadge>
  );
}

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
  stale: "Stale",
  quarantined: "Not cleared",
  banned: "Blocked",
  unverified: "Not verified",
  unavailable: "Unavailable",
};

function SetupBadge({
  label,
  tone,
  title,
}: {
  label: string;
  tone: "ready" | "pending" | "warning";
  /** The server's message for this check. */
  title?: string;
}) {
  const Icon =
    tone === "ready" ? Check : tone === "pending" ? Clock : CircleAlert;
  return (
    <StatusBadge
      tone={
        tone === "ready" ? "success" : tone === "pending" ? "info" : "warning"
      }
      icon={<Icon size={14} />}
      title={title || undefined}
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
  const abandoned = useRef(false);
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
  // Suspense preserves state but retires layout effects while vault controls
  // load. Restart an empty status check on reveal as well as the first mount.
  useLayoutEffect(() => {
    mounted.current = true;
    if (initial === undefined) check();
    return () => {
      mounted.current = false;
      generation.current += 1;
      abandoned.current = inFlight.current !== null;
      inFlight.current = null;
    };
  }, [check, initial]);
  // A suspended route hides this panel without unmounting it: the cleanup
  // above disowns the running check, and only layout effects run again when
  // the panel returns. Read the status again; never repeat a scan request.
  useLayoutEffect(() => {
    if (!abandoned.current) return;
    abandoned.current = false;
    check();
  }, [check]);
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
        Setup
        {setup ? <SetupStateBadge state={setup.state} /> : null}
      </h2>
      {setup === null ? (
        error ? null : (
          <p role="status">Checking setup…</p>
        )
      ) : (
        <>
          {setup.state !== "ready" ? (
            <>
              {/* The badges and buttons already say "install" and "queued". */}
              {setup.nextAction.kind === "install_slopbot" ||
              setup.nextAction.kind === "wait_for_scan" ||
              !setup.nextAction.message ? null : (
                <p role="status">{setup.nextAction.message}</p>
              )}
              {setup.checks.scan.clearance ? (
                <ScanClearanceBadges view={setup.checks.scan.clearance} />
              ) : null}
            </>
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
                {busy ? "Requesting…" : "Rescan"}
              </button>
            ) : null}
            {setup.nextAction.kind !== "none" &&
            setup.nextAction.kind !== "restricted" &&
            setup.nextAction.kind !== "complete_skill_fields" ? (
              <button
                aria-label={busy ? "Checking…" : "Check again"}
                className="button secondary-button icon-button"
                disabled={busy}
                onClick={() => check()}
                title={busy ? "Checking…" : "Check again"}
                type="button"
              >
                <RefreshCw size={16} aria-hidden="true" />
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
                  title={setup.checks.authority.message}
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
                  title={setup.checks.installation.message}
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
                      ? setup.checks.scan.exemptionKind ===
                        "owner-approved-admission"
                        ? "Owner-approved exemption"
                        : "Exempt"
                      : SCAN[setup.checks.scan.state]
                  }
                  title={setup.checks.scan.message}
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
                {setup.funding.mode === "bounty" ? "Private bounty" : "Funding"}
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
                      / finding
                    </strong>
                    <span className="setup-funding-note">
                      {setup.funding.network ? (
                        <NetworkName chain={setup.funding.network}>
                          {REWARD_ASSET_NETWORKS[
                            setup.funding
                              .network as keyof typeof REWARD_ASSET_NETWORKS
                          ]?.name ?? setup.funding.network}
                        </NetworkName>
                      ) : null}
                    </span>
                    {setup.funding.state === "pledged" ? (
                      <StatusBadge tone="warning">Pledged</StatusBadge>
                    ) : (
                      <StatusBadge tone="success" icon={<Check size={14} />}>
                        Funded
                      </StatusBadge>
                    )}
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
                      Fund vault
                    </a>
                  </>
                )}
              </dd>
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
