// spec/frontend/solanaBountyPrompt.md, "Verification and history recovery rechecks the account and never sends"; spec/settlement/directBounty.md, "A recovered request changes only an unpaid leg after exact retirement"; spec/settlement/directBounty.md, "Paid legs and prior intent generations remain permanent"
import { Button, WalletChooser, type WalletOption } from "@repo/ui";
import { useState } from "react";
import { useView } from "../../account/useView.ts";
import type { SecurityCase } from "../cases/case.schema.ts";
import type { PaymentHold } from "../cases/CaseDetail.tsx";
import { act, useAction } from "./hooks.ts";
import { ActionOutcome, type Outcome } from "./parts.tsx";
import { type PaymentsRuntime, type RecoveryConnection, type SolanaPaymentForm, checkHistory, connectRecovery, watchOffers } from "./payments.vibe";

export type SolanaBountyRecoveryProps = Outcome & {
  wallets: readonly WalletOption[];
  /** The connected original payer wallet. */
  address?: string;
  busy: boolean;
  onConnect: (wallet: WalletOption) => void;
  onCheck: () => void;
  onRefresh: () => void;
};

/** Signs only the expired request messages the case names, so the server can read the chain's history; it never sends a transaction. */
export function SolanaBountyRecovery({ wallets, address, busy, error, stale, onConnect, onCheck, onRefresh }: SolanaBountyRecoveryProps) {
  return (
    <section aria-label="Check expired payment" className="flex flex-col gap-4">
      <p>Message signature only. Nothing is sent.</p>
      <WalletChooser legend="Original payer wallet" family="solana" wallets={wallets} address={address} addressLabel="Original payer wallet" disabled={busy} onConnect={onConnect} />
      <Button variant="secondary" className="self-start" disabled={busy || address === undefined} onClick={onCheck}>
        {busy ? "Checking…" : "Check expired payment"}
      </Button>
      <ActionOutcome error={error} stale={stale} onRefresh={onRefresh} />
    </section>
  );
}

export type SolanaBountyRecoverySectionProps = {
  runtime: PaymentsRuntime;
  record: SecurityCase;
  /** The case's Solana payment form, when one holds the expired attempt. */
  form?: SolanaPaymentForm;
  hold: PaymentHold;
};

export function SolanaBountyRecoverySection({ runtime, record, form, hold }: SolanaBountyRecoverySectionProps) {
  const offers = useView(runtime, watchOffers) ?? [];
  const [connected, setConnected] = useState<RecoveryConnection | null>(null);
  const action = useAction(() => hold.hold(null));
  return (
    <SolanaBountyRecovery
      wallets={offers.filter((offer) => offer.family === "solana").map((offer) => ({ id: String(offer.id), name: offer.name, icon: offer.icon }))}
      address={connected?.connection.address}
      busy={action.busy}
      error={action.error}
      stale={action.stale}
      onConnect={(option) => action.run(() => act(runtime, connectRecovery(record, Number(option.id))), setConnected)}
      onCheck={() => {
        if (connected !== null) action.run(() => act(runtime, checkHistory(record, connected, form)), hold.changed);
      }}
      onRefresh={hold.changed}
    />
  );
}
