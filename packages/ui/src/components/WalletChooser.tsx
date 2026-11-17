import type { ComponentProps, ReactNode } from "react";
import { Wallet } from "lucide-react";
import { cn } from "../lib/cn.ts";
import { Address, type AddressProps } from "./Address.tsx";
import { Button } from "./Button.tsx";
import { EmptyState } from "./EmptyState.tsx";

/** A wallet the browser offers, as its discovery names it, with the image URL it announced once the owner has accepted it. */
export type WalletOption = { id: string; name: string; icon?: string };

const missing = { evm: "No wallet found. Install one, then reload.", solana: "No Solana wallet found. Install one, then reload." };

export type WalletChooserProps = Omit<ComponentProps<"fieldset">, "children" | "onCopy"> & {
  /** What connecting is for; the group's name. */
  legend: string;
  /** The wallets the browser offers for this network, in discovery order. */
  wallets: readonly WalletOption[];
  /** Asks to connect the chosen wallet; the owner keeps the wallet and signing rules. */
  onConnect: (wallet: WalletOption) => void;
  /** The connected address; shown in full in place of the choice. */
  address?: string;
  /** The network family, which names what is missing when no wallet is offered. */
  family?: keyof typeof missing;
  /** What stands in when no wallet is offered, in place of the family's default. */
  empty?: ReactNode;
  /** The connected address's accessible name. */
  addressLabel?: string;
  /** Writes the connected address to the clipboard (CopyButton). */
  onCopy?: AddressProps["onCopy"];
};

/** The choice of a browser wallet to connect, the connected address once there is one, or what is missing when there is none. */
// spec/ui/controls.md, "A disabled or busy control refuses activation and stays named"
export function WalletChooser({ legend, wallets, onConnect, address, family = "evm", empty, addressLabel = "Connected wallet", onCopy, disabled = false, className, ...props }: WalletChooserProps) {
  if (address !== undefined) return <Address value={address} label={addressLabel} onCopy={onCopy} className={className} />;
  if (!wallets.length) return empty ?? <EmptyState title={missing[family]} icon={<Wallet className="size-6" />} className={className} />;
  return (
    <fieldset className={cn("flex min-w-0 flex-col gap-2", className)} {...props}>
      <legend className="mb-2 text-sm font-medium text-foreground">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {wallets.map((wallet) => (
          <Button key={wallet.id} variant="secondary" disabled={disabled} onClick={() => onConnect(wallet)}>
            {wallet.icon ? <img src={wallet.icon} alt="" width={32} height={32} className="size-8 shrink-0" /> : <Wallet aria-hidden className="size-6" />}
            Connect {wallet.name}
          </Button>
        ))}
      </div>
    </fieldset>
  );
}
