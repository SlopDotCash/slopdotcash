// spec/frontend/navigation.md, "A private read belongs to the current account and navigation lifetime"; spec/frontend/projections.md, "Award, funding and settlement status are independent facts"; spec/settlement/publicRecords.md, "Disclosed direct transfers are paged and never counted as vault payments"
import type { AccountPayment, PaymentsAccount } from "@repo/settlement/client";
import { Alert, Button, PageHeader, Spinner, Status } from "@repo/ui";
import { Wallet } from "lucide-react";
import type { ReactNode } from "react";
import type { PageProps } from "../../app/pages.ts";
import type { AccessLost } from "../../wallets/core/binding.vibe";
import { loginHrefFor, useSession } from "../../app/useSession.ts";
import { payoutMessages } from "../../flows/account/payouts.vibe";
import { CHAIN_NAMES } from "../../kernels/assetText.ts";
import { transactionUrl } from "../../kernels/explorers.ts";
import { useFeed } from "./feed.ts";
import { netAmountProps } from "./PayoutAmount.tsx";
import { PayoutConsent } from "./PayoutConsent.tsx";
import { followPayouts, type PayoutsShown } from "./payoutDesk.vibe";
import { PayoutRow } from "./PayoutRow.tsx";
import { awardStatus, paymentStatus, receivedStatus, staleStatus } from "./status.ts";

const cycleMonth = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC", year: "numeric" });

/** @throws {RangeError} */
export function formatCycleMonth(period: string): string {
  return cycleMonth.format(new Date(`${period}-01T00:00:00.000Z`));
}

export type PayoutsViewProps = {
  /** The payouts are being read. */
  loading: boolean;
  /** No account is signed in. */
  signedOut: boolean;
  /** Where signing in returns to this page. */
  loginHref: string;
  /** Why the last read failed; the last verified payouts stay in view below it. */
  problem?: string;
  /** The signed-in account's last verified payouts. */
  account?: PaymentsAccount;
  /** Reads the payouts again. */
  onRetry: () => void;
  /** What the payee can do for a reserved payout. */
  consent?: (payment: AccountPayment) => ReactNode;
};

function AwardsAndPayments({ account, consent }: { account: PaymentsAccount; consent?: PayoutsViewProps["consent"] }) {
  return (
    <section aria-labelledby="payouts-payments" className="flex flex-col gap-2">
      <h2 id="payouts-payments" className="text-xl font-semibold text-foreground">
        Awards and payments
      </h2>
      {account.payments.length === 0 && account.monthlyAwards.length === 0 ? (
        <p className="text-muted-foreground">No awards yet</p>
      ) : (
        <ul aria-labelledby="payouts-payments">
          {account.monthlyAwards.map((award) => {
            const { presentation, title } = awardStatus(award);
            return (
              <PayoutRow
                key={`${award.projectId}/${award.period}`}
                chain={award.chain}
                network={award.network}
                projectId={award.projectId}
                amount={netAmountProps(award)}
                note={formatCycleMonth(award.period)}
                status={presentation}
                statusTitle={title}
              />
            );
          })}
          {account.payments.map((payment) => (
            <PayoutRow
              key={payment.id}
              chain={payment.chain}
              network={payment.network}
              projectId={payment.projectId}
              amount={netAmountProps(payment)}
              status={paymentStatus(payment)}
              statusTitle={payment.deliveryState === "needs_wallet" ? `Awaiting wallet: add or confirm your ${CHAIN_NAMES[payment.chain]} wallet` : undefined}
              statusHref={payment.deliveryState === "needs_wallet" ? "/account#wallets" : undefined}
              explorerUrl={transactionUrl(payment.network, payment.transactionId ?? payment.submittedTransactionId)}
            >
              {consent?.(payment)}
            </PayoutRow>
          ))}
        </ul>
      )}
    </section>
  );
}

function DirectTransfers({ account }: { account: PaymentsAccount }) {
  if (account.directTransfers.length === 0) return null;
  return (
    <section aria-labelledby="payouts-direct" className="flex flex-col gap-2">
      <h2 id="payouts-direct" className="text-xl font-semibold text-foreground">
        Direct transfers
      </h2>
      <ul aria-labelledby="payouts-direct">
        {account.directTransfers.map((transfer) => {
          const url = transactionUrl(transfer.network, transfer.transactionId);
          const month = formatCycleMonth(transfer.contributionMonth);
          return (
            <PayoutRow
              key={`${transfer.network}:${transfer.transactionId}`}
              chain={transfer.chain}
              network={transfer.network}
              projectId={transfer.projectId}
              amount={{ amount: transfer.amountMicro, decimals: 6, symbol: "USDC" }}
              note={url ? month : `${month} · ${transfer.transactionId}`}
              status={receivedStatus}
              explorerUrl={url}
              explorerLabel="View transfer"
            />
          );
        })}
      </ul>
    </section>
  );
}

/** The signed-in account's awards, payments, and direct transfers, each with its own state; nothing is shown as paid without finalized evidence. */
export function PayoutsView({ loading, signedOut, loginHref, problem, account, onRetry, consent }: PayoutsViewProps) {
  return (
    <main className="mx-auto flex w-full max-w-(--breakpoint-lg) flex-1 flex-col gap-6 px-4 py-8">
      <PageHeader
        title="Payouts"
        icon={<Wallet className="size-6" />}
        actions={
          <Button asChild variant="secondary" size="sm">
            <a href="/account#wallets">
              <Wallet aria-hidden className="size-4" /> Wallets
            </a>
          </Button>
        }
      />
      {loading ? <Spinner size="sm" label="Checking your payouts" /> : null}
      {signedOut && !loading ? (
        <div>
          <Button asChild>
            <a href={loginHref}>Sign in with GitHub</a>
          </Button>
        </div>
      ) : null}
      {problem ? (
        <Alert variant="destructive" action={<Button variant="outline" size="sm" onClick={onRetry}>Retry</Button>}>
          <p>{problem}</p>
        </Alert>
      ) : null}
      {account ? (
        <>
          {problem ? <Status presentation={staleStatus} className="self-start" /> : null}
          <AwardsAndPayments account={account} consent={consent} />
          <DirectTransfers account={account} />
        </>
      ) : null}
    </main>
  );
}

function lostShown(lost: AccessLost): PayoutsShown {
  return lost === "signedOut" ? { read: { kind: "signedOut" }, account: undefined } : { read: { kind: "failed", message: payoutMessages.accountChanged, accountChanged: true }, account: undefined };
}

/** The Payouts page: the signed-in account's payouts, read when the page shows them and again on Retry. */
export function PayoutsPage({ runtime }: PageProps) {
  const shown = useSession(runtime);
  const actor = shown?.view.status === "signedIn" ? shown.view.session.githubId : "";
  const feed = useFeed(runtime, `payouts:${actor}`, followPayouts);
  const read = feed.value?.read;
  const account = feed.value?.account;
  return (
    <PayoutsView
      loading={!feed.settled}
      signedOut={read?.kind === "signedOut"}
      loginHref={shown ? loginHrefFor(shown, "/earnings") : "/login"}
      problem={read?.kind === "failed" ? read.message : feed.failed ? payoutMessages.privateUnavailable : undefined}
      account={account}
      onRetry={feed.restart}
      consent={account ? (payment) => <PayoutConsent runtime={runtime} account={account} payment={payment} onAccessLost={(lost) => feed.publish(lostShown(lost))} /> : undefined}
    />
  );
}
