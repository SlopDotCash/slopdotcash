import { useEffect, useRef, useState } from "react";
import { encodeBase58Bytes } from "./lib/base58";
import type { VaultConnection } from "./lib/evm-vault-actions";
import { currentProjectSession } from "./lib/project-api";
import { useAction } from "./lib/use-action";
import { type PayoutWallet, usePayoutWallets } from "./lib/use-payout-wallets";
import { NoWalletFound, WalletConnection } from "./Presentation";

type Message = { messageId: string; message: string };

/** Only signs messages the API has established are expired; never sends a transaction. */
export function SolanaBountyRecovery({
  caseId,
  generation,
  payer,
  messages,
  authorize,
  verify,
}: {
  caseId: string;
  generation: number;
  payer: string;
  messages: Message[];
  authorize: () => Promise<void>;
  verify: (
    signatures: { messageId: string; signature: string }[],
  ) => Promise<void>;
}) {
  const wallets = usePayoutWallets().filter(
    (wallet) => wallet.family === "solana",
  );
  const [wallet, setWallet] = useState<VaultConnection | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const { busy, error, run } = useAction();
  const connect = (provider: PayoutWallet) =>
    void run(async () => {
      await authorize();
      const connection = await provider.connect();
      if (connection.address !== payer || !connection.solanaSignMessage)
        throw new Error("Connect the original payer's Solana wallet.");
      setWallet(connection);
    });
  const check = () =>
    void run(async () => {
      const actor = await currentProjectSession();
      if (!actor || !wallet?.solanaSignMessage)
        throw new Error("Sign in and connect the original payer wallet.");
      const key = `slop:bounty-history:v1:${caseId}:${generation}:${actor.githubId}`;
      const raw = sessionStorage.getItem(key);
      const saved = raw
        ? (JSON.parse(raw) as Record<
            string,
            { message: string; signature: string }
          >)
        : {};
      const signatures: { messageId: string; signature: string }[] = [];
      for (const message of messages) {
        await authorize();
        const current = await currentProjectSession();
        if (current?.githubId !== actor.githubId)
          throw new Error(
            "Your account changed. Reload before checking payment history.",
          );
        if (!mounted.current) throw new Error("The recovery view was closed.");
        let signature =
          saved[message.messageId]?.message === message.message
            ? saved[message.messageId].signature
            : null;
        if (!signature) {
          const bytes = Uint8Array.from(atob(message.message), (character) =>
            character.charCodeAt(0),
          );
          signature = encodeBase58Bytes(await wallet.solanaSignMessage(bytes));
          saved[message.messageId] = { message: message.message, signature };
          sessionStorage.setItem(key, JSON.stringify(saved));
        }
        signatures.push({ messageId: message.messageId, signature });
      }
      await authorize();
      await verify(signatures);
    });
  return (
    <div className="direct-bounty-payment">
      <p>
        Sign expired request messages to check chain history. This does not send
        a transaction.
      </p>
      <WalletConnection
        address={wallet?.address ?? null}
        wallets={wallets}
        disabled={busy}
        legend="Original payer wallet"
        empty={<NoWalletFound solana />}
        onConnect={connect}
      />
      <button
        className="button secondary-button"
        type="button"
        disabled={busy || !wallet}
        onClick={check}
      >
        {busy ? "Checking…" : "Check expired payment"}
      </button>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
