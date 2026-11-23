// spec/settlement/vaultSnapshots.md, "A failed refresh keeps the last totals marked stale"; spec/frontend/ownerVault.md, "Only a finalized matching result registers or counts, and failures keep the saved request"; spec/ui/status.md, "Read states show loading, emptiness, staleness and failure differently"; spec/frontend/requests.md, "Only the current request may publish its validated result"; spec/frontend/ownerVault.md, "A withdrawal that would break the month's promise is refused on Slop's pages"; spec/frontend/monthLock.md, "The card appears only once the finalized read shows pledge support"; spec/frontend/vaultLocks.md, "A vault with month locks refuses a withdrawal into its locked funds before the wallet is asked, and Slop's own guard applies only to a vault without them"; spec/frontend/projections.md, "The public page offers only a deposit, after the no-refund disclosure"; spec/frontend/projections.md, "Free funds show how many whole months of the current amount they cover"; spec/frontend/projections.md, "Story: Let anyone fund a project from its public page and see who funded"
import { fromAmount, parseBaseUnits, toAmount } from "@repo/settlement/kernels/amounts";
import { type Period, periodContaining } from "@repo/settlement/kernels/calendar";
import { Alert, DataState, NetworkMark, Spinner } from "@repo/ui";
import { Hourglass } from "lucide-react";
import { useState } from "react";
import { type Coverage, fundersView, lessThanOneMonthText, monthsCovered, type PoolFacts, publicFunding } from "../../../../gen/frontend__projections.ts";
import { useMachine as useRead } from "../../../../gen/frontend__requests.react.ts";
import type { PageRuntime } from "../../../app/runtime.vibe";
import { useAddress } from "../../../app/useAddress.ts";
import { loginHrefFor, useSession } from "../../../app/useSession.ts";
import { viewActor } from "../../../session/session.vibe";
import { formatRewardMinor, type RewardAmountAsset } from "../../../kernels/assetText.ts";
import type { FundingVault } from "../../../kernels/poolFunding.ts";
import { AutomaticMonthlyPayment } from "./AutomaticMonthlyPayment.tsx";
import { type Connection, fundersRuntime, showFunders, type TotalsRuntime, type VaultTotals as TotalsRead, totalsRuntime } from "./funding.vibe";
import { reloadTotalsOf, useSettled, useTotals } from "./hooks.ts";
import { deploymentsOf, type FundingDeployment, type FundingProject, monthlyCapAt } from "./project.schema.ts";
import { PublicVaultFunding } from "./PublicVaultFunding.tsx";
import { periodOf } from "./savedPlans.ts";
import { VaultActions } from "./VaultActions.tsx";
import { VaultFunders } from "./VaultFunders.tsx";
import { VaultMonthLock } from "./VaultMonthLock.tsx";
import { OwnerVaultSetup } from "./VaultSetup.tsx";
import { VaultTotals } from "./VaultTotals.tsx";

export type EscrowFundingProps = {
  /** The page's runtime, which knows the signed-in account. */
  runtime: PageRuntime;
  /** The project whose vault this is. */
  project: FundingProject;
  /** The public project page: the totals, what the free funds cover, a deposit for any wallet and who funded, with no owner actions or settings. */
  listing?: PublicListing;
  /** This month's pool funding facts; a withdrawal must keep what they promise. Without them a monthly pool offers deposits only. */
  pool?: PoolFacts;
  /** The project's vaults in the cached finalized pool-funding read, whose month locks the lock card and the withdrawal review use. */
  vaults?: ReadonlyArray<FundingVault>;
  /** Reads pool funding again, after a month lock or release is included. */
  reloadPool?: () => void;
  /** Reads the project again once vault setup registered its vault, with the server's notice. */
  onVaultRegistered?: (notice: string | undefined) => void;
};

export type PublicListing = {
  /** Whether the project is active; a paused project takes no deposits but still shows who funded. */
  active: boolean;
  /** The asset the monthly amount is named in. */
  rewardAsset?: RewardAmountAsset;
  /** Whether payments run on a network. */
  networkPays: (network: string) => boolean;
};

type Snapshot = TotalsRead["snapshots"][number];

function snapshotOf(snapshots: ReadonlyArray<Snapshot>, deployment: FundingDeployment): Snapshot | undefined {
  return snapshots.find((shown) => shown.network === deployment.network && sameVault(deployment.network, shown.vault, deployment.vault));
}

/** How many whole months of the month's amount the free funds of the recorded vaults on paying networks cover. @throws {never} */
export function publicCoverage(project: FundingProject, snapshots: ReadonlyArray<Snapshot>, networkPays: (network: string) => boolean, period: Period): Coverage {
  const vaults = deploymentsOf(project)
    .filter((deployment) => networkPays(deployment.network))
    .map((deployment) => {
      const text = snapshotOf(snapshots, deployment)?.freeBalance;
      const free = text === null || text === undefined ? undefined : parseBaseUnits(text);
      return { recorded: true, read: free !== undefined, free: toAmount(free ?? 0n) };
    });
  return monthsCovered(project.reward.kind === "monthly-pool", toAmount(monthlyCapAt(project, period)), vaults);
}

/** "Covers 3 months", "Covers 1 month", "Covers less than one month", or nothing without coverage. @throws {never} */
export function coverageText(coverage: Coverage): string | undefined {
  if (coverage.tag === "NoCoverage") return undefined;
  const months = fromAmount(coverage.months);
  return months === 0n ? lessThanOneMonthText : `Covers ${months} ${months === 1n ? "month" : "months"}`;
}

/** "Funded by", read beside vault counters on record and again after a finalized deposit or a retry. */
function PublicFunders({ projectId, revision }: { projectId: string; revision: number }) {
  const runtime = fundersRuntime(projectId);
  const read = useRead(runtime);
  const [attempt, setAttempt] = useState(0);
  const loaded = useSettled(runtime, `funders:${revision}:${attempt}`, () => showFunders(projectId));
  const view = fundersView(true, read.state?.status ?? "Idle");
  return <VaultFunders view={view} funders={view === "FundersListed" && loaded.status === "done" ? loaded.value : undefined} onRetry={() => setAttempt((count) => count + 1)} />;
}

/** The finalized totals of each vault, refreshed when they turn stale, with the last ones kept in view while a refresh runs. */
function FundingTotals({ runtime, projectId }: { runtime: TotalsRuntime; projectId: string }) {
  const read = useRead(runtime);
  const totals = useTotals(runtime, projectId);
  const status = read.state?.status ?? "Loading";
  const rows = totals?.snapshots.map((snapshot) => <VaultTotals key={`${snapshot.network}:${snapshot.vault}`} snapshot={snapshot} />);
  const empty = !rows?.length;
  if (status === "Loading" && empty) return <Spinner size="sm" label="Loading vault totals" />;
  const pending = (
    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <Hourglass aria-hidden="true" className="size-4" />
      Pending
    </p>
  );
  if (status === "Empty" || (status === "Current" && empty)) return pending;
  return (
    <DataState status={status} onRetry={() => reloadTotalsOf(runtime, projectId)} skeleton={rows}>
      {empty ? pending : rows}
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
  const snapshot = snapshotOf(totals?.snapshots ?? [], deployment);
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
export function EscrowFunding({ runtime, project, listing, pool, vaults, reloadPool, onVaultRegistered }: EscrowFundingProps) {
  const deployments = deploymentsOf(project);
  const totals = totalsRuntime(project.id);
  const shownTotals = useTotals(totals, project.id);
  const shown = useSession(runtime);
  const address = useAddress();
  const [revision, setRevision] = useState(0);
  const [registrationNotice, setRegistrationNotice] = useState("");
  if (listing !== undefined && deployments.length === 0) return null;
  const period = periodOf(Date.now());
  const account = shown ? viewActor(shown.view) : 0;
  const githubId = shown?.view.status === "signedIn" ? shown.view.session.githubId : "";
  const loginHref = shown ? loginHrefFor(shown, address) : "";
  const refresh = () => reloadTotalsOf(totals, project.id);
  const locked = () => {
    refresh();
    reloadPool?.();
  };
  const deposited = () => {
    refresh();
    setRevision((count) => count + 1);
  };
  const now = periodContaining(Math.floor(Date.now() / 1000));
  const snapshots = shownTotals?.snapshots ?? [];
  const covered = listing === undefined || shownTotals === undefined ? undefined : coverageText(publicCoverage(project, snapshots, listing.networkPays, now));
  const fundable =
    listing === undefined || shownTotals === undefined ? [] : deployments.filter((deployment) => publicFunding(listing.active, snapshotOf(snapshots, deployment) !== undefined, "NoSavedRequest") !== "OfferNothing");
  const chain = project.escrow?.chain;
  return (
    <section className="flex flex-col gap-4" aria-label="Project escrow">
      <h2 className="flex items-center gap-2 text-xl font-semibold text-foreground">
        Project vault {chain === "base" ? <NetworkMark network="Base" showName={false} /> : chain === "solana" ? <NetworkMark network="Solana" showName={false} /> : null}
      </h2>
      {deployments.length === 0 && account > 0 && onVaultRegistered !== undefined ? (
        <OwnerVaultSetup
          project={project}
          account={account}
          githubId={githubId}
          loginHref={loginHref}
          onRegistered={(notice) => {
            setRegistrationNotice(notice ?? "");
            onVaultRegistered(notice);
          }}
        />
      ) : deployments.length === 0 ? (
        <Alert variant="warn" announcement="Polite">
          No vault yet. Payments are not guaranteed.
        </Alert>
      ) : (
        <>
          {registrationNotice ? <Alert variant="info">{registrationNotice}</Alert> : null}
          <FundingTotals runtime={totals} projectId={project.id} />
          {listing !== undefined && covered !== undefined ? (
            <p className="text-sm text-muted-foreground">
              {covered} at {formatRewardMinor(monthlyCapAt(project, now), listing.rewardAsset)} a month
            </p>
          ) : null}
          {fundable.map((deployment) => (
            <PublicVaultFunding
              key={`fund:${deployment.network}:${deployment.vault}`}
              project={project}
              deployment={deployment}
              period={period}
              account={account}
              showNetwork={fundable.length > 1}
              onFinalized={deposited}
            />
          ))}
          {listing !== undefined && snapshots.length > 0 ? <PublicFunders projectId={project.id} revision={revision} /> : null}
          {listing !== undefined
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
