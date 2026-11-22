// spec/frontend/ownerMonthly.md, "The funds view is loading, error or ready for the current owner only"; spec/security/program.md, "Funding state comes only from a fresh finalized bounty-vault snapshot"
import { formatBaseUnits } from "@repo/settlement/kernels/amounts";
import { Alert, Button, Metric, MetricGrid, Spinner, Status } from "@repo/ui";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { formatDateTime } from "../../../app/format.ts";
import { assetSymbol } from "../../../kernels/assetText.ts";
import { type BountyFunds as Funds, bountyFundsRuntime, readBountyFunds, setupMessages } from "../../../wallets/owner/vaultSetup.vibe";
import { useSettled } from "../vault/hooks.ts";

export type BountyFundsViewProps = {
  /** The private read: loading, failed with its message, or the funds the current owner may see. */
  read: { readonly status: "running" } | { readonly status: "failed"; readonly message: string } | { readonly status: "done"; readonly value: Funds };
  /** The last funds shown, kept in view while a refresh fails. */
  last?: Funds;
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

/** The private bounty vault's balance from its last finalized snapshot, for the project's current owner only. */
export function BountyFundsView({ read, last, onRefresh }: BountyFundsViewProps) {
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
        </>
      )}
      <Button variant="secondary" size="icon" className="self-start" aria-label="Refresh bounty funds" title="Refresh bounty funds" disabled={read.status === "running"} onClick={onRefresh}>
        <RefreshCw aria-hidden="true" className="size-4" />
      </Button>
    </section>
  );
}

export type BountyFundsProps = {
  /** The project whose bounty vault this is. */
  projectId: string;
  /** The signed-in account's GitHub id as a number. */
  account: number;
  /** The signed-in account's GitHub id. */
  githubId: string;
};

/** Reads the private bounty funds under the viewer's current authority and keeps the last ones while a refresh fails. */
export function BountyFunds({ projectId, account, githubId }: BountyFundsProps) {
  const runtime = bountyFundsRuntime(projectId);
  const [reload, setReload] = useState(0);
  const [last, setLast] = useState<{ readonly account: number; readonly funds: Funds }>();
  const settled = useSettled(runtime, `bounty-funds:${account}:${reload}`, () => readBountyFunds(account, githubId));
  const read: BountyFundsViewProps["read"] =
    settled.status === "running" ? settled : settled.status === "failed" ? settled : settled.value === undefined ? { status: "failed", message: setupMessages.bountyFunds } : { status: "done", value: settled.value };
  if (read.status === "done" && (last?.account !== account || read.value !== last.funds)) setLast({ account, funds: read.value });
  return <BountyFundsView read={read} last={last?.account === account ? last.funds : undefined} onRefresh={() => setReload((count) => count + 1)} />;
}
