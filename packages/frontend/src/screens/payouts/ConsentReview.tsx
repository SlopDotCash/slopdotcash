// spec/backend/bindingConsent.md, "EVM consent names one registered deployment, the authorized claim and an expected version"; spec/frontend/walletConsent.md, "Replacing a saved wallet needs an explicit choice"; spec/frontend/walletConsent.md, "The prepared and signed bytes must equal the server's message before posting"
import { PAYOUT_FEE_BASIS_POINTS } from "@repo/settlement/kernels/networks";
import { Address, Alert, Button, DialogDescription, DialogFooter, DialogTitle, Status, WalletChooser, type WalletOption } from "@repo/ui";
import { ArrowDown, ShieldCheck } from "lucide-react";
import type { Phase } from "../../../gen/frontend__walletConsent.ts";
import { networkLabel } from "../../kernels/assetText.ts";
import { familyLabels } from "../../wallets/core/registration.vibe";
import { PayoutAmount, type NetPayout, netAmountProps } from "./PayoutAmount.tsx";

export type ConsentFamily = "evm" | "solana";

export type ConsentReviewProps = {
  /** The reserved payout the consent binds to its vault. */
  payout: NetPayout & { readonly vault: string };
  /** The family of the payout's network. */
  family: ConsentFamily;
  /** The confirmed payout address, which the vault pays unless the connected wallet account replaces it. */
  claimAddress: string;
  /** The wallets the browser offers that can sign this consent. */
  wallets: ReadonlyArray<WalletOption>;
  /** Where the consent is, as its machine decided it. */
  phase: Phase;
  /** The account the connected wallet returned, which the signature binds once connected. */
  walletAccount: string;
  /** Why the last step stopped. */
  problem: string;
  /** What the last step did. */
  notice: string;
  /** A wallet or server answer is awaited. */
  busy: boolean;
  /** Connects the chosen wallet and signs the consent with it. */
  onSign: (wallet: WalletOption) => void;
  /** Answers whether to register the different wallet account. */
  onReplace: (replace: boolean) => void;
  /** Signs the consent with the wallet already connected. */
  onContinue: () => void;
  /** Leaves without signing. */
  onCancel: () => void;
};

const bindsWalletAccount: ReadonlySet<Phase> = new Set(["Connected", "Preparing", "Prepared", "Signing", "Signed", "Posting"]);

/** The payout consent before the signature prompt: which vault pays which address, the exact amount and the fee, then the wallet that signs. */
export function ConsentReview({ payout, family, claimAddress, wallets, phase, walletAccount, problem, notice, busy, onSign, onReplace, onContinue, onCancel }: ConsentReviewProps) {
  const destination = bindsWalletAccount.has(phase) && walletAccount !== "" ? walletAccount : claimAddress;
  return (
    <div className="flex flex-col gap-4">
      <DialogTitle>Authorize payout wallet</DialogTitle>
      <DialogDescription>{networkLabel(payout.network)}</DialogDescription>
      <dl className="flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          <dt className="text-sm font-medium text-foreground">Vault</dt>
          <dd>
            <Address value={payout.vault} label="Vault" copyLabel="Copy vault address" />
          </dd>
        </div>
        <ArrowDown aria-hidden className="size-4 text-muted-foreground" />
        <div className="flex flex-col gap-1">
          <dt className="text-sm font-medium text-foreground">Your wallet</dt>
          <dd>
            <Address value={destination} label="Your wallet" copyLabel="Copy your wallet address" />
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-sm font-medium text-foreground">You receive</dt>
          <dd>
            <PayoutAmount {...netAmountProps(payout, `Fee (${PAYOUT_FEE_BASIS_POINTS / 100}%)`)} />
          </dd>
        </div>
      </dl>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <ShieldCheck aria-hidden className="size-4 shrink-0" />
        {family === "evm" ? "Signing moves no funds." : "Signing moves no funds. Slop pays the network fee."}
      </p>
      {phase === "Replacing" ? (
        <section aria-labelledby="payout-consent-replace" className="flex flex-col gap-3">
          <h3 id="payout-consent-replace" className="font-semibold text-foreground">
            Register a different {familyLabels[family]} address?
          </h3>
          <p className="text-sm">Your wallet returned a different account. Nothing is registered yet.</p>
          <Address value={claimAddress} label="Saved address" copyLabel="Copy saved address" />
          <Address value={walletAccount} label="Wallet account" copyLabel="Copy wallet account" />
          <p className="text-sm">
            <strong>Your GitHub identity and this address become a public, permanent record.</strong> The earlier address stays public.
          </p>
          <DialogFooter>
            <Button disabled={busy} onClick={() => onReplace(true)}>
              Register wallet account
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => onReplace(false)}>
              Keep saved address
            </Button>
          </DialogFooter>
        </section>
      ) : phase === "Connected" ? (
        <DialogFooter>
          <Button disabled={busy} onClick={onContinue}>
            Sign consent
          </Button>
          <Button variant="secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        </DialogFooter>
      ) : (
        <>
          <WalletChooser legend="Sign with" wallets={wallets} family={family} disabled={busy} onConnect={onSign} />
          {busy ? <Status role="status" presentation={{ tone: "Neutral", icon: "Spinner", label: "Confirm in your wallet…" }} /> : null}
          <DialogFooter>
            <Button variant="secondary" disabled={busy} onClick={onCancel}>
              Cancel
            </Button>
          </DialogFooter>
        </>
      )}
      {notice ? <p role="status" className="text-sm">{notice}</p> : null}
      {problem ? <Alert variant="destructive">{problem}</Alert> : null}
    </div>
  );
}
