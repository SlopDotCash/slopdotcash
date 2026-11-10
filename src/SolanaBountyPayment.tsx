import { useCallback, useEffect, useRef, useState } from "react";
import { encodeBase58Bytes } from "./lib/base58";
import { decodeBase64 } from "./lib/byte-encoding";
import {
  type ApprovedDirectTransfer,
  type ApprovedSolanaAsset,
  matchesApprovedSolanaPlan,
} from "./lib/direct-payment-plan";
import type { VaultConnection } from "./lib/evm-vault-actions";
import { isSolanaTransactionId } from "./lib/funding-address.mjs";
import {
  clearPendingAttempt,
  clearUnreadableRecord,
  createPendingAttempt,
  type PendingAttempt,
  updatePendingAttempt,
  updatePendingRecord,
  validPendingAttemptId,
} from "./lib/pending-attempt";
import { currentProjectSession } from "./lib/project-api";
import { useAction } from "./lib/use-action";
import { type PayoutWallet, usePayoutWallets } from "./lib/use-payout-wallets";
import { NoWalletFound, WalletConnection } from "./Presentation";

export type DirectSolanaPlan = { transaction: string; messageId: string };
type Pending = PendingAttempt & {
  transaction: string;
  signature: string | null;
  candidate?: string;
};

function readPending(raw: string | null, transaction: string): Pending | null {
  const saved = raw ? (JSON.parse(raw) as Pending) : null;
  if (
    saved &&
    (!validPendingAttemptId(saved.attemptId) ||
      saved.transaction !== transaction ||
      (saved.signature !== null && !isSolanaTransactionId(saved.signature)) ||
      (saved.candidate !== undefined &&
        !isSolanaTransactionId(saved.candidate)))
  )
    throw new Error(
      "The saved wallet request cannot be read. Check wallet activity before continuing.",
    );
  return saved;
}

const UNREADABLE_MESSAGE =
  "The saved wallet request cannot be read. Check wallet activity before continuing.";

/** Sends only the retained transaction through the owner's selected wallet. */
export function SolanaBountyPayment({
  caseId,
  generation,
  payer,
  plan,
  expectedTransfers,
  asset,
  authorize,
  authorizeVerification,
  verify,
}: {
  caseId: string;
  generation: number;
  payer: string;
  plan: DirectSolanaPlan;
  /**
   * The approved transfers the plan must perform. When present, the
   * transaction is checked against them before any wallet prompt; a plan
   * that disagrees is refused instead of signed.
   */
  expectedTransfers?: ApprovedDirectTransfer[];
  asset?: ApprovedSolanaAsset;
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
  const [unreadable, setUnreadable] = useState<{
    key: string;
    raw: string | null;
  } | null>(null);
  const storedPending = useRef<Pending | null>(null);
  const [candidate, setCandidate] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const mounted = useRef(true);
  const sending = useRef(false);
  const { busy, error, setError, run } = useAction();
  const key = `slop:bounty-solana:v1:${caseId}:${generation}:${plan.messageId}:${actor ?? ""}`;
  /** Reads the saved request, remembering an unreadable record for recovery. */
  const readSessionPending = useCallback(async () => {
    const session = await currentProjectSession();
    if (!session) throw new Error("Sign in before making a payment.");
    const storageKey = `slop:bounty-solana:v1:${caseId}:${generation}:${plan.messageId}:${session.githubId}`;
    const raw = sessionStorage.getItem(storageKey);
    try {
      return {
        actor: session.githubId,
        saved: readPending(raw, plan.transaction),
        storageKey,
      };
    } catch {
      setUnreadable({ key: storageKey, raw });
      throw new Error(UNREADABLE_MESSAGE);
    }
  }, [caseId, generation, plan.messageId, plan.transaction]);
  useEffect(() => {
    mounted.current = true;
    let active = true;
    void readSessionPending()
      .then((loaded) => {
        if (!active || !mounted.current) return;
        storedPending.current = loaded.saved;
        setActor(loaded.actor);
        setPending(loaded.saved);
        setReady(true);
      })
      .catch((cause: unknown) => {
        if (active && mounted.current)
          setError(cause instanceof Error ? cause.message : UNREADABLE_MESSAGE);
      });
    return () => {
      active = false;
      mounted.current = false;
    };
  }, [readSessionPending, setError]);
  /** Removes the unreadable record only if this tab did not change it. */
  const clearUnreadable = () =>
    void run(async () => {
      if (!unreadable) return;
      if (!clearUnreadableRecord(unreadable.key, unreadable.raw))
        throw new Error("The saved request changed. Reload before continuing.");
      setUnreadable(null);
      const loaded = await readSessionPending();
      storedPending.current = loaded.saved;
      setActor(loaded.actor);
      setPending(loaded.saved);
      setReady(true);
    });
  const remember = (value: Pending, previous?: Pending) => {
    const stored = previous
      ? updatePendingAttempt(key, previous, value)
      : createPendingAttempt(key, value);
    if (!stored) return false;
    storedPending.current = value;
    if (mounted.current) setPending(value);
    return true;
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
        if (planMismatch)
          throw new Error(
            "The prepared payment does not match the approved transfers. Refresh the case before signing.",
          );
        if (!ready || pending || !wallet?.solanaSend) return;
        await guard();
        if (wallet.address !== payer)
          throw new Error("The payer wallet changed.");
        const transaction = decodeBase64(plan.transaction);
        const intent: Pending = {
          attemptId: crypto.randomUUID(),
          transaction: plan.transaction,
          signature: null,
        };
        let requested = false;
        try {
          const signature = encodeBase58Bytes(
            await wallet.solanaSend(transaction, "solana:mainnet", () => {
              if (!mounted.current)
                throw new Error("The payment view was closed.");
              if (!remember(intent))
                throw new Error(
                  "The saved request changed. Reload before continuing.",
                );
              requested = true;
            }),
          );
          if (!isSolanaTransactionId(signature))
            throw new Error(
              "The wallet did not return a valid transaction signature.",
            );
          const submitted = { ...intent, signature };
          try {
            const current = readPending(
              sessionStorage.getItem(key),
              plan.transaction,
            );
            if (
              !current ||
              current.attemptId !== intent.attemptId ||
              (current.signature !== null && current.signature !== signature) ||
              !remember({ ...current, signature }, intent)
            ) {
              if (mounted.current)
                setError(
                  `Submitted ${signature}. Keep this signature; the saved request changed.`,
                );
            }
          } catch {
            if (mounted.current) setPending(submitted);
            throw new Error(
              `Submitted ${signature}. Keep this signature; browser storage could not save it.`,
            );
          }
        } catch (cause) {
          if ((cause as { code?: unknown } | null)?.code === 4001) {
            if (requested) {
              const cleared = clearPendingAttempt(key, intent);
              if (cleared) {
                storedPending.current = null;
                if (mounted.current) setPending(null);
              } else if (mounted.current)
                throw new Error(
                  "The saved request changed. Reload before continuing.",
                );
            }
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
  /** The transaction must perform exactly the approved transfers. */
  const planMismatch =
    expectedTransfers !== undefined &&
    asset !== undefined &&
    !matchesApprovedSolanaPlan(plan, expectedTransfers, asset, payer);
  const check = () =>
    void run(async () => {
      if (!pending || !isSolanaTransactionId(signature)) return;
      const captured = storedPending.current;
      if (!captured)
        throw new Error("The saved request changed. Reload before continuing.");
      await guard(true);
      if (!mounted.current) throw new Error("The payment view was closed.");
      const value = { ...pending, candidate: signature };
      if (!updatePendingRecord(key, captured, value))
        throw new Error("The saved request changed. Reload before continuing.");
      storedPending.current = value;
      setPending(value);
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
      {unreadable ? (
        <div role="status">
          <p>
            The saved request cannot be read. Check wallet activity, then clear
            it to continue.
          </p>
          <button
            className="button secondary-button"
            type="button"
            disabled={busy}
            onClick={clearUnreadable}
          >
            I checked wallet activity. Clear saved request
          </button>
        </div>
      ) : null}
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
            disabled={busy || !ready || !wallet || planMismatch}
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
      {planMismatch ? (
        <p className="form-error" role="alert">
          The prepared payment does not match the approved transfers. Refresh
          the case before signing.
        </p>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
