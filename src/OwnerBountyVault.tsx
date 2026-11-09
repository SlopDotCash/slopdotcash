import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { formatBaseUnits } from "./lib/base-units.mjs";
import { errorMessage } from "./lib/errors";
import {
  currentProjectSession,
  ProjectApiError,
  projectApiRequest,
  useProjectMaintainer,
} from "./lib/project-api";
import type { ProjectDefinition } from "./lib/projects.mjs";
import { NETWORK_NAMES } from "./lib/reward-asset.mjs";
import { formatDateTime, NetworkName } from "./Presentation";
import { VaultActions } from "./VaultActions";

type PrivateFunds = {
  currency: string;
  decimals: number;
  availableMinor: string;
  freeMinor: string;
  snapshotAt: string;
};

/** Same public vault framing, backed only by the separate bounty vault. */
export function ProjectBountyFunding({
  project,
}: {
  project: ProjectDefinition;
}) {
  if (!project.securityBounty?.settlement?.deployments.length) return null;
  return <ExistingProjectBountyFunding project={project} />;
}

function ExistingProjectBountyFunding({
  project,
}: {
  project: ProjectDefinition;
}) {
  const { allowed } = useProjectMaintainer(project.id);
  const terms = project.securityBounty;
  const deployments = terms?.settlement?.deployments ?? [];
  if (!terms || deployments.length === 0) return null;
  const chain = terms.settlement?.chain ?? terms.amount.network;
  return (
    <section
      id="funding"
      className="section project-funding"
      aria-label="Project bounty vault"
    >
      <header className="vault-header">
        <h2>
          Project vault{" "}
          {chain && (
            <NetworkName chain={chain} iconOnly>
              {NETWORK_NAMES[chain]}
            </NetworkName>
          )}
        </h2>
      </header>
      {allowed ? (
        <OwnerBountyVault project={project} compact />
      ) : (
        <div className="vault-totals">
          {deployments.map((deployment) => (
            <p key={`${deployment.network}:${deployment.vault}`}>
              Vault <code>{deployment.vault}</code>
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

/** Owner-only funding view. Bounty balances never use the public payment API. */
export function OwnerBountyVault({
  project,
  compact = false,
}: {
  project: ProjectDefinition;
  compact?: boolean;
}) {
  if (!project.securityBounty?.settlement?.deployments.length) return null;
  return <ExistingBountyVault project={project} compact={compact} />;
}

function ExistingBountyVault({
  project,
  compact,
}: {
  project: ProjectDefinition;
  compact: boolean;
}) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | {
        status: "ready";
        actorId: string;
        funds: PrivateFunds | null;
        canSetup: boolean;
        refreshError?: string;
      }
  >({ status: "loading" });
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: context changes retire pending work during layout cleanup.
  useLayoutEffect(
    () => () => {
      generation.current += 1;
    },
    [project, reload],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: Refresh repeats the private balance read.
  useEffect(() => {
    let active = true;
    const currentGeneration = generation.current;
    const owns = () => active && generation.current === currentGeneration;
    // A balance refresh must not unmount the wallet action and erase its
    // finalized result or an in-flight recovery form.
    setState((previous) =>
      previous.status === "ready" ? previous : { status: "loading" },
    );
    const load = async () => {
      let actorId: string | null = null;
      let identityVerified = false;
      try {
        const session = await currentProjectSession();
        if (!owns()) return;
        if (!session) throw new Error("Sign in to view private bounty funds.");
        actorId = session.githubId;
        setState((previous) =>
          previous.status === "ready" && previous.actorId === actorId
            ? previous
            : { status: "loading" },
        );
        let result:
          | { funds: PrivateFunds | null; canSetup: boolean }
          | undefined;
        let failure: unknown;
        let failed = false;
        try {
          result = await projectApiRequest<{
            funds: PrivateFunds | null;
            canSetup: boolean;
          }>(
            "GET",
            `project-vaults/${project.id}?purpose=security-bounty`,
            undefined,
            { expectedActorGithubId: actorId },
          );
        } catch (cause) {
          failed = true;
          failure = cause;
          if (
            owns() &&
            cause instanceof ProjectApiError &&
            [401, 403, 404, 410].includes(cause.status)
          )
            setState({ status: "error", message: errorMessage(cause) });
        }
        if (!owns()) return;
        const current = await currentProjectSession();
        if (!owns()) return;
        if (current?.githubId !== actorId)
          throw new Error(
            "Your account changed. Refresh private bounty funds.",
          );
        identityVerified = true;
        if (failed) throw failure;
        if (!result) throw new Error("Bounty funds could not load.");
        setState({ status: "ready", ...result, actorId });
      } catch (error: unknown) {
        if (!owns()) return;
        const message = errorMessage(error, "Bounty funds could not load.");
        const temporary =
          identityVerified &&
          error instanceof ProjectApiError &&
          (error.status === 0 || error.status >= 500);
        setState((previous) =>
          temporary &&
          previous.status === "ready" &&
          previous.actorId === actorId
            ? { ...previous, canSetup: false, refreshError: message }
            : { status: "error", message },
        );
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [project, reload]);
  const deployments = project.securityBounty?.settlement?.deployments ?? [];
  return (
    <section className="owner-section" aria-label="Bounty funds">
      {compact ? null : <h2>Bounty funds</h2>}
      <div className="owner-form">
        {compact ? null : <p>Separate from contribution rewards.</p>}
        {state.status === "loading" ? (
          <p role="status">Loading bounty funds…</p>
        ) : null}
        {state.status === "error" ? <p role="alert">{state.message}</p> : null}
        {state.status === "ready" ? (
          <>
            {state.refreshError ? (
              <p role="alert">
                {state.refreshError}{" "}
                {state.funds
                  ? "Last verified balance is stale."
                  : "Last verified vault information is shown."}{" "}
                Setup and deposits resume after a successful refresh.
              </p>
            ) : null}
            {!state.canSetup && !state.refreshError ? (
              <p>
                This project is restricted. New setup and deposits are disabled.
                {deployments.length > 0
                  ? " You can still withdraw free funds."
                  : " Setup resumes after reinstatement."}
              </p>
            ) : null}
            {state.funds ? (
              <>
                <p>
                  Available for new awards:{" "}
                  {formatBaseUnits(
                    state.funds.availableMinor,
                    state.funds.decimals,
                  )}{" "}
                  {state.funds.currency}.
                </p>
                <p>
                  Finalized balance checked at{" "}
                  {formatDateTime(state.funds.snapshotAt)}.
                </p>
              </>
            ) : (
              <p>No finalized balance yet. After a deposit, refresh later.</p>
            )}
            {deployments.map((deployment) => (
              <VaultActions
                key={`${deployment.network}:${deployment.vault}`}
                projectId={project.id}
                deployment={deployment}
                payoutPolicy="security-bounty"
                canDeposit={state.canSetup}
                onFinalized={() => setReload((value) => value + 1)}
              />
            ))}
          </>
        ) : null}
        <button
          type="button"
          className="button secondary-button"
          disabled={state.status === "loading"}
          onClick={() => setReload((value) => value + 1)}
        >
          Refresh bounty funds
        </button>
      </div>
    </section>
  );
}
