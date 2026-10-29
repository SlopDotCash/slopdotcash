import { useEffect, useState } from "react";
import { formatBaseUnits } from "./lib/base-units.mjs";
import { errorMessage } from "./lib/errors";
import type { VaultConnection } from "./lib/evm-vault-actions";
import {
  ProjectApiError,
  projectApiRequest,
  useProjectMaintainer,
} from "./lib/project-api";
import type { ProjectDefinition } from "./lib/projects.mjs";
import { NETWORK_NAMES } from "./lib/reward-asset.mjs";
import { isFullAwardSplit } from "./lib/security-bounty.mjs";
import { OwnerVaultSetup } from "./OwnerVaultSetup";
import { formatDateTime, NetworkName } from "./Presentation";
import { VaultActions } from "./VaultActions";

type PrivateFunds = {
  currency: string;
  decimals: number;
  availableMinor: string;
  freeMinor: string;
  snapshotAt: string;
};

/** A slop.cash-sponsored full award binds no bounty vault: every bounty
 * vault pays 75/25 (PRD section 8, owner decision 28 October 2026). */
export function FullAwardFundingNote() {
  return (
    <p className="vault-unconfigured" role="status">
      slop.cash funds approved awards after review. This program pays the whole
      award to the researcher, so it uses no 75/25 bounty vault. An approved
      award is not payable until a full-award payment path is approved and
      released.
    </p>
  );
}

/** Same public vault framing, backed only by the separate bounty vault. */
export function ProjectBountyFunding({
  project: initial,
}: {
  project: ProjectDefinition;
}) {
  const [project, setProject] = useState(initial);
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
      {isFullAwardSplit(terms.split) ? (
        <FullAwardFundingNote />
      ) : allowed ? (
        <OwnerBountyVault
          project={project}
          compact
          onRegistered={({ project: updated }) => setProject(updated)}
        />
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
  onRegistered,
  compact = false,
}: {
  project: ProjectDefinition;
  compact?: boolean;
  onRegistered: (value: {
    project: ProjectDefinition;
    revision: number;
  }) => void;
}) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | {
        status: "ready";
        funds: PrivateFunds | null;
        canSetup: boolean;
        refreshError?: string;
      }
  >({ status: "loading" });
  const [reload, setReload] = useState(0);
  const [wallet, setWallet] = useState<VaultConnection | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Refresh repeats the private balance read.
  useEffect(() => {
    let active = true;
    // A balance refresh must not unmount the wallet action and erase its
    // finalized result or an in-flight recovery form.
    setState((previous) =>
      previous.status === "ready" ? previous : { status: "loading" },
    );
    projectApiRequest<{ funds: PrivateFunds | null; canSetup: boolean }>(
      "GET",
      `project-vaults/${project.id}?purpose=security-bounty`,
    ).then(
      (result) => {
        if (active) setState({ status: "ready", ...result });
      },
      (error: unknown) => {
        if (!active) return;
        const message = errorMessage(error, "Bounty funds could not load.");
        const temporary =
          error instanceof ProjectApiError &&
          (error.status === 0 || error.status >= 500);
        setState((previous) =>
          temporary && previous.status === "ready"
            ? { ...previous, canSetup: false, refreshError: message }
            : { status: "error", message },
        );
      },
    );
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
            {deployments.length === 0 && state.canSetup ? (
              <OwnerVaultSetup
                project={project}
                payoutPolicy="security-bounty"
                onRegistered={(registered, connected, _notice, revision) => {
                  setWallet(connected);
                  onRegistered({ project: registered, revision });
                  setReload((value) => value + 1);
                }}
              />
            ) : null}
            {deployments.map((deployment) => (
              <VaultActions
                key={`${deployment.network}:${deployment.vault}`}
                projectId={project.id}
                deployment={deployment}
                payoutPolicy="security-bounty"
                canDeposit={state.canSetup}
                connectedWallet={wallet ?? undefined}
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
