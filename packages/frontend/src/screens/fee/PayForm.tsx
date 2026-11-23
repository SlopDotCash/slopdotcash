// spec/frontend/feePages.md, "The wallet is asked only after a fresh read shows the same amount due, from one saved attempt per item"; spec/frontend/feePages.md, "A deposit is received at canonical inclusion and finished only at finality, and a deposit from the tab blocks another for an hour"; spec/frontend/feePages.md, "Nothing is offered while the deposit is switched off, and a recorded deposit is still shown"
import { Address, Alert, Button, ExternalLink, RadioGroup, Spinner, WalletChooser } from "@repo/ui";
import { canConfirmUnsent, canDisconnectWallet, depositedWithinHour, payer, type PayFlow } from "../../../gen/frontend__feePages.ts";
import { networkLabel } from "../../kernels/assetText.ts";
import { transactionUrl } from "../../kernels/explorers.ts";
import { amountText, keptToText, wayKey } from "../../wallets/fee/feeCalls.ts";
import { PendingCheck } from "../funding/vault/PendingCheck.tsx";
import { formatDate } from "../projects/summary.ts";
import type { FeePay, FeeShown, Noun, ShownRecord } from "./payFlow.vibe";
import { useView } from "../account/useView.ts";
import { type FeeRuntime, watchOffers } from "./runtime.vibe";
import { useAct } from "./usePay.ts";

const words = {
  "pull request": { label: "Pay the fee", uncounted: "it did not pay this pull request" },
  report: { label: "Pay the deposit", uncounted: "it did not count for this report" },
} as const;

const section = "flex flex-col gap-3";
const heading = "text-xl font-semibold text-foreground";

export function TransactionLink({ network, hash, label }: { network: string; hash: string; label: string }) {
  const href = transactionUrl(network, hash);
  return href ? <ExternalLink href={href}>{label}</ExternalLink> : <code className="break-all font-mono text-sm">{hash}</code>;
}

function outcomeText(record: ShownRecord, held: string): string {
  const slop = record.paid?.kind === "slop";
  if (record.outcome === "refunded") return "The deposit was sent back to the wallet that paid it.";
  if (record.outcome === "kept") return slop ? "The deposit was kept: the SLOP was sent to the burn address." : "The deposit was kept: it was sent to Slop's fee wallet.";
  if (record.outcome === "refund_due") return "The deposit is due back to the wallet that paid it. Slop sends it once the deposit's block is final.";
  if (record.outcome === "kept_due")
    return slop
      ? "The deposit is to be kept: the SLOP will be sent to the burn address once the deposit's block is final."
      : "The deposit is to be kept: it will be sent to Slop's fee wallet once the deposit's block is final.";
  return held;
}

export function PaidRecord({ record, held }: { record: ShownRecord; held: string }) {
  const paid = record.paid;
  if (!paid) return null;
  const network = networkLabel(paid.network);
  return (
    <section aria-label="Payment recorded" className={section}>
      <h2 className={heading}>Paid</h2>
      <p className="text-muted-foreground">
        {amountText(paid)} on {network}, recorded {formatDate(paid.at)} as deposit {paid.depositId}.{" "}
        {paid.finalized ? "Its block is final." : `Its block is not final yet. ${network} can still replace it, and the record follows the chain.`}
      </p>
      <p>
        <TransactionLink network={paid.network} hash={paid.transaction} label="Deposit transaction" />
      </p>
      <p className="text-muted-foreground">{outcomeText(record, held)}</p>
      {record.resolveTransaction ? (
        <p>
          <TransactionLink network={paid.network} hash={record.resolveTransaction} label={record.outcome === "kept" ? "Kept transaction" : "Refund transaction"} />
        </p>
      ) : null}
    </section>
  );
}

export function RecordState({ state, shown, loading, onRetry }: { state: PayFlow | undefined; shown: FeeShown | undefined; loading: string; onRetry: () => void }) {
  if (state?.page === "Failed")
    return (
      <Alert variant="destructive" action={<Button variant="secondary" onClick={onRetry}>Try again</Button>}>
        {shown?.message}
      </Alert>
    );
  if (state === undefined || state.page === "Loading") return <Spinner label={loading} />;
  return shown?.refreshFailed ? <p role="status" className="text-muted-foreground">The record could not be read again just now. The last one read is shown.</p> : null;
}

function pendingOf(state: PayFlow): boolean {
  return state.phase === "Awaiting" || state.phase === "Sent" || state.phase === "Unclear";
}

function sendLabel(facts: { batch: boolean; resetAllowance: boolean; approvalNeeded: boolean }): string {
  if (facts.batch) return "Approve and deposit in wallet";
  if (facts.resetAllowance) return "Reset token allowance in wallet";
  return facts.approvalNeeded ? "Approve exact token amount in wallet" : "Confirm deposit in wallet";
}

export function PayForm({ runtime, pay, state, shown, noun }: { runtime: FeeRuntime; pay: FeePay; state: PayFlow; shown: FeeShown; noun: Noun }) {
  const { busy, error, act } = useAct(runtime);
  const offers = useView(runtime, watchOffers) ?? [];
  const ways = shown.record?.due ?? [];
  const pending = pendingOf(state);
  const awaiting = shown.deposited !== undefined && ways.length > 0 && depositedWithinHour(state);
  const wallet = shown.wallet;
  const way = ways.find((entry) => wayKey(entry) === shown.chosen) ?? ways[0];
  const reviewed = shown.reviewed;
  const saved = shown.saved;
  const shownError = error || shown.error;
  const savedHash = saved?.step === "batch" ? saved.transaction : state.slot.hash !== "" ? state.slot.hash : state.slot.candidate;
  return (
    <section aria-label={words[noun].label} className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <h2 className={heading}>Pay from a wallet</h2>
      {shownError ? <Alert variant="destructive">{shownError}</Alert> : null}
      {shown.notice ? <p role="status" className="break-words text-sm text-foreground">{shown.notice}</p> : null}
      {shown.unreadable ? (
        <Button variant="secondary" disabled={busy} onClick={() => void act(pay.clearUnreadable())}>
          I checked wallet activity; clear the unreadable local record
        </Button>
      ) : null}
      {shown.deposited && ways.length > 0 && !awaiting ? (
        <p className="text-muted-foreground">
          Slop did not record this tab's earlier deposit within an hour, so {words[noun].uncounted}. A deposit that does not count is sent back to the wallet that paid it.
        </p>
      ) : null}
      {pending || (ways.length > 0 && !awaiting) ? (
        <WalletChooser
          legend={pending ? "Reconnect to check this transaction" : "Choose a wallet"}
          wallets={offers.filter((offer) => offer.family === "evm").map((offer) => ({ id: String(offer.id), name: offer.name, icon: offer.icon }))}
          address={wallet?.address}
          disabled={busy || shown.unreadable}
          onConnect={(option) => void act(pay.connect(Number(option.id)))}
        />
      ) : null}
      {pending && saved ? (
        <PendingCheck
          action={saved.step === "send" || saved.step === "batch" ? "Deposit" : "Token approval"}
          amount={`${amountText(saved.way)} on ${networkLabel(saved.way.network)}`}
          hash={savedHash || undefined}
          explorerUrl={savedHash ? transactionUrl(saved.way.network, savedHash) : undefined}
          canCheck={wallet !== undefined}
          busy={busy}
          onCheck={() => void act(pay.check(""))}
          onEnterHash={state.phase === "Unclear" ? (candidate) => void act(pay.check(candidate)) : undefined}
          onConfirmUnsent={canConfirmUnsent(state, payer) ? () => void act(pay.clearUnsent()) : undefined}
        />
      ) : awaiting && shown.deposited ? (
        <p className="text-muted-foreground">
          The deposit from this browser tab is final on chain, and Slop has not recorded it yet. That usually takes a few minutes, and this page reads the record again by itself. Do not pay again.{" "}
          <TransactionLink network={shown.deposited.network} hash={shown.deposited.hash} label="Deposit transaction" />
        </p>
      ) : wallet && way && !shown.unreadable ? (
        <div className="flex flex-col gap-4">
          <RadioGroup
            legend="Pay with"
            value={wayKey(way)}
            disabled={busy}
            options={ways.map((entry) => ({ value: wayKey(entry), label: `${amountText(entry)} on ${networkLabel(entry.network)}` }))}
            onValueChange={(key) => void act(pay.choose(key))}
          />
          <div>
            <Button variant="secondary" loading={busy} onClick={() => void act(pay.review())}>
              Review deposit
            </Button>
          </div>
          {reviewed ? (
            <section aria-label="Review deposit" className="flex flex-col gap-3">
              <dl className="grid gap-2 text-sm sm:grid-cols-[max-content_1fr]">
                <dt className="text-muted-foreground">Amount</dt>
                <dd>{amountText(reviewed.way)}</dd>
                <dt className="text-muted-foreground">Network</dt>
                <dd>{networkLabel(reviewed.way.network)}</dd>
                <dt className="text-muted-foreground">Deposit contract</dt>
                <dd><Address value={reviewed.way.contract} label="Deposit contract" /></dd>
                <dt className="text-muted-foreground">Token</dt>
                <dd><Address value={reviewed.way.token} label="Token" /></dd>
                <dt className="text-muted-foreground">If kept, it goes to</dt>
                <dd>
                  {keptToText(reviewed.way.kind)} <Address value={reviewed.way.keptTo} label="Kept to" />
                </dd>
                <dt className="text-muted-foreground">Refund goes to</dt>
                <dd><Address value={wallet.address} label="Refund to" /></dd>
              </dl>
              {reviewed.facts.resetAllowance && !reviewed.facts.batch ? <p className="text-muted-foreground">Reset the existing token allowance to zero first.</p> : null}
              <div>
                <Button loading={busy} disabled={state.phase !== "Reviewed"} onClick={() => void act(pay.pay())}>
                  {sendLabel(reviewed.facts)}
                </Button>
              </div>
            </section>
          ) : null}
          {canDisconnectWallet(state, payer) ? (
            <Button variant="ghost" className="self-start" disabled={busy} onClick={() => void act(pay.disconnect())}>
              Choose another wallet
            </Button>
          ) : null}
        </div>
      ) : null}
      {busy ? <p role="status" className="text-sm text-muted-foreground">Waiting for wallet or chain response…</p> : null}
    </section>
  );
}
