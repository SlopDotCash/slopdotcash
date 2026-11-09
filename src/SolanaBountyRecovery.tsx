import { ed25519 } from "@noble/curves/ed25519.js";
import { useLayoutEffect, useRef, useState } from "react";
import { decodeBase58Bytes, encodeBase58Bytes } from "./lib/base58";
import { decodeBase64 } from "./lib/byte-encoding";
import { errorMessage } from "./lib/errors";
import type { VaultConnection } from "./lib/evm-vault-actions";
import { currentProjectSession } from "./lib/project-api";
import { type PayoutWallet, usePayoutWallets } from "./lib/use-payout-wallets";
import { solanaAddressBytes } from "./lib/wallets";
import { NoWalletFound, WalletConnection } from "./Presentation";

type Message = { messageId: string; message: string };

function validSignature(
  value: unknown,
  message: Uint8Array,
  payer: Uint8Array,
): value is string {
  if (typeof value !== "string" || value.length > 88) return false;
  try {
    const signature = decodeBase58Bytes(value);
    return (
      signature.length === 64 &&
      encodeBase58Bytes(signature) === value &&
      ed25519.verify(signature, message, payer, { zip215: false })
    );
  } catch {
    return false;
  }
}

/** Only signs messages the API has established are expired; never sends a transaction. */
export function SolanaBountyRecovery({
  caseId,
  revision,
  generation,
  payer,
  messages,
  authorize,
  verify,
}: {
  caseId: string;
  revision: number;
  generation: number;
  payer: string;
  messages: Message[];
  authorize: (isCurrent?: () => boolean) => Promise<void>;
  verify: (
    signatures: { messageId: string; signature: string }[],
    isCurrent?: () => boolean,
  ) => Promise<void>;
}) {
  const wallets = usePayoutWallets().filter(
    (wallet) => wallet.family === "solana",
  );
  const [wallet, setWallet] = useState<VaultConnection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<symbol | null>(null);
  const context = JSON.stringify([
    caseId,
    revision,
    generation,
    payer,
    messages,
  ]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: A different case, revision, payer or message retires the prior signing request.
  useLayoutEffect(() => {
    active.current = null;
    setWallet(null);
    setBusy(false);
    setError(null);
    return () => {
      active.current = null;
    };
  }, [context]);
  const run = async (action: (isCurrent: () => boolean) => Promise<void>) => {
    if (active.current !== null) return;
    const token = Symbol();
    active.current = token;
    const isCurrent = () => active.current === token;
    setBusy(true);
    setError(null);
    try {
      await action(isCurrent);
    } catch (caught) {
      if (isCurrent()) setError(errorMessage(caught));
    } finally {
      if (isCurrent()) {
        active.current = null;
        setBusy(false);
      }
    }
  };
  const connect = (provider: PayoutWallet) =>
    void run(async (isCurrent) => {
      await authorize(isCurrent);
      if (!isCurrent()) return;
      const connection = await provider.connect();
      if (!isCurrent()) return;
      if (connection.address !== payer || !connection.solanaSignMessage)
        throw new Error("Connect the original payer's Solana wallet.");
      setWallet(connection);
    });
  const check = () =>
    void run(async (isCurrent) => {
      const actor = await currentProjectSession();
      if (!isCurrent()) return;
      if (!actor || !wallet?.solanaSignMessage)
        throw new Error("Sign in and connect the original payer wallet.");
      const payerBytes = solanaAddressBytes(payer);
      const checkAuthority = async () => {
        if (!isCurrent()) return false;
        await authorize(isCurrent);
        if (!isCurrent()) return false;
        const current = await currentProjectSession();
        if (!isCurrent()) return false;
        if (current?.githubId !== actor.githubId)
          throw new Error(
            "Your account changed. Reload before checking payment history.",
          );
        return true;
      };
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
        if (!(await checkAuthority()) || !isCurrent()) return;
        const bytes = decodeBase64(message.message);
        const cached = saved[message.messageId];
        let signature =
          cached?.message === message.message &&
          validSignature(cached.signature, bytes, payerBytes)
            ? cached.signature
            : null;
        if (!signature) {
          signature = encodeBase58Bytes(
            await wallet.solanaSignMessage(bytes.slice()),
          );
          if (!isCurrent()) return;
          if (!validSignature(signature, bytes, payerBytes))
            throw new Error(
              "Your wallet returned an invalid recovery signature. Reconnect and try again.",
            );
          if (!(await checkAuthority()) || !isCurrent()) return;
          saved[message.messageId] = { message: message.message, signature };
          sessionStorage.setItem(key, JSON.stringify(saved));
        }
        signatures.push({ messageId: message.messageId, signature });
      }
      if (!(await checkAuthority()) || !isCurrent()) return;
      await verify(signatures, isCurrent);
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
