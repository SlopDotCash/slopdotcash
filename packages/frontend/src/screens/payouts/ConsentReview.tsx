// spec/backend/bindingConsent.md, "EVM consent names one registered deployment, the authorized claim and an expected version"; spec/frontend/walletConsent.md, "Replacing a saved wallet needs an explicit choice"; spec/frontend/walletConsent.md, "The prepared and signed bytes must equal the server's message before posting"
import { type Chain, isNetworkKey, NETWORKS } from "@repo/settlement/kernels/networks";
import { Address, Alert, Button, DialogTitle, NetworkMark, Status, type WalletOption } from "@repo/ui";
import { ArrowDown, ShieldCheck, Vault, Wallet } from "lucide-react";
import { CHAIN_NAMES, networkLabel } from "../../kernels/assetText.ts";

export type ConsentFamily = "evm" | "solana";

export type ConsentReviewProps = {
  /** The reserved payout whose vault the consent binds. */
  payout: { readonly chain: Chain; readonly network: string; readonly vault: string };
  /** The family of the payout's network. */
  family: ConsentFamily;
  /** The authorized claim's address: the only wallet this consent binds. */
  claimAddress: string;
  /** The wallets the browser offers that can sign this consent. */
  wallets: ReadonlyArray<WalletOption>;
  /** Why the last step stopped. */
  problem: string;
  /** A wallet or server answer is awaited. */
  busy: boolean;
  /** Connects the chosen wallet and signs the consent with it. */
  onSign: (wallet: WalletOption) => void;
  /** Leaves without signing. */
  onCancel: () => void;
};

/** @throws {never} */
function testNetwork(network: string): boolean {
  return isNetworkKey(network) && NETWORKS[network].testnet;
}

/** The payout consent before the signature prompt: which vault pays which address, then the wallet that signs. */
export function ConsentReview({ payout, family, claimAddress, wallets, problem, busy, onSign, onCancel }: ConsentReviewProps) {
  const name = networkLabel(payout.network);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <NetworkMark network={CHAIN_NAMES[payout.chain]} showName={false} role="img" aria-label={name} title={name} />
        <DialogTitle>Authorize payout wallet</DialogTitle>
        {testNetwork(payout.network) ? <Status presentation={{ tone: "Caution", icon: "Alert", label: name }} /> : null}
      </div>
      <dl className="flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          <dt className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Vault aria-hidden className="size-4 shrink-0" />
            Vault
          </dt>
          <dd>
            <Address value={payout.vault} label="Vault" copyLabel="Copy vault address" />
          </dd>
        </div>
        <ArrowDown aria-hidden className="size-4 text-muted-foreground" />
        <div className="flex flex-col gap-1">
          <dt className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Wallet aria-hidden className="size-4 shrink-0" />
            Your wallet
          </dt>
          <dd>
            <Address value={claimAddress} label="Your wallet" copyLabel="Copy your wallet address" />
          </dd>
        </div>
      </dl>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <ShieldCheck aria-hidden className="size-4 shrink-0" />
        {family === "evm" ? "No funds move" : "No funds move · no gas"}
      </p>
      <div className="flex flex-col gap-2">
        {wallets.map((wallet) => (
          <Button key={wallet.id} variant="secondary" disabled={busy} onClick={() => onSign(wallet)}>
            {wallet.icon ? <img src={wallet.icon} alt="" width={32} height={32} className="size-8 shrink-0" /> : <Wallet aria-hidden className="size-6" />}
            {busy ? "Confirm in your wallet…" : `Sign with ${wallet.name}`}
          </Button>
        ))}
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {problem ? <Alert variant="destructive">{problem}</Alert> : null}
    </div>
  );
}
