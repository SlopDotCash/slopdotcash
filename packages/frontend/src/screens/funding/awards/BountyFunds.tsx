// spec/frontend/ownerMonthly.md, "The funds view is loading, error or ready for the current owner only"; spec/security/program.md, "Funding state comes only from a fresh finalized bounty-vault snapshot"; spec/settlement/escrow.md, "A vault starts empty with an immutable network, asset, purpose, owner and fee recipient"
import { formatBaseUnits } from "@repo/settlement/kernels/amounts";
import { Alert, Button, Metric, MetricGrid, Spinner, Status } from "@repo/ui";
import { RefreshCw } from "lucide-react";
import { lazy, type ReactNode, Suspense, useState } from "react";
import { formatDateTime } from "../../../app/format.ts";
import { assetSymbol } from "../../../kernels/assetText.ts";
import { type BountyFunds as Funds, bountyFundsRuntime, readBountyFunds, setupMessages } from "../../../wallets/owner/vaultSetup.vibe";
import { useSettled } from "../vault/hooks.ts";
import { periodOf } from "../vault/savedPlans.ts";
import { type BountyProject, bountyFundingOf } from "./bounty.schema.ts";

const VaultActions = lazy(() => import("../vault/VaultActions.tsx").then((module) => ({ default: module.VaultActions })));

export type BountyFundsViewProps = {
  read: { readonly status: "running" } | { readonly status: "failed"; readonly message: string } | { readonly status: "done"; readonly value: Funds };
  last?: Funds;
  vaults?: ReactNode;
  onRefresh: () => void;
};

/** @throws {never} */
function available(funds: NonNullable<Funds["funds"]>): string {
  const symbol = assetSymbol({ kind: "token", symbol: funds.currency }) ?? funds.currency;
  try {
    return `${formatBaseUnits({ value: BigInt(funds.availableMinor), decimals: funds.decimals })} ${symbol}`;
  } catch {
    return `${funds.availableMinor} ${symbol}`;
  }
}

export function BountyFundsView({ read, last, vaults, onRefresh }: BountyFundsViewProps) {
  const shown = read.status === "done" ? read.value : last;
  const stale = read.status === "failed" && last !== undefined;
  return (
    <section aria-label="Bounty funds" className="flex flex-col gap-3">
      {read.status === "running" && shown === undefined ? <Spinner label="Loading bounty funds" /> : null}
      {read.status === "failed" && !stale ? <Alert variant="destructive">{read.message}</Alert> : null}
      {shown === undefined ? null : (
        <>
          {stale ? (
            <p role="alert">
              <Status title={read.message} presentation={{ tone: "Notice", icon: "Alert", label: "Stale" }} />
              <span className="sr-only">{read.message}</span>
            </p>
          ) : !shown.canSetup ? (
            <p>
              <Status presentation={{ tone: "Negative", icon: "Lock", label: "Restricted" }} />
            </p>
          ) : null}
          {shown.funds ? (
            <MetricGrid>
              <Metric label="Available" value={available(shown.funds)} detail={`as of ${formatDateTime(shown.funds.snapshotAt)}`} tone={stale ? "Notice" : undefined} />
            </MetricGrid>
          ) : (
            <p className="text-sm text-muted-foreground">No balance yet</p>
          )}
          {vaults}
        </>
      )}
      <Button variant="secondary" size="icon" className="self-start" aria-label="Refresh bounty funds" title="Refresh bounty funds" disabled={read.status === "running"} onClick={onRefresh}>
        <RefreshCw aria-hidden="true" className="size-4" />
      </Button>
    </section>
  );
}

export type BountyFundsProps = {
  project: BountyProject;
  account: number;
  githubId: string;
};

export function BountyFunds({ project, account, githubId }: BountyFundsProps) {
  const runtime = bountyFundsRuntime(project.id);
  const [reload, setReload] = useState(0);
  const [last, setLast] = useState<{ readonly account: number; readonly funds: Funds }>();
  const settled = useSettled(runtime, `bounty-funds:${account}:${reload}`, () => readBountyFunds(account, githubId));
  const read: BountyFundsViewProps["read"] =
    settled.status === "running" ? settled : settled.status === "failed" ? settled : settled.value === undefined ? { status: "failed", message: setupMessages.bountyFunds } : { status: "done", value: settled.value };
  if (read.status === "done" && (last?.account !== account || read.value !== last.funds)) setLast({ account, funds: read.value });
  const kept = last?.account === account ? last.funds : undefined;
  const shown = read.status === "done" ? read.value : kept;
  const canDeposit = read.status !== "failed" && shown?.canSetup === true;
  const refresh = () => setReload((count) => count + 1);
  const funding = bountyFundingOf(project);
  const period = periodOf(Date.now());
  const vaults = (project.securityBounty.settlement?.deployments ?? []).map((deployment) => (
    <Suspense key={`${deployment.network}:${deployment.vault}`} fallback={<Spinner size="sm" label="Loading the funding form" />}>
      <VaultActions project={funding} deployment={deployment} period={period} account={account} payoutPolicy="security-bounty" canDeposit={canDeposit} onFinalized={refresh} />
    </Suspense>
  ));
  return <BountyFundsView read={read} last={kept} vaults={vaults} onRefresh={refresh} />;
}
