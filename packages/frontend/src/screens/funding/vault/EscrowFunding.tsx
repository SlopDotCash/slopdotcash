// spec/settlement/vaultSnapshots.md, "A failed refresh keeps the last totals marked stale"; spec/frontend/requests.md, "Only the current request may publish its validated result"; spec/frontend/ownerVault.md, "A withdrawal that would break the month's promise is refused on Slop's pages"; spec/frontend/monthLock.md, "The card appears only once the finalized read shows pledge support"; spec/frontend/vaultLocks.md, "A vault with month locks refuses a withdrawal into its locked funds before the wallet is asked, and Slop's own guard applies only to a vault without them"
import { periodContaining } from "@repo/settlement/kernels/calendar";
import { Alert, DataState, NetworkMark } from "@repo/ui";
import { useState } from "react";
import type { PoolFacts } from "../../../../gen/frontend__projections.ts";
import { useMachine as useRead } from "../../../../gen/frontend__requests.react.ts";
import type { PageRuntime } from "../../../app/runtime.vibe";
import { useAddress } from "../../../app/useAddress.ts";
import { loginHrefFor, useSession } from "../../../app/useSession.ts";
import { viewActor } from "../../../session/session.vibe";
import type { FundingVault } from "../../../kernels/poolFunding.ts";
import { AutomaticMonthlyPayment } from "./AutomaticMonthlyPayment.tsx";
import { type Connection, type TotalsRuntime, type VaultTotals as TotalsRead, totalsRuntime } from "./funding.vibe";
import { reloadTotalsOf, useTotals } from "./hooks.ts";
import { deploymentsOf, type FundingDeployment, type FundingProject, monthlyCapAt } from "./project.schema.ts";
import { periodOf } from "./savedPlans.ts";
import { VaultActions } from "./VaultActions.tsx";
import { VaultMonthLock } from "./VaultMonthLock.tsx";
import { VaultTotals } from "./VaultTotals.tsx";

export type EscrowFundingProps = {
  /** The page's runtime, which knows the signed-in account. */
  runtime: PageRuntime;
  /** The project whose vault this is. */
  project: FundingProject;
  /** Shows only the totals, with no wallet actions or settings. */
  readOnly?: boolean;
  /** This month's pool funding facts; a withdrawal must keep what they promise. Without them a monthly pool offers deposits only. */
  pool?: PoolFacts;
  /** The project's vaults in the cached finalized pool-funding read, whose month locks the lock card and the withdrawal review use. */
  vaults?: ReadonlyArray<FundingVault>;
  /** Reads pool funding again, after a month lock or release is included. */
  reloadPool?: () => void;
};

/** The finalized totals of each vault, refreshed when they turn stale, with the last ones kept in view while a refresh runs. */
function FundingTotals({ runtime, projectId }: { runtime: TotalsRuntime; projectId: string }) {
  const read = useRead(runtime);
  const totals = useTotals(runtime, projectId);
  const rows = totals?.snapshots.map((snapshot) => <VaultTotals key={`${snapshot.network}:${snapshot.vault}`} snapshot={snapshot} />);
  return (
    <DataState status={read.state?.status ?? "Loading"} onRetry={() => reloadTotalsOf(runtime, projectId)} skeleton={rows}>
      {rows}
    </DataState>
  );
}

function sameVault(network: string, left: string, right: string): boolean {
  return network.startsWith("solana") ? left === right : left.toLowerCase() === right.toLowerCase();
}

type DeploymentProps = {
  project: FundingProject;
  deployment: FundingDeployment;
  period: string;
  account: number;
  githubId: string;
  loginHref: string;
  pool: PoolFacts | undefined;
  row: FundingVault | undefined;
  totals: TotalsRead | undefined;
  onFinalized: () => void;
  onLocked: () => void;
};

/** One registered vault's wallet actions, with its month lock card sharing the wallet connected there. */
function DeploymentFunding({ project, deployment, period, account, githubId, loginHref, pool, row, totals, onFinalized, onLocked }: DeploymentProps) {
  const [wallet, setWallet] = useState<Connection>();
  const monthlyPool = project.reward.kind === "monthly-pool";
  const pledgeSupport = row?.openPledgedGross !== undefined && row.openPledgedGross !== null;
  const snapshot = totals?.snapshots.find((shown) => shown.network === deployment.network && sameVault(deployment.network, shown.vault, deployment.vault));
  return (
    <div className="flex flex-col gap-4">
      <VaultActions project={project} deployment={deployment} period={period} account={account} loginHref={loginHref} pool={pool} pledgeSupport={pledgeSupport} onWallet={setWallet} onFinalized={onFinalized} />
      {monthlyPool && pledgeSupport && row !== undefined && snapshot !== undefined && account !== 0 ? (
        <VaultMonthLock
          project={project}
          deployment={deployment}
          period={period}
          row={row}
          free={snapshot.freeBalance === null ? null : BigInt(snapshot.freeBalance)}
          decimals={snapshot.assetDecimals}
          wallet={wallet}
          monthlyMinor={monthlyCapAt(project, periodContaining(Math.floor(Date.now() / 1000)))}
          onLocked={onLocked}
        />
      ) : null}
      {monthlyPool ? <AutomaticMonthlyPayment project={project} deployment={deployment} period={period} account={account} githubId={githubId} onFinalized={onFinalized} /> : null}
    </div>
  );
}

/** A project's vault: its finalized totals for everyone and, for a signed-in person, the wallet actions on it. */
export function EscrowFunding({ runtime, project, readOnly = false, pool, vaults, reloadPool }: EscrowFundingProps) {
  const deployments = deploymentsOf(project);
  const totals = totalsRuntime(project.id);
  const shownTotals = useTotals(totals, project.id);
  const shown = useSession(runtime);
  const address = useAddress();
  if (readOnly && deployments.length === 0) return null;
  const period = periodOf(Date.now());
  const account = shown ? viewActor(shown.view) : 0;
  const githubId = shown?.view.status === "signedIn" ? shown.view.session.githubId : "";
  const loginHref = shown ? loginHrefFor(shown, address) : "";
  const refresh = () => reloadTotalsOf(totals, project.id);
  const locked = () => {
    refresh();
    reloadPool?.();
  };
  const chain = project.escrow?.chain;
  return (
    <section className="flex flex-col gap-4" aria-label="Project escrow">
      <h2 className="flex items-center gap-2 text-xl font-semibold text-foreground">
        Project vault {chain === "base" ? <NetworkMark network="Base" showName={false} /> : chain === "solana" ? <NetworkMark network="Solana" showName={false} /> : null}
      </h2>
      {deployments.length === 0 ? (
        <Alert variant="warn" announcement="Polite">
          No vault yet. Payments are not guaranteed.
        </Alert>
      ) : (
        <>
          <FundingTotals runtime={totals} projectId={project.id} />
          {readOnly
            ? null
            : deployments.map((deployment) => (
                <DeploymentFunding
                  key={`${deployment.network}:${deployment.vault}`}
                  project={project}
                  deployment={deployment}
                  period={period}
                  account={account}
                  githubId={githubId}
                  loginHref={loginHref}
                  pool={pool}
                  row={vaults?.find((vault) => vault.network === deployment.network && sameVault(deployment.network, vault.vault, deployment.vault))}
                  totals={shownTotals}
                  onFinalized={refresh}
                  onLocked={locked}
                />
              ))}
        </>
      )}
    </section>
  );
}
