// spec/frontend/solanaBountyPrompt.md, "The wallet sends only a saved, unexpired plan"; spec/frontend/solanaBountyPrompt.md, "Verification and history recovery rechecks the account and never sends"; spec/frontend/walletAttempt.md, "A wallet prompt starts only after storage creates an empty slot"; spec/frontend/walletAttempt.md, "A late wallet reply changes only the slot that still holds its own attempt"
import { Button, Field, Input, TransactionStatus, WalletChooser, type WalletOption } from "@repo/ui";
import { useState } from "react";
import { type Phase, visible } from "../../../../gen/frontend__solanaBountyPrompt.ts";
import { useMachine } from "../../../../gen/frontend__solanaBountyPrompt.react.ts";
import type { Attempt } from "../../../../gen/frontend__walletAttempt.ts";
import { transactionUrl } from "../../../kernels/explorers.ts";
import { isSolanaSignature } from "../../../wallets/bounty/records.ts";
import type { SolanaConnection } from "../../../wallets/core/solana.vibe";
import { useView } from "../../account/useView.ts";
import type { SecurityCase } from "../cases/case.schema.ts";
import { act, useAction } from "./hooks.ts";
import { ActionOutcome, type Outcome, sendPresentations } from "./parts.tsx";
import { type PaymentsRuntime, type SolanaOpened, connectSolana, sendSolana, verifySolana, watchOffers } from "./payments.vibe";

export type SolanaBountyPaymentProps = Outcome & {
  network: string;
  phase: Phase;
  saved: Attempt;
  /** Transactions the case already counts as finalized. */
  confirmed: readonly string[];
  wallets: readonly WalletOption[];
  /** The connected payer wallet. */
  address?: string;
  busy: boolean;
  /** The signature the payer typed, if any. */
  typed?: string;
  onConnect: (wallet: WalletOption) => void;
  onSend: () => void;
  onType: (value: string) => void;
  onCheck: () => void;
  onRefresh: () => void;
};

/**
 * The payer's own Solana wallet sends the one prepared transaction of an approved award once. The attempt is saved
 * before the wallet opens; a signature is only a candidate the case verifies.
 * @model spec/frontend/solanaBountyPrompt.md
 */
export function SolanaBountyPayment({ network, phase, saved, confirmed, wallets, address, busy, typed, error, stale, notice, onConnect, onSend, onType, onCheck, onRefresh }: SolanaBountyPaymentProps) {
  const held = saved.identity !== "" || saved.hash !== "" || saved.candidate !== "";
  const kept = saved.candidate !== "" ? saved.candidate : saved.hash;
  const signature = typed ?? kept;
  const finalized = kept !== "" && confirmed.includes(kept);
  return (
    <section aria-label="Pay from your Solana wallet" className="flex flex-col gap-4">
      <WalletChooser legend="Payment wallet" family="solana" wallets={wallets} address={address} addressLabel="Payment wallet" disabled={busy} onConnect={onConnect} />
      {held ? (
        <>
          <TransactionStatus
            presentation={sendPresentations[finalized ? "finalized" : kept !== "" ? "submitted" : "uncertain"]}
            hash={kept === "" ? undefined : kept}
            hashLabel="Transaction signature"
            explorerUrl={kept === "" ? undefined : transactionUrl(network, kept)}
          />
          <Field label="Transaction signature from your wallet">
            <Input value={signature} spellCheck={false} disabled={busy} onChange={(event) => onType(event.target.value)} />
          </Field>
          <p role="status">{saved.hash !== "" ? "Submitted. Verify finalized payment." : "Wallet result uncertain. Enter its signature to continue."}</p>
        </>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {held ? null : (
          <Button loading={busy} disabled={address === undefined || phase !== "Planned"} onClick={onSend}>
            Pay approved award
          </Button>
        )}
        {held && isSolanaSignature(signature.trim()) ? (
          <Button variant="secondary" disabled={busy} onClick={onCheck}>
            Verify submitted payment
          </Button>
        ) : null}
      </div>
      <ActionOutcome error={error} stale={stale} notice={notice} onRefresh={onRefresh} />
    </section>
  );
}

export type SolanaBountyPaymentSectionProps = {
  runtime: PaymentsRuntime;
  record: SecurityCase;
  opened: SolanaOpened;
  onChanged: () => void;
};

/** The Solana payment form over the case's prepared plan, opened by the case's payment controls. */
export function SolanaBountyPaymentSection({ runtime, record, opened, onChanged }: SolanaBountyPaymentSectionProps) {
  const { state } = useMachine(opened.runtime);
  const offers = useView(runtime, watchOffers) ?? [];
  const [wallet, setWallet] = useState<SolanaConnection | null>(null);
  const [typed, setTyped] = useState<string | undefined>(undefined);
  const action = useAction();
  if (state === undefined)
    return (
      <p aria-live="polite" className="text-muted-foreground">
        Checking saved payment…
      </p>
    );
  return (
    <SolanaBountyPayment
      network={record.settlement?.network ?? ""}
      phase={state.phase}
      saved={visible(state)}
      confirmed={record.settlement?.confirmedTransactionIds ?? []}
      wallets={offers.filter((offer) => offer.family === "solana" && offer.solanaFunding).map((offer) => ({ id: String(offer.id), name: offer.name }))}
      address={wallet?.address}
      busy={action.busy || state.phase === "Awaiting" || state.phase === "Checking"}
      typed={typed}
      error={action.error}
      stale={action.stale}
      notice={action.notice}
      onConnect={(option) => action.run(() => act(runtime, connectSolana(opened, Number(option.id))), (connection) => {
        setWallet(connection);
        return null;
      })}
      onSend={() => {
        if (wallet !== null) action.run(() => act(runtime, sendSolana(opened, wallet)), () => null);
      }}
      onType={setTyped}
      onCheck={() => action.run(() => act(runtime, verifySolana(opened, typed ?? "")), (message) => {
        onChanged();
        return message;
      })}
      onRefresh={onChanged}
    />
  );
}
