// spec/frontend/projections.md, "Payouts shows only the signed-in account's allocation row, and a failed read is unavailable, never absent"; spec/frontend/projections.md, "The row is Sent with a transfer, Unclaimed after the final batch, Scheduled with a timely wallet, and otherwise Awaiting wallet until the deadline and Unclaimed from it"; spec/frontend/presentation.md, "Project tokens have one dollar prefix while native and approved stablecoin tickers have none"
import { Alert, Button } from "@repo/ui";
import { allocationPresentation } from "../../../gen/frontend__projections.ts";
import { formatDateTime } from "../../app/format.ts";
import { assetSymbol, CHAIN_NAMES } from "../../kernels/assetText.ts";
import { transactionUrl } from "../../kernels/explorers.ts";
import type { AllocationView } from "./payoutDesk.vibe";
import { PayoutRow } from "./PayoutRow.tsx";

export type ContributorAllocationRowProps = {
  /** The signed-in account's row of the published allocation; absent while it is read. */
  view?: AllocationView;
  /** Reads the published allocation again. */
  onRetry: () => void;
};

const linkClass = "text-primary underline underline-offset-4 hover:decoration-2";

/** The signed-in account's row of the published contributor token allocation and, while a wallet is awaited, where to add it by the deadline. */
export function ContributorAllocationRow({ view, onRetry }: ContributorAllocationRowProps) {
  if (view?.tag === "AllocationUnavailable")
    return (
      <Alert variant="destructive" action={<Button variant="outline" size="sm" onClick={onRetry}>Retry</Button>}>
        <p>Allocation unavailable</p>
      </Alert>
    );
  if (view?.tag !== "AllocationShown") return null;
  const { allocation, recipient } = view;
  return (
    <section aria-labelledby="contributor-allocation-heading" className="flex flex-col gap-2">
      <h2 id="contributor-allocation-heading" className="text-xl font-semibold text-foreground">
        Contributor allocation
      </h2>
      <ul aria-labelledby="contributor-allocation-heading">
        <PayoutRow
          chain={allocation.chain}
          network={allocation.network}
          amount={{ amount: recipient.amountBase, decimals: allocation.token.decimals, symbol: assetSymbol({ kind: "token", symbol: allocation.token.symbol }) }}
          status={allocationPresentation(view.display)}
          explorerUrl={view.transferLink ? transactionUrl(allocation.network, recipient.transactionId) : undefined}
          explorerLabel="View transfer"
        >
          {view.walletPrompt ? (
            <p className="text-sm">
              <a href="/account#wallets" className={linkClass}>
                Add {CHAIN_NAMES[allocation.chain]} wallet
              </a>{" "}
              · by {formatDateTime(allocation.registrationClosesAt)}
            </p>
          ) : null}
        </PayoutRow>
      </ul>
    </section>
  );
}
