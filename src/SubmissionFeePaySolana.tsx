import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { formatBaseUnits } from "./lib/base-units.mjs";
import { errorMessage } from "./lib/errors";
import type { VaultConnection } from "./lib/evm-vault-actions";
import { isSolanaTransactionId } from "./lib/funding-address.mjs";
import { networkLabel } from "./lib/network-names";
import { transactionUrl } from "./lib/payments/contracts";
import {
  type PendingAttempt,
  validPendingAttemptId,
} from "./lib/pending-attempt";
import {
  checkSolanaFee,
  checkSolanaReclaim,
  reviewSolanaFee,
  reviewSolanaReclaim,
  type SolanaFeePlan,
  type SolanaFeeSubject,
  type SolanaReclaimPlan,
  sendSolanaFee,
  sendSolanaReclaim,
} from "./lib/solana-fee-deposit";
import { SUBMISSION_FEE_RECLAIM_DAYS } from "./lib/submission-fee.mjs";
import {
  feeAmountText,
  feeDepositKey,
  type SolanaFeeWay,
} from "./lib/submission-fee-page";
import { useAction } from "./lib/use-action";
import { type PayoutWallet, usePayoutWallets } from "./lib/use-payout-wallets";
import { usePendingWalletAttempt } from "./lib/use-pending-wallet-attempt";
import { PendingWalletCheck } from "./OwnerPresentation";
import { NoWalletFound, WalletConnection } from "./Presentation";

type Pending = PendingAttempt & {
  version: 1;
  kind: "deposit" | "reclaim";
  wallet: string;
  /** A deposit's payer-chosen nonce, decimal. */
  nonce?: string;
  /** A reclaim's deposit record. */
  deposit?: string;
  blockhash: string;
  hash: string | null;
  hashSource?: "wallet" | "recovery";
};

const AUTO_CHECK_MS = 5_000;
const AUTO_CHECK_ATTEMPTS = 120;
/** As on the EVM form: after this long an unrecorded deposit did not count. */
const RECORD_WAIT_MS = 60 * 60_000;
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u;
const NONCE = /^(0|[1-9][0-9]{0,19})$/u;

function readPending(raw: string): Pending {
  const value = JSON.parse(raw) as Pending;
  if (
    value === null ||
    typeof value !== "object" ||
    value.version !== 1 ||
    !validPendingAttemptId(value.attemptId) ||
    (value.kind !== "deposit" && value.kind !== "reclaim") ||
    typeof value.wallet !== "string" ||
    !ADDRESS.test(value.wallet) ||
    typeof value.blockhash !== "string" ||
    !ADDRESS.test(value.blockhash) ||
    (value.kind === "deposit"
      ? typeof value.nonce !== "string" || !NONCE.test(value.nonce)
      : typeof value.deposit !== "string" || !ADDRESS.test(value.deposit)) ||
    (value.hash !== null && !isSolanaTransactionId(value.hash)) ||
    (value.hashSource !== undefined &&
      (value.hash === null ||
        !["wallet", "recovery"].includes(value.hashSource)))
  )
    throw new Error(
      "The saved transaction cannot be read. Check your wallet activity before starting a new payment.",
    );
  return value;
}

const lamportsText = (lamports: string) =>
  `${formatBaseUnits(lamports, 9)} SOL`;

/**
 * Wallet-confirmed payment of one pull request's submission fee in USDC on
 * Solana, and the payer's own reclaim of a deposit the program still holds
 * after its delay. Any wallet may pay; the refund goes to that wallet's
 * associated USDC account. No key or signing authority enters Slop, and
 * every address comes from `way`, which the page built from the published
 * tables.
 */
export function SubmissionFeePaySolana({
  subject,
  way,
  reclaim,
  confirmDue,
  onDeposit,
}: {
  subject: SolanaFeeSubject;
  /** The Solana way to pay while the fee is due; null once it is not. */
  way: SolanaFeeWay | null;
  /** The published way, when a recorded Solana deposit may be taken back. */
  reclaim: SolanaFeeWay | null;
  /** Reads the fee record again and refuses when Solana is no longer due as shown. */
  confirmDue: () => Promise<void>;
  /** A transaction of this tab is final; the page reads the record again. */
  onDeposit: () => void;
}) {
  const key = `${feeDepositKey(subject.item)}:solana`;
  const {
    mounted,
    saved,
    storedPending,
    pending,
    storageError,
    clear,
    submit,
    recordRecoveryHash,
    clearUnreadable,
  } = usePendingWalletAttempt<Pending>(key, readPending, (error) =>
    errorMessage(error, "The wallet request failed."),
  );
  const wallets = usePayoutWallets().filter(
    (entry) => entry.family === "solana" && entry.solanaFunding,
  );
  const [wallet, setWallet] = useState<VaultConnection | null>(null);
  const [plan, setPlan] = useState<SolanaFeePlan | null>(null);
  const [back, setBack] = useState<SolanaReclaimPlan | null>(null);
  const [notice, setNotice] = useState("");
  const [recoveryHash, setRecoveryHash] = useState(saved.pending?.hash ?? "");
  const depositedKey = `${key}:deposited`;
  const [depositedAt, setDepositedAt] = useState<number | null>(() => {
    try {
      const value = Number(sessionStorage.getItem(depositedKey));
      return Number.isSafeInteger(value) && value > 0 ? value : null;
    } catch {
      return null;
    }
  });
  const { busy, error, setError, run: act } = useAction(saved.error || null);
  const run = (action: () => Promise<void>) => {
    setNotice("");
    return act(action, (caught) =>
      errorMessage(caught, "The wallet request failed."),
    );
  };
  const awaitingRecord =
    way !== null &&
    depositedAt !== null &&
    Date.now() - depositedAt < RECORD_WAIT_MS;
  const connect = (provider: PayoutWallet) =>
    run(async () => {
      const connection = await provider.connect();
      if (!mounted.current) return;
      if (pending && connection.address !== pending.wallet)
        throw new Error(
          `Reconnect the wallet that submitted this transaction: ${pending.wallet}`,
        );
      if (!connection.solanaSend)
        throw new Error("Choose a wallet with Solana transaction support.");
      setWallet(connection);
      setPlan(null);
      setBack(null);
    });
  const review = () =>
    run(async () => {
      if (!wallet || !way) throw new Error("Choose a wallet first.");
      const reviewed = await reviewSolanaFee(way, subject, wallet);
      if (mounted.current) setPlan(reviewed);
    });
  const reviewReclaim = () =>
    run(async () => {
      if (!wallet || !reclaim) throw new Error("Choose a wallet first.");
      const reviewed = await reviewSolanaReclaim(reclaim, subject, wallet);
      if (mounted.current) setBack(reviewed);
    });
  const send = () =>
    run(async () => {
      if (!wallet || !way || !plan || pending || storageError) return;
      // Someone else may have paid since the review.
      await confirmDue();
      const intent: Pending = {
        attemptId: crypto.randomUUID(),
        version: 1,
        kind: "deposit",
        wallet: wallet.address,
        nonce: plan.nonce,
        blockhash: plan.blockhash,
        hash: null,
      };
      await submit(
        intent,
        (beforeSend) => sendSolanaFee(way, subject, wallet, plan, beforeSend),
        {
          submitted: (hash) => ({ ...intent, hash, hashSource: "wallet" }),
          notify: setNotice,
          onBeforeSend: () => setRecoveryHash(""),
          unclear:
            "The wallet result is unclear. Check wallet activity and enter its transaction signature below before another attempt.",
        },
      );
      if (mounted.current) setPlan(null);
    });
  const sendReclaim = () =>
    run(async () => {
      if (!wallet || !reclaim || !back || pending || storageError) return;
      const intent: Pending = {
        attemptId: crypto.randomUUID(),
        version: 1,
        kind: "reclaim",
        wallet: wallet.address,
        deposit: back.deposit,
        blockhash: back.blockhash,
        hash: null,
      };
      await submit(
        intent,
        (beforeSend) => sendSolanaReclaim(reclaim, wallet, back, beforeSend),
        {
          submitted: (hash) => ({ ...intent, hash, hashSource: "wallet" }),
          notify: setNotice,
          onBeforeSend: () => setRecoveryHash(""),
          unclear:
            "The wallet result is unclear. Check wallet activity and enter its transaction signature below before another attempt.",
        },
      );
      if (mounted.current) setBack(null);
    });
  const checking = useRef(false);
  /** Reads the transaction's finalized outcome. A timer's check shows no busy state. */
  const verify = async (automatic: boolean) => {
    if (!pending || checking.current) return;
    checking.current = true;
    try {
      const captured = storedPending.current;
      if (!captured)
        throw new Error("The saved request changed. Reload before continuing.");
      const hash =
        pending.hashSource === "wallet" ? pending.hash : recoveryHash.trim();
      if (!hash || !isSolanaTransactionId(hash))
        throw new Error("Enter the transaction signature from your wallet.");
      const result =
        pending.kind === "deposit"
          ? await checkSolanaFee(
              subject,
              {
                wallet: pending.wallet,
                nonce: pending.nonce as string,
                blockhash: pending.blockhash,
              },
              hash,
            )
          : await checkSolanaReclaim(
              subject,
              {
                wallet: pending.wallet,
                deposit: pending.deposit as string,
                blockhash: pending.blockhash,
              },
              hash,
            );
      if (!mounted.current) return;
      if (result === "pending") {
        if (automatic) return;
        if (pending.hashSource !== "wallet") {
          const candidate: Pending = {
            ...pending,
            hash,
            hashSource: "recovery",
          };
          if (!recordRecoveryHash(captured, candidate))
            setNotice(`Not saved on this device. Keep this signature: ${hash}.`);
        }
        setNotice("Waiting for Solana to finalize the transaction.");
        return;
      }
      clear(captured);
      setRecoveryHash("");
      setError(null);
      if (result === "failed") {
        setNotice(
          "The transaction failed and no tokens moved. Review again, then retry.",
        );
        return;
      }
      if (pending.kind === "deposit") {
        const at = Date.now();
        setDepositedAt(at);
        try {
          sessionStorage.setItem(depositedKey, String(at));
        } catch {
          // This view still holds it; only a reload forgets it.
        }
        setNotice(`Deposit verified on the finalized Solana chain. ${hash}`);
      } else
        setNotice(
          `The deposit was taken back to your USDC account. ${hash}`,
        );
      onDeposit();
    } finally {
      checking.current = false;
    }
  };
  const latestVerify = useRef(verify);
  useLayoutEffect(() => {
    latestVerify.current = verify;
  });
  // Only a signature this wallet interaction returned is checked by a timer.
  const autoHash =
    !busy && !storageError && pending?.hashSource === "wallet"
      ? pending.hash
      : null;
  const [ticks, setTicks] = useState(0);
  useEffect(() => {
    if (autoHash === null || ticks >= AUTO_CHECK_ATTEMPTS) return;
    const timer = window.setTimeout(() => {
      if (document.visibilityState === "hidden") setTicks((value) => value + 1);
      else
        void latestVerify
          .current(true)
          .catch((caught) => {
            if (mounted.current)
              setError(errorMessage(caught, "The wallet request failed."));
          })
          .then(() => {
            if (mounted.current) setTicks((value) => value + 1);
          });
    }, AUTO_CHECK_MS);
    return () => window.clearTimeout(timer);
  }, [autoHash, ticks, mounted, setError]);
  const shown = way ?? reclaim;
  if (!shown && !pending) return null;
  return (
    <section
      className="admin-card vault-actions"
      aria-label="Pay the fee on Solana"
    >
      <h2>{way || pending?.kind === "deposit" ? "Pay with USDC on Solana" : "Take a Solana deposit back"}</h2>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {storageError ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(async () => clearUnreadable())}
        >
          I checked wallet activity; clear the unreadable local record
        </button>
      ) : null}
      {pending || (shown && !awaitingRecord) ? (
        <WalletConnection
          address={wallet?.address ?? null}
          wallets={wallets}
          disabled={busy || storageError}
          className="admin-fieldset"
          legend={
            pending
              ? "Reconnect to check this transaction"
              : "Choose a Solana wallet"
          }
          empty={<NoWalletFound solana />}
          onConnect={(provider) => void connect(provider)}
        />
      ) : null}
      {pending ? (
        <PendingWalletCheck
          link={transactionUrl(shown?.network ?? "solana-mainnet", pending.hash)}
          hashSource={pending.hashSource}
          solana
          recoveryHash={recoveryHash}
          onRecoveryHash={setRecoveryHash}
          busy={busy}
          canCheck
          onCheck={() => void run(() => verify(false))}
          unsent={!pending.hash && !recoveryHash.trim()}
          onClear={() =>
            void run(async () => {
              clear(storedPending.current ?? pending);
              setNotice("Local request cleared. Review again before sending.");
            })
          }
        >
          <p>
            {pending.kind === "deposit" ? "Deposit" : "Reclaim"} awaiting
            verification. Do not send it again.
          </p>
        </PendingWalletCheck>
      ) : awaitingRecord ? (
        <p>
          The deposit from this browser tab is final on Solana, and Slop has not
          recorded it yet. That usually takes a few minutes, and this page reads
          the record again by itself. Do not pay again.
        </p>
      ) : wallet && way && !storageError ? (
        <>
          <ul>
            <li>
              The deposit's record on Solana needs about 0.002 SOL of rent from
              your wallet. The deposit program returns that rent to your wallet
              whenever the deposit is settled, whatever the outcome.
            </li>
            <li>
              A refund goes to this wallet's own USDC account, the one the
              deposit is paid from. That account must still exist when the
              refund is sent, so do not close it.
            </li>
            <li>
              If nothing settles the deposit, this wallet can take it back from
              the deposit program {SUBMISSION_FEE_RECLAIM_DAYS} days after the
              deposit, from this page or directly.
            </li>
          </ul>
          <button
            type="button"
            className="button secondary-button"
            disabled={busy}
            onClick={() => void review()}
          >
            Review deposit
          </button>
          {plan ? (
            <section aria-label="Review Solana deposit">
              <dl className="vault-addresses">
                <div>
                  <dt>Amount</dt>
                  <dd>{feeAmountText(way)}</dd>
                </div>
                <div>
                  <dt>Network</dt>
                  <dd>{networkLabel(way.network)}</dd>
                </div>
                <div>
                  <dt>Deposit program</dt>
                  <dd>
                    <code>{way.programId}</code>
                  </dd>
                </div>
                <div>
                  <dt>Token</dt>
                  <dd>
                    <code>{way.token}</code>
                  </dd>
                </div>
                <div>
                  <dt>If kept, it goes to</dt>
                  <dd>
                    Slop's fee wallet <code>{way.keptTo}</code>
                  </dd>
                </div>
                <div>
                  <dt>Refund goes to</dt>
                  <dd>
                    the USDC account of <code>{wallet.address}</code>
                  </dd>
                </div>
                <div>
                  <dt>Rent, returned when settled</dt>
                  <dd>{lamportsText(plan.rentLamports)}</dd>
                </div>
                <div>
                  <dt>Network fee</dt>
                  <dd>{lamportsText(plan.networkFeeLamports)}</dd>
                </div>
              </dl>
              <button
                type="button"
                className="button primary-button"
                disabled={busy}
                onClick={() => void send()}
              >
                Confirm deposit in wallet
              </button>
            </section>
          ) : null}
        </>
      ) : wallet && reclaim && !storageError ? (
        <>
          <p>
            A deposit that nothing has settled {SUBMISSION_FEE_RECLAIM_DAYS}{" "}
            days after it was made can be taken back by the wallet that paid
            it, into that wallet's USDC account.
          </p>
          <button
            type="button"
            className="button secondary-button"
            disabled={busy}
            onClick={() => void reviewReclaim()}
          >
            Review taking the deposit back
          </button>
          {back ? (
            <section aria-label="Review Solana reclaim">
              <dl className="vault-addresses">
                <div>
                  <dt>Amount</dt>
                  <dd>
                    {feeAmountText({ ...reclaim, amount: back.amount })}
                  </dd>
                </div>
                <div>
                  <dt>Deposit record</dt>
                  <dd>
                    <code>{back.deposit}</code>
                  </dd>
                </div>
                <div>
                  <dt>Goes to</dt>
                  <dd>
                    the USDC account of <code>{wallet.address}</code>
                  </dd>
                </div>
                <div>
                  <dt>Network fee</dt>
                  <dd>{lamportsText(back.networkFeeLamports)}</dd>
                </div>
              </dl>
              <button
                type="button"
                className="button primary-button"
                disabled={busy}
                onClick={() => void sendReclaim()}
              >
                Take the deposit back in wallet
              </button>
            </section>
          ) : null}
        </>
      ) : null}
      {busy && <p role="status">Waiting for wallet or chain response…</p>}
    </section>
  );
}
