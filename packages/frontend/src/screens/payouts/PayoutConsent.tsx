// spec/settlement/payment.md, "A destination requires the current account and wallet consent"; spec/backend/bindingConsent.md, "EVM consent names one registered deployment, the authorized claim and an expected version"; spec/frontend/walletConsent.md, "Posting names the expected account; a 401 asks to sign in again, and closing discards late replies"
import type { AccountPayment, AccountWallet, PaymentsAccount } from "@repo/settlement/client";
import { chainFamily, isNetworkKey } from "@repo/settlement/kernels/networks";
import { Button, Dialog, DialogContent, type WalletOption } from "@repo/ui";
import { type Effect, Exit } from "effect";
import { useState } from "react";
import type { PageRuntime } from "../../app/runtime.vibe";
import type { AccessLost } from "../../wallets/core/binding.vibe";
import { keptMessage } from "../../wallets/core/registration.vibe";
import { ConsentReview } from "./ConsentReview.tsx";
import { useFeed } from "./feed.ts";
import { authorize, type BindingView, type ConsentRuntime, type ConsentServices, closeConsent, consentRuntime, decideReplacement, openConsent, reservedPayment, signConnected, watchOffers } from "./payoutDesk.vibe";

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
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<BindingView | undefined>(undefined);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");

  const settle = async <E,>(work: Effect.Effect<BindingView, E, ConsentServices>) => {
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
    setView(next);
    setProblem(next.problem);
  };

  const begin = () => {
    setOpen(true);
    void settle(openConsent(reserved, account.githubUserId, account.wallets));
  };
  const dismiss = () => {
    if (busy) return;
    setOpen(false);
    setProblem("");
    void consent.runPromiseExit(closeConsent());
  };

  if (notice) return <p role="status" className="max-w-sm text-sm">{notice}</p>;
  return (
    <>
      {wallets.length === 0 ? (
        <Button asChild variant="secondary" size="sm">
          <a href="/account#wallets">Authorize payout wallet</a>
        </Button>
      ) : (
        <Button variant="secondary" size="sm" onClick={begin}>
          Authorize payout wallet
        </Button>
      )}
      <Dialog open={open} onOpenChange={(next) => (next ? undefined : dismiss())}>
        <DialogContent>
          <ConsentReview
            payout={payment}
            family={family}
            claimAddress={claim.address}
            wallets={wallets}
            phase={view?.consent.phase ?? "Closed"}
            walletAccount={view?.consent.walletAccount ?? ""}
            problem={problem}
            notice={view?.consent.phase === "KeptSaved" ? keptMessage(family) : (view?.notice ?? "")}
            busy={busy}
            onSign={(wallet) => void settle(authorize(reserved, account.githubUserId, account.wallets, Number(wallet.id)))}
            onReplace={(replace) => void settle(decideReplacement(replace))}
            onContinue={() => void settle(signConnected())}
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
