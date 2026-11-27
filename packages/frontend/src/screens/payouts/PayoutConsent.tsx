// spec/settlement/payment.md, "A destination requires the current account and wallet consent"; spec/backend/bindingConsent.md, "EVM consent names one registered deployment, the authorized claim and an expected version"; spec/frontend/walletConsent.md, "Replacing a saved wallet needs an explicit choice"; spec/frontend/walletConsent.md, "Posting names the expected account; a 401 asks to sign in again, and closing discards late replies"
import type { AccountPayment, AccountWallet, PaymentsAccount } from "@repo/settlement/client";
import { chainFamily, isNetworkKey } from "@repo/settlement/kernels/networks";
import { Button, Dialog, DialogContent, Status, type WalletOption } from "@repo/ui";
import { type Effect, Exit } from "effect";
import { useRef, useState } from "react";
import type { PageRuntime } from "../../app/runtime.vibe";
import type { AccessLost } from "../../wallets/core/binding.vibe";
import { ConsentReview } from "./ConsentReview.tsx";
import { useFeed } from "./feed.ts";
import { authorize, type BindingView, type ConsentRuntime, type ConsentServices, closeConsent, consentRuntime, openConsent, reservedPayment, watchOffers } from "./payoutDesk.vibe";

export type PayoutConsentProps = {
  /** The page's runtime, which knows the signed-in account. */
  runtime: PageRuntime;
  /** The signed-in account's payouts. */
  account: PaymentsAccount;
  /** The payout whose vault the consent binds. */
  payment: AccountPayment;
  /** Shows how the account was lost: signed out or changed. */
  onAccessLost: (lost: AccessLost) => void;
};

const consentFailed = "Payout consent failed. Your award stays reserved.";

type ConsentControlProps = PayoutConsentProps & { readonly claim: AccountWallet };

function ConsentControl({ runtime, account, payment, claim, onAccessLost }: ConsentControlProps) {
  const consent: ConsentRuntime = consentRuntime(runtime, account.githubUserId, claim);
  const family = chainFamily(payment.chain);
  const offers = useFeed(consent, "offers", watchOffers).value ?? [];
  const wallets: WalletOption[] = offers.filter((offer) => offer.family === family && (family !== "solana" || offer.solanaBinding)).map((offer) => ({ id: String(offer.id), name: offer.name, icon: offer.icon }));
  const reserved = reservedPayment(payment, claim);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");

  const settle = async <E,>(work: Effect.Effect<BindingView, E, ConsentServices>) => {
    if (busy) return;
    setBusy(true);
    setProblem("");
    const exit = await consent.runPromiseExit(work);
    setBusy(false);
    if (Exit.isFailure(exit)) {
      setProblem(consentFailed);
      return;
    }
    const next = exit.value;
    if (next.accessLost !== undefined) {
      setOpen(false);
      onAccessLost(next.accessLost);
      return;
    }
    if (next.consent.phase === "Accepted") {
      void consent.runPromiseExit(closeConsent());
      setOpen(false);
      setNotice(next.notice);
      return;
    }
    setProblem(next.problem);
  };

  const begin = () => {
    setOpen(true);
    void settle(openConsent(reserved, account.githubUserId));
  };
  const dismiss = () => {
    if (busy) return;
    setOpen(false);
    setProblem("");
    void consent.runPromiseExit(closeConsent());
  };

  if (notice)
    return (
      <p role="status">
        <Status presentation={{ tone: "Neutral", icon: "Clock", label: notice }} />
      </p>
    );
  return (
    <>
      {wallets.length === 0 ? (
        <Button asChild variant="secondary" size="sm">
          <a href="/account#wallets" aria-label="Authorize payout wallet">
            Authorize
          </a>
        </Button>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          aria-label="Authorize payout wallet"
          onClick={(event) => {
            triggerRef.current = event.currentTarget;
            begin();
          }}
        >
          Authorize
        </Button>
      )}
      <Dialog open={open} onOpenChange={(next) => (next ? undefined : dismiss())}>
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            triggerRef.current?.focus();
          }}
        >
          <ConsentReview
            payout={payment}
            family={family}
            claimAddress={claim.address}
            wallets={wallets}
            problem={problem}
            busy={busy}
            onSign={(wallet) => void settle(authorize(reserved, account.githubUserId, Number(wallet.id)))}
            onCancel={dismiss}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Lets the payee sign the consent that binds their confirmed wallet to the vault holding a reserved award; the award stays reserved whatever happens here. */
export function PayoutConsent(props: PayoutConsentProps) {
  const { account, payment } = props;
  const claim = account.wallets.find((wallet) => wallet.chain === payment.chain && wallet.authorized);
  if (!claim || payment.vault === "" || payment.state !== "reserved" || !isNetworkKey(payment.network)) return null;
  return <ConsentControl key={claim.claimId} {...props} claim={claim} />;
}
