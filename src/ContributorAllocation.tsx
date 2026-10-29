import { Check, Clock, TriangleAlert, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { readBoundedJson } from "./lib/browser-json";
import {
  CONTRIBUTOR_ALLOCATION_URL,
  type ContributorAllocation,
  type ContributorAllocationState,
  contributorAllocation,
  contributorAllocationState,
} from "./lib/contributor-allocation";
import { type PaymentsAccount, transactionUrl } from "./lib/payments/contracts";
import { NETWORK_NAMES } from "./lib/reward-asset.mjs";
import { PayoutAmount, PayoutRow } from "./PayoutRows";
import { formatDateTime } from "./Presentation";

const STATUS: Record<
  ContributorAllocationState,
  Parameters<typeof PayoutRow>[0]["status"]
> = {
  sent: { label: "Sent", tone: "success", icon: Check },
  scheduled: {
    label: "Scheduled",
    title: "Scheduled for the next transfer batch",
    tone: "neutral",
    icon: Clock,
  },
  "awaiting-wallet": {
    label: "Awaiting wallet",
    tone: "warning",
    icon: Wallet,
  },
  unclaimed: { label: "Unclaimed", tone: "neutral", icon: TriangleAlert },
};

/** The signed-in account's row of the published contributor allocation, if any (PRD section 11). */
export function ContributorAllocationRow({
  account,
}: {
  account: PaymentsAccount;
}) {
  const [allocation, setAllocation] = useState<
    ContributorAllocation | null | undefined
  >(undefined);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry reloads the published file.
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    fetch(CONTRIBUTOR_ALLOCATION_URL, {
      cache: "no-cache",
      redirect: "error",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(`Allocation request ${response.status}`);
        const value = contributorAllocation(
          await readBoundedJson(response, 1_048_576, "contributor allocation"),
        );
        if (!controller.signal.aborted) setAllocation(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [revision]);
  if (error)
    return (
      <div role="alert">
        <p>The contributor allocation could not load.</p>
        <button
          className="button secondary-button button-small"
          type="button"
          onClick={() => setRevision((n) => n + 1)}
        >
          Retry
        </button>
      </div>
    );
  const recipient = allocation?.recipients.find(
    (r) => r.githubId === account.githubUserId,
  );
  if (!allocation || !recipient) return null;
  const state = contributorAllocationState(
    allocation,
    recipient,
    account.wallets,
    Date.now(),
  );
  const network = NETWORK_NAMES[allocation.chain];
  return (
    <section aria-labelledby="contributor-allocation-heading">
      <h2 id="contributor-allocation-heading">Contributor allocation</h2>
      <ul
        className="payout-rows"
        aria-labelledby="contributor-allocation-heading"
      >
        <PayoutRow
          chain={allocation.chain}
          network={allocation.network}
          amount={
            <PayoutAmount
              base={recipient.amountBase}
              decimals={allocation.token.decimals}
              symbol={allocation.token.symbol}
            />
          }
          status={STATUS[state]}
          transactionUrl={transactionUrl(
            allocation.network,
            recipient.transactionId,
          )}
          transactionLabel="View transfer"
        >
          {state === "awaiting-wallet" ? (
            <p className="payout-consent">
              <a href="/account#wallets">
                Add or confirm your {network} wallet
              </a>{" "}
              by {formatDateTime(allocation.registrationClosesAt)}.
            </p>
          ) : null}
        </PayoutRow>
      </ul>
    </section>
  );
}
