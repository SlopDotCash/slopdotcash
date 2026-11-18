// spec/backend/wallets.md, "Registration appends an immutable successor or returns the current registry row"; spec/backend/wallets.md, "The server issues an expiring challenge for the exact current registry claim"; spec/frontend/presentation.md, "Settings keeps wallet and email controls expanded without account navigation tabs"; spec/frontend/walletConsent.md, "Discovery offers announced and legacy providers and refuses conflicting ones"; spec/ui/status.md, "Read states show loading, emptiness, staleness and failure differently"
import { Address, Alert, Button, Card, CardTitle, DataState, Dialog, DialogContent, DialogTitle, ExternalLink, NetworkMark, Spinner, WalletChooser } from "@repo/ui";
import { Check, Eye, Pencil, Plus, TriangleAlert, Wallet } from "lucide-react";
import { useState } from "react";
import { type Chain, NETWORKS } from "@repo/settlement/kernels/networks";
import { CHAIN_NAMES, formatAssetAmount, networkLabel } from "../../kernels/assetText.ts";
import type { Family, WalletOffer } from "../../wallets/core/discovery.vibe";
import { familyChains, familyLabels, type SavedWallet } from "../../wallets/core/registration.vibe";
import type { PaymentsAccount, WalletPanel } from "./walletPanel.vibe";

export type WalletManagementProps = {
  /** The payout wallets of the signed-in account and the state of the last wallet step. */
  panel: WalletPanel;
  /** The wallets this browser offers. */
  offers: ReadonlyArray<WalletOffer>;
  /** Where "Sign in with GitHub" goes when no account is signed in. */
  signInHref: string;
  /** Reads the payout wallets again. */
  onReload: () => void;
  /** Connects the chosen wallet and confirms its address on each chain of the family. */
  onConnect: (offer: number, family: Family) => void;
  /** Registers the different address the wallet returned. */
  onConfirmChange: () => void;
  /** Keeps the saved address and registers nothing. */
  onKeepSaved: () => void;
  /** Writes an address to the clipboard. */
  onCopy?: (text: string) => Promise<void>;
};

const families: ReadonlyArray<{ readonly id: Family; readonly article: string }> = [
  { id: "solana", article: "a" },
  { id: "evm", article: "an" },
];

const downloads: Readonly<Record<Family, ReadonlyArray<{ readonly name: string; readonly href: string }>>> = {
  evm: [
    { name: "MetaMask", href: "https://metamask.io/download" },
    { name: "Rabby", href: "https://rabby.io" },
    { name: "Coinbase Wallet", href: "https://www.coinbase.com/wallet/downloads" },
    { name: "Phantom", href: "https://phantom.com/download" },
  ],
  solana: [
    { name: "Phantom", href: "https://phantom.com/download" },
    { name: "Solflare", href: "https://solflare.com/download" },
  ],
};

const mainNetwork = (chain: Chain): string | undefined => Object.entries(NETWORKS).find(([, network]) => network.chain === chain && !network.testnet)?.[0];

function Confirmed({ ok }: { ok: boolean }) {
  return ok ? <Check role="img" aria-label="Confirmed" className="size-4 shrink-0 text-ok" /> : <TriangleAlert role="img" aria-label="Not confirmed" className="size-4 shrink-0 text-warn" />;
}

type FamilyCardProps = Pick<WalletManagementProps, "panel" | "onConfirmChange" | "onKeepSaved" | "onCopy"> & {
  account: PaymentsAccount;
  family: Family;
  onPick: () => void;
};

function FamilyCard({ account, family, panel, onPick, onConfirmChange, onKeepSaved, onCopy }: FamilyCardProps) {
  const label = familyLabels[family];
  const rows = familyChains(family).map((chain) => ({
    chain,
    wallet: account.wallets.find((wallet: SavedWallet) => wallet.chain === chain),
    unpaid: account.balances.filter((balance: PaymentsAccount["balances"][number]) => balance.chain === chain && balance.netBase !== "0"),
  }));
  const addresses = [...new Set(rows.flatMap((row) => (row.wallet ? [row.wallet.address] : [])))];
  const confirmed = addresses.length === 1 && rows.every((row) => row.wallet?.authorized === true);
  const changing = rows.some((row) => row.wallet?.authorized === true);
  const busy = panel.busy === family;
  const change = panel.change?.family === family ? panel.change : undefined;
  return (
    <Card asChild>
      <article aria-label={`${label} wallet`}>
        <div className="flex items-start gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex items-center gap-2">
              <CardTitle>{label}</CardTitle>
              {rows.map(({ chain, wallet }) => (
                <span key={chain} className="inline-flex items-center gap-0.5">
                  <NetworkMark
                    network={CHAIN_NAMES[chain]}
                    showName={false}
                    size="sm"
                    role="img"
                    aria-label={wallet ? `${CHAIN_NAMES[chain]}, ${wallet.authorized ? "confirmed" : "not confirmed"}` : CHAIN_NAMES[chain]}
                  />
                  {wallet ? wallet.authorized ? <Check aria-hidden className="size-3 text-ok" /> : <TriangleAlert aria-hidden className="size-3 text-warn" /> : null}
                </span>
              ))}
            </div>
            {addresses.length === 1 && addresses[0] !== undefined ? (
              <div className="flex items-center gap-2">
                <Address value={addresses[0]} label={`${label} wallet address`} onCopy={onCopy} />
                <Confirmed ok={confirmed} />
              </div>
            ) : rows.some((row) => row.wallet) ? (
              <ul className="flex flex-col gap-2">
                {rows.map(({ chain, wallet }) =>
                  wallet ? (
                    <li key={chain} className="flex items-center gap-2">
                      <NetworkMark network={CHAIN_NAMES[chain]} showName={false} decorative size="sm" />
                      <Address value={wallet.address} label={`${CHAIN_NAMES[chain]} wallet address`} onCopy={onCopy} />
                      <Confirmed ok={wallet.authorized} />
                    </li>
                  ) : null,
                )}
              </ul>
            ) : null}
            {rows.some((row) => row.unpaid.length > 0) ? (
              <ul className="flex flex-wrap gap-2">
                {rows.flatMap(({ chain, unpaid }) =>
                  unpaid.map((balance: PaymentsAccount["balances"][number]) => (
                    <li key={`${chain}:${balance.network}:${balance.assetAddress}`} title={`Unpaid${balance.network === mainNetwork(chain) ? "" : ` on ${networkLabel(balance.network)}`}`} className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-sm">
                      <NetworkMark network={CHAIN_NAMES[chain]} showName={false} decorative size="sm" />
                      <strong>{formatAssetAmount(BigInt(balance.netBase), balance)}</strong>
                      <span className="sr-only">unpaid on {CHAIN_NAMES[chain]}</span>
                    </li>
                  )),
                )}
              </ul>
            ) : null}
          </div>
          <Button
            variant="secondary"
            size="icon"
            loading={busy}
            disabled={panel.busy !== undefined || panel.change !== undefined}
            aria-label={busy ? "Confirm in your wallet…" : `${changing ? "Change" : "Connect"} ${label} wallet`}
            onClick={onPick}
          >
            {busy ? null : changing ? <Pencil aria-hidden className="size-4" /> : <Plus aria-hidden className="size-4" />}
          </Button>
        </div>
        {change ? (
          <section aria-labelledby={`wallet-change-${family}`} className="flex flex-col gap-3 border-t border-border pt-4">
            <h3 id={`wallet-change-${family}`} tabIndex={-1} ref={(node) => node?.focus()} className="font-semibold text-foreground">
              Change {label} address?
            </h3>
            <dl className="flex flex-col gap-2">
              <div>
                <dt className="text-sm text-muted-foreground">Saved address</dt>
                <dd>
                  <Address value={change.saved} label="Saved address" onCopy={onCopy} />
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Wallet account</dt>
                <dd>
                  <Address value={change.address} label="Wallet account" onCopy={onCopy} />
                </dd>
              </div>
            </dl>
            <p className="flex items-start gap-2">
              <Eye aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>
                <strong>Your GitHub identity and this address become public and permanent.</strong> The earlier address stays public.
              </span>
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={onConfirmChange}>Register</Button>
              <Button variant="secondary" onClick={onKeepSaved}>
                Keep saved
              </Button>
            </div>
          </section>
        ) : null}
      </article>
    </Card>
  );
}

function Downloads({ family }: { family: Family }) {
  return (
    <div className="flex flex-col gap-2">
      <p>No wallet found</p>
      <ul className="flex flex-col gap-2">
        {downloads[family].map((download) => (
          <li key={download.name}>
            <ExternalLink href={download.href} className="inline-flex items-center gap-2 text-primary underline underline-offset-4">
              <Wallet aria-hidden className="size-4" />
              {download.name}
            </ExternalLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The payout wallet of each family, its confirmation on each chain, and the way to connect or change it. */
export function WalletManagement({ panel, offers, signInHref, onReload, onConnect, onConfirmChange, onKeepSaved, onCopy }: WalletManagementProps) {
  const [picker, setPicker] = useState<Family | undefined>(undefined);
  const picking = families.find((family) => family.id === picker);
  const failure = [panel.error, panel.loadError].filter((text) => text !== "");
  const account = panel.account;
  return (
    <div className="flex flex-col gap-4">
      <Dialog open={picking !== undefined} onOpenChange={(open) => {
          if (!open) setPicker(undefined);
        }}>
        {picking ? (
          <DialogContent closeLabel="Close wallet picker">
            <DialogTitle>
              Connect {picking.article} {familyLabels[picking.id]} wallet
            </DialogTitle>
            <WalletChooser
              legend="Wallets in this browser"
              family={picking.id}
              wallets={offers.filter((offer) => offer.family === picking.id).map((offer) => ({ id: String(offer.id), name: offer.name, icon: offer.icon }))}
              empty={<Downloads family={picking.id} />}
              onConnect={(wallet) => {
                setPicker(undefined);
                onConnect(Number(wallet.id), picking.id);
              }}
            />
          </DialogContent>
        ) : null}
      </Dialog>
      {panel.loading ? <Spinner size="sm" label="Checking your payouts" /> : null}
      {panel.signedOut && !panel.loading ? (
        <Button asChild className="self-start">
          <a href={signInHref}>Sign in with GitHub</a>
        </Button>
      ) : null}
      {failure.length > 0 ? (
        <Alert
          variant="destructive"
          action={
            <Button variant="secondary" size="sm" onClick={onReload}>
              Retry
            </Button>
          }
        >
          {failure.map((text) => (
            <p key={text}>{text}</p>
          ))}
        </Alert>
      ) : null}
      {panel.message ? <p role="status">{panel.message}</p> : null}
      {account ? (
        <DataState status={failure.length > 0 ? "Stale" : "Current"}>
          <section aria-label="Payout wallets" className="flex flex-col gap-4">
            {families.map(({ id }) => (
              <FamilyCard key={id} account={account} family={id} panel={panel} onPick={() => setPicker(id)} onConfirmChange={onConfirmChange} onKeepSaved={onKeepSaved} onCopy={onCopy} />
            ))}
          </section>
        </DataState>
      ) : null}
    </div>
  );
}
