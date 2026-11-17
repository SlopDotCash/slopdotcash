// spec/settlement/contributorAllocation.md, "An unpublished distribution exposes no recipient row"; spec/settlement/contributorAllocation.md, "A timely first wallet confirmation survives replacement"; spec/settlement/contributorAllocation.md, "Only the owner sender records the single transaction"; spec/frontend/presentation.md, "Project tokens have one dollar prefix while native and approved stablecoin tickers have none"
import { Alert, Button } from "@repo/ui";
import { formatDateTime } from "../../app/format.ts";
import { assetSymbol, CHAIN_NAMES } from "../../kernels/assetText.ts";
import { transactionUrl } from "../../kernels/explorers.ts";
import type { AllocationShown } from "./payoutDesk.vibe";
import { PayoutRow } from "./PayoutRow.tsx";
import { allocationStatus, allocationTitles } from "./status.ts";

export type ContributorAllocationRowProps = {
  /** The signed-in account's row of the published allocation; absent when it has none. */
  shown?: AllocationShown;
  /** The published allocation could not be read. */
  failed?: boolean;
  /** Reads the published allocation again. */
  onRetry?: () => void;
};

/** The signed-in account's row of the published contributor token allocation, and the deadline to confirm a wallet for it. */
export function ContributorAllocationRow({ shown, failed = false, onRetry }: ContributorAllocationRowProps) {
  if (failed)
    return (
      <Alert variant="destructive" action={onRetry ? <Button variant="outline" size="sm" onClick={onRetry}>Retry</Button> : null}>
        The contributor allocation could not load.
      </Alert>
    );
  if (!shown) return null;
  const { allocation, recipient, state } = shown;
  return (
    <section aria-labelledby="contributor-allocation-heading" className="flex flex-col gap-2">
      <h2 id="contributor-allocation-heading" className="text-xl font-semibold text-foreground">
        Contributor allocation
      </h2>
      <ul aria-labelledby="contributor-allocation-heading">
        <PayoutRow
          network={allocation.network}
          amount={{ amount: recipient.amountBase, decimals: allocation.token.decimals, symbol: assetSymbol({ kind: "token", symbol: allocation.token.symbol }) }}
          status={allocationStatus[state]}
          statusTitle={allocationTitles[state]}
          explorerUrl={transactionUrl(allocation.network, recipient.transactionId)}
          explorerLabel="View transfer"
        />
      </ul>
      {state === "awaiting-wallet" ? (
        <p className="text-sm">
          <a href="/account#wallets" className="text-primary underline underline-offset-4 hover:decoration-2">
            Add or confirm your {CHAIN_NAMES[allocation.chain]} wallet
          </a>{" "}
          by {formatDateTime(allocation.registrationClosesAt)}.
        </p>
      ) : null}
    </section>
  );
}
