// spec/frontend/directBountyPrompt.md, "A wallet prompt starts only after an atomic storage write owns its nonce"; spec/frontend/directBountyPrompt.md, "A late wallet result updates only the prompt that still owns the stored entry"; spec/frontend/directBountyPrompt.md, "Verification candidates merge atomically with current storage"; spec/frontend/directBountyPrompt.md, "Storage keeps the other leg and never grants settlement authority"; spec/settlement/directBounty.md, "Each finalized transaction belongs to one ledger and one exact request"
import { Alert, Button, Field, Input, Spinner, Status, TokenAmount, TransactionStatus, WalletChooser, type WalletOption } from "@repo/ui";
import { Effect, Exit } from "effect";
import { useState } from "react";
import { type Slot, view } from "../../../../gen/frontend__directBountyPrompt.ts";
import { useMachine } from "../../../../gen/frontend__directBountyPrompt.react.ts";
import type { Attempt } from "../../../../gen/frontend__walletAttempt.ts";
import { transactionUrl } from "../../../kernels/explorers.ts";
import type { DirectFormView } from "../../../wallets/bounty/directPrompt.vibe";
import { isEvmHash } from "../../../wallets/bounty/records.ts";
import type { EvmConnection } from "../../../wallets/core/evm.vibe";
import { useView } from "../../account/useView.ts";
import { useMounted } from "../program/hooks.ts";
import type { SecurityCase } from "../cases/case.schema.ts";
import type { PaymentHold } from "../cases/CaseDetail.tsx";
import { act, useAction } from "./hooks.ts";
import { ActionOutcome, type Outcome, type SendState, paymentNotices, sendPresentations } from "./parts.tsx";
import { type PaymentsRuntime, checkDirect, connectDirect, departDirect, openCancellationPayment, openEvmPayment, sendDirect, watchOffers } from "./payments.vibe";

export type DirectLeg = {
  slot: Slot;
  /** What this leg pays: the researcher's share, Slop's fee or the cancellation. */
  name: string;
  /** The exact amount of this leg, already formatted, when the request names one. */
  amount?: string;
  symbol?: string;
  saved: Attempt;
  mismatched: boolean;
};

export type DirectBountyPaymentProps = Outcome & {
  cancellation: boolean;
  network: string;
  legs: readonly DirectLeg[];
  /** Transactions the case already counts as finalized. */
  confirmed: readonly string[];
  unsent: number;
  uncertain: boolean;
  mismatched: boolean;
  wallets: readonly WalletOption[];
  /** The connected payer wallet. */
  address?: string;
  busy: boolean;
  /** Hashes typed by the payer, by leg. */
  hashes: Partial<Record<Slot, string>>;
  onConnect: (wallet: WalletOption) => void;
  onSend: () => void;
  onHash: (slot: Slot, value: string) => void;
  onCheck: () => void;
  onRefresh: () => void;
};

function shownHash(leg: DirectLeg, typed: string | undefined): string {
  return typed ?? (leg.saved.candidate !== "" ? leg.saved.candidate : leg.saved.hash);
}

function sendState(leg: DirectLeg, confirmed: readonly string[]): SendState {
  const hash = leg.saved.candidate !== "" ? leg.saved.candidate : leg.saved.hash;
  if (hash !== "" && confirmed.some((id) => id.toLowerCase() === hash.toLowerCase())) return "finalized";
  if (hash !== "") return "submitted";
  return leg.saved.identity === "" ? "unsent" : "uncertain";
}

/**
 * The payer's own wallet pays each leg of an approved direct award once. Each prompt is saved before the wallet opens;
 * an uncertain result is never sent again and waits for its hash. A hash is only a candidate the case verifies.
 * @model spec/frontend/directBountyPrompt.md
 */
export function DirectBountyPayment({ cancellation, network, legs, confirmed, unsent, uncertain, mismatched, wallets, address, busy, hashes, error, stale, onConnect, onSend, onHash, onCheck, onRefresh }: DirectBountyPaymentProps) {
  const checkable = legs.some((leg) => !leg.mismatched && isEvmHash(shownHash(leg, hashes[leg.slot]).trim()));
  return (
    <section aria-label={cancellation ? "Cancel superseded transfer" : "Pay from your wallet"} className="flex flex-col gap-4">
      <WalletChooser legend="Payment wallet" wallets={wallets} address={address} addressLabel="Payment wallet" disabled={busy} onConnect={onConnect} />
      <ul className="flex flex-col gap-3">
        {legs.map((leg) => {
          const state = sendState(leg, confirmed);
          const hash = leg.saved.candidate !== "" ? leg.saved.candidate : leg.saved.hash;
          return (
            <li key={leg.slot} className="flex flex-col gap-2">
              <span className="text-sm font-medium text-muted-foreground">{leg.name}</span>
              {leg.amount ? <TokenAmount value={leg.amount} symbol={leg.symbol} label={`${leg.name} amount`} /> : null}
              <TransactionStatus presentation={sendPresentations[state]} hash={hash === "" ? undefined : hash} explorerUrl={hash === "" ? undefined : transactionUrl(network, hash)} />
              {leg.saved.identity !== "" || hash !== "" ? (
                <Field label="Transaction hash">
                  <Input value={shownHash(leg, hashes[leg.slot])} spellCheck={false} disabled={busy} onChange={(event) => onHash(leg.slot, event.target.value)} />
                </Field>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-2">
        {unsent > 0 ? (
          <Button loading={busy} disabled={address === undefined || uncertain || mismatched} onClick={onSend}>
            {cancellation ? "Cancel old transfer" : "Pay remaining transfers"}
          </Button>
        ) : null}
        {checkable ? (
          <Button variant="secondary" disabled={busy || mismatched} onClick={onCheck}>
            {cancellation ? "Verify cancellation" : "Verify submitted payments"}
          </Button>
        ) : null}
      </div>
      {uncertain ? (
        <p role="status">
          <Status presentation={{ tone: "Caution", icon: "Alert", label: "Unknown result: paste hash" }} />
        </p>
      ) : null}
      {mismatched ? <Alert variant="destructive">Payment mismatch. Check wallet activity.</Alert> : null}
      <ActionOutcome error={error} stale={stale} onRefresh={onRefresh} />
    </section>
  );
}

export type DirectBountyPaymentSectionProps = {
  runtime: PaymentsRuntime;
  record: SecurityCase;
  cancellation: boolean;
  /** Names and exact amounts of the legs, in request order. */
  legs: readonly Pick<DirectLeg, "name" | "amount" | "symbol">[];
  hold: PaymentHold;
};

const unreadableView: DirectFormView = { legs: [], unsent: 0, uncertain: false, mismatched: true, warning: false };

type Opened = Effect.Success<ReturnType<typeof openEvmPayment>> | Effect.Success<ReturnType<typeof openCancellationPayment>>;

function OpenedPayment({ runtime, record, cancellation, legs, hold, opened }: DirectBountyPaymentSectionProps & { opened: Opened }) {
  const { state } = useMachine(opened.runtime);
  const [release] = useState(() => (node: HTMLElement | null) => (node === null ? undefined : () => void act(runtime, departDirect(opened))));
  const offers = useView(runtime, watchOffers) ?? [];
  const [wallet, setWallet] = useState<EvmConnection | null>(null);
  const [hashes, setHashes] = useState<Partial<Record<Slot, string>>>({});
  const action = useAction(() => hold.hold(null));
  const read = Effect.runSyncExit(opened.form.shown(opened.surface));
  const shown = Exit.isSuccess(read) ? read.value : unreadableView;
  const sending = state !== undefined && view(state, opened.surface).pending.identity !== "";
  const named = shown.legs.map((leg, index) => ({ ...legs[index], name: legs[index]?.name ?? "Transfer", slot: leg.slot, saved: leg.saved, mismatched: leg.mismatched }) satisfies DirectLeg);
  const inputs = () => ({ first: hashes.FirstLeg, second: hashes.SecondLeg });
  return (
    <div ref={release}>
      <DirectBountyPayment
        cancellation={cancellation}
        network={record.settlement?.network ?? ""}
        legs={named}
        confirmed={record.settlement?.confirmedTransactionIds ?? []}
        unsent={shown.unsent}
        uncertain={shown.uncertain}
        mismatched={shown.mismatched}
        wallets={offers.filter((offer) => offer.family === "evm").map((offer) => ({ id: String(offer.id), name: offer.name, icon: offer.icon }))}
        address={wallet?.address}
        busy={action.busy || sending}
        hashes={hashes}
        error={action.error}
        stale={action.stale}
        onConnect={(option) => action.run(() => act(runtime, connectDirect(opened, Number(option.id))), setWallet)}
        onSend={() => {
          if (wallet !== null) action.run(() => act(runtime, sendDirect(opened, wallet)), () => hold.hold(paymentNotices.submitted));
        }}
        onHash={(slot, value) => setHashes((prior) => ({ ...prior, [slot]: value }))}
        onCheck={() => action.run(() => act(runtime, checkDirect(opened, inputs())), () => {
          hold.hold(paymentNotices.verified);
          hold.changed();
        })}
        onRefresh={hold.changed}
      />
    </div>
  );
}

/** Opens the payer's saved journal for this case and generation, then the payment form over it. */
export function DirectBountyPaymentSection(props: DirectBountyPaymentSectionProps) {
  const { runtime, record, cancellation } = props;
  const opened = useMounted(runtime, () => (cancellation ? openCancellationPayment(record) : openEvmPayment(record)));
  if (opened.status === "running") return <Spinner size="sm" label="Checking saved payment…" />;
  if (opened.status === "failed") return <Alert variant="destructive">{opened.message}</Alert>;
  return <OpenedPayment {...props} opened={opened.value} />;
}
