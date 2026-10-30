import { useEffect, useRef, useState } from "react";
import { encodeBase58Bytes } from "./lib/base58";
import type { VaultConnection } from "./lib/evm-vault-actions";
import { isSolanaTransactionId } from "./lib/funding-address.mjs";
import { currentProjectSession } from "./lib/project-api";
import { useAction } from "./lib/use-action";
import { type PayoutWallet, usePayoutWallets } from "./lib/use-payout-wallets";
import { NoWalletFound, WalletConnection } from "./Presentation";

export type DirectSolanaPlan = { transaction: string; messageId: string };
type Pending = {
  transaction: string;
  signature: string | null;
  candidate?: string;
};

/** Sends only the retained transaction through the owner's selected wallet. */
export function SolanaBountyPayment({
  caseId,
  generation,
  payer,
  plan,
  authorize,
  authorizeVerification,
  verify,
}: {
  caseId: string;
  generation: number;
  payer: string;
  plan: DirectSolanaPlan;
  authorize: () => Promise<void>;
  authorizeVerification: () => Promise<void>;
  verify: (signature: string) => Promise<void>;
}) {
  const wallets = usePayoutWallets().filter(
    (entry) => entry.family === "solana" && entry.solanaFunding,
  );
  const [wallet, setWallet] = useState<VaultConnection | null>(null);
  const [actor, setActor] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [candidate, setCandidate] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const mounted = useRef(true);
  const sending = useRef(false);
  const { busy, error, setError, run } = useAction();
  const key = `slop:bounty-solana:v1:${caseId}:${generation}:${plan.messageId}:${actor ?? ""}`;
  useEffect(() => {
    mounted.current = true;
    void currentProjectSession()
      .then((session) => {
        if (!mounted.current) return;
        if (!session) throw new Error("Sign in before making a payment.");
        const storageKey = `slop:bounty-solana:v1:${caseId}:${generation}:${plan.messageId}:${session.githubId}`;
        const raw = sessionStorage.getItem(storageKey);
        const saved = raw ? (JSON.parse(raw) as Pending) : null;
        if (
          saved &&
          (saved.transaction !== plan.transaction ||
            (saved.signature !== null &&
              !isSolanaTransactionId(saved.signature)) ||
            (saved.candidate !== undefined &&
              !isSolanaTransactionId(saved.candidate)))
        )
          throw new Error(
            "The saved wallet request cannot be read. Check wallet activity before continuing.",
          );
        setActor(session.githubId);
        setPending(saved);
        setReady(true);
      })
      .catch((cause: unknown) => {
        if (mounted.current)
          setError(
            cause instanceof Error
              ? cause.message
              : "The payment session could not be checked.",
          );
      });
    return () => {
      mounted.current = false;
    };
  }, [caseId, generation, plan.messageId, plan.transaction, setError]);
  const remember = (value: Pending | null) => {
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
    setPending(value);
  };
  const guard = async (verification = false) => {
    if (!mounted.current) throw new Error("The payment view was closed.");
    const current = await currentProjectSession();
    if (!actor || current?.githubId !== actor)
      throw new Error("Your account changed. Reload before making a payment.");
    await (verification ? authorizeVerification() : authorize());
    if (!mounted.current) throw new Error("The payment view was closed.");
  };
  const connect = (provider: PayoutWallet) =>
    void run(async () => {
      await guard();
      const connection = await provider.connect();
      if (connection.address !== payer || !connection.solanaSend)
        throw new Error("Connect the payer's Solana wallet shown above.");
      setWallet(connection);
    });
  const send = () => {
    if (sending.current) return;
    sending.current = true;
    void run(async () => {
      try {
        if (!ready || pending || !wallet?.solanaSend) return;
        await guard();
        if (wallet.address !== payer)
          throw new Error("The payer wallet changed.");
        const transaction = Uint8Array.from(
          atob(plan.transaction),
          (character) => character.charCodeAt(0),
        );
        let requested = false;
        try {
          const signature = encodeBase58Bytes(
            await wallet.solanaSend(transaction, "solana:mainnet", () => {
              remember({ transaction: plan.transaction, signature: null });
              requested = true;
            }),
          );
          if (!isSolanaTransactionId(signature))
            throw new Error(
              "The wallet did not return a valid transaction signature.",
            );
          const value = { transaction: plan.transaction, signature };
          setPending(value);
          try {
            remember(value);
          } catch {
            throw new Error(
              `Submitted ${signature}. Keep this signature; browser storage could not save it.`,
            );
          }
        } catch (cause) {
          if ((cause as { code?: unknown } | null)?.code === 4001) {
            remember(null);
            throw new Error(
              "You declined the wallet request. Nothing was sent.",
            );
          }
          if (!requested) throw cause;
          throw new Error(
            cause instanceof Error && cause.message.startsWith("Submitted ")
              ? cause.message
              : "The wallet result is uncertain. Check wallet activity and enter its signature; do not send again.",
          );
        }
      } finally {
        sending.current = false;
      }
    });
  };
  const signature = candidate ?? pending?.candidate ?? pending?.signature ?? "";
  const check = () =>
    void run(async () => {
      await guard(true);
      if (!pending || !isSolanaTransactionId(signature)) return;
      remember({ ...pending, candidate: signature });
      await verify(signature);
    });
  return (
    <section
      className="direct-bounty-payment"
      aria-label="Pay from your Solana wallet"
    >
      <WalletConnection
        address={wallet?.address ?? null}
        wallets={wallets}
        disabled={busy || !ready}
        legend="Payment wallet"
        empty={<NoWalletFound solana />}
        onConnect={connect}
      />
      {pending ? (
        <>
          <label>
            Transaction signature from your wallet
            <input
              value={signature}
              onChange={(event) => setCandidate(event.target.value)}
              spellCheck={false}
            />
          </label>
          <p role="status">
            {pending.signature
              ? "Submitted. Verify finalized payment."
              : "Wallet result uncertain. Enter its signature to continue."}
          </p>
        </>
      ) : null}
      <div className="handoff-actions">
        {!pending ? (
          <button
            className="button primary-button"
            type="button"
            disabled={busy || !ready || !wallet}
            onClick={send}
          >
            Pay approved award
          </button>
        ) : null}
        {pending && isSolanaTransactionId(signature) ? (
          <button
            className="button secondary-button"
            type="button"
            disabled={busy}
            onClick={check}
          >
            Verify submitted payment
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
