import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { errorMessage } from "./lib/errors";
import {
  checkFeeBatch,
  checkFeeDeposit,
  type FeeDepositReview,
  type FeeDepositStatus,
  reviewFeeDeposit,
  sendFeeBatch,
  sendFeeDeposit,
  switchFeeChain,
} from "./lib/evm-fee-deposit";
import {
  VaultBatchUnavailable,
  type VaultConnection,
} from "./lib/evm-vault-actions";
import { networkLabel } from "./lib/network-names";
import { transactionUrl } from "./lib/payments/contracts";
import {
  clearPendingAttempt,
  type PendingAttempt,
  updatePendingRecord,
  validPendingAttemptId,
} from "./lib/pending-attempt";
import { SUBMISSION_FEE_CONFIRMATIONS } from "./lib/submission-fee.mjs";
import {
  type FeeTables,
  type FeeWay,
  feeAmountText,
  feeDepositKey,
  keptToText,
  savedFeeWay,
} from "./lib/submission-fee-page";
import { useAction } from "./lib/use-action";
import { type PayoutWallet, usePayoutWallets } from "./lib/use-payout-wallets";
import { usePendingWalletAttempt } from "./lib/use-pending-wallet-attempt";
import { PendingWalletCheck } from "./OwnerPresentation";
import { NoWalletFound, WalletConnection } from "./Presentation";

/** "batch" is one wallet request that carries the approval and the deposit. */
type Step = "approve" | "reset" | "send" | "batch";
type Pending = PendingAttempt & {
  version: 1;
  wallet: string;
  /** The way to pay as it was reviewed; its amount does not follow a later rate. */
  way: FeeWay;
  item: string;
  step: Step;
  hash: string | null;
  hashSource?: "wallet" | "recovery";
  /** The wallet's reference for a batch; its transaction hash is read later. */
  batchId?: string;
};
type Review = Omit<FeeDepositReview, "batch"> & { batch: boolean };

// The same pace as vault funding: every 3 seconds at first, then every 15,
// for about an hour. "Check transaction" stays for later visits.
const AUTO_CHECK_FAST_MS = 3_000;
const AUTO_CHECK_SLOW_MS = 15_000;
const AUTO_CHECK_FAST_ATTEMPTS = 20;
const AUTO_CHECK_ATTEMPTS = 240;
const HASH = /^0x[0-9a-fA-F]{64}$/u;
const WALLET = /^0x[0-9a-fA-F]{40}$/u;

function readPending(raw: string, item: string, tables: FeeTables): Pending {
  const value = JSON.parse(raw) as Pending;
  if (
    value === null ||
    typeof value !== "object" ||
    value.version !== 1 ||
    !validPendingAttemptId(value.attemptId) ||
    typeof value.wallet !== "string" ||
    !WALLET.test(value.wallet) ||
    value.item !== item ||
    !["approve", "reset", "send", "batch"].includes(value.step) ||
    (value.batchId !== undefined &&
      (value.step !== "batch" ||
        typeof value.batchId !== "string" ||
        value.batchId.length < 1 ||
        value.batchId.length > 4096)) ||
    (value.hash !== null &&
      (typeof value.hash !== "string" || !HASH.test(value.hash))) ||
    (value.hashSource !== undefined &&
      (value.hash === null ||
        !["wallet", "recovery"].includes(value.hashSource)))
  )
    throw new Error(
      "The saved transaction cannot be read. Check your wallet activity before starting a new payment.",
    );
  // The saved addresses must still be the published ones.
  return { ...value, way: savedFeeWay(value.way, tables) };
}

const wayKey = (way: FeeWay) => `${way.network}:${way.token.toLowerCase()}`;

/**
 * This tab's deposit is final on chain but the stored record may not show it
 * yet. Until it does, the form offers no second payment. Slop records a
 * deposit within minutes; after this long an unrecorded one did not count.
 */
const RECORD_WAIT_MS = 60 * 60_000;
type Deposited = { hash: string; network: string; at: number };
const depositedKey = (item: string) => `${feeDepositKey(item)}:deposited`;
function readDeposited(item: string): Deposited | null {
  try {
    const value = JSON.parse(
      sessionStorage.getItem(depositedKey(item)) ?? "null",
    ) as Deposited | null;
    return value &&
      typeof value.hash === "string" &&
      HASH.test(value.hash) &&
      typeof value.network === "string" &&
      Number.isSafeInteger(value.at)
      ? value
      : null;
  } catch {
    return null;
  }
}

/**
 * What a deposit pays: a pull request's fee, the deposit on a private report,
 * or a contributor's standing deposit.
 */
export type FeeSubject = "pull request" | "report" | "standing deposit";
const WORDS: Record<
  FeeSubject,
  { label: string; recorded: string; kept: string; uncounted: string }
> = {
  "pull request": {
    label: "Pay the fee",
    recorded: "Slop records the pull request as paid",
    kept: "a kept fee",
    uncounted: "it did not pay this pull request",
  },
  report: {
    label: "Pay the deposit",
    recorded: "Slop records the deposit",
    kept: "a kept deposit",
    uncounted: "it did not count for this report",
  },
  "standing deposit": {
    label: "Pay the standing deposit",
    recorded: "Slop records the standing deposit",
    kept: "a kept deposit",
    uncounted: "it did not count as your standing deposit",
  },
};

/** "Deposit received" wording: paid is recorded early, settlement waits for finality. */
function receivedNotice(
  way: FeeWay,
  hash: string,
  subject: FeeSubject,
): string {
  const network = networkLabel(way.network);
  const blocks =
    SUBMISSION_FEE_CONFIRMATIONS[
      way.network as keyof typeof SUBMISSION_FEE_CONFIRMATIONS
    ];
  return `Deposit received in a ${network} block. ${WORDS[subject].recorded} once that block is ${blocks} blocks deep, usually within a few minutes. A refund or ${WORDS[subject].kept} is sent only after ${network} finalizes the block. You can leave this page. ${hash}`;
}

/**
 * Wallet-confirmed payment of one pull request's submission fee, or of the
 * deposit on one private report. Any wallet may pay; the refund goes to the
 * wallet that paid. No key or signing authority enters Slop, and every
 * address comes from `ways`, which the page already checked against the
 * published tables.
 */
export function SubmissionFeePay({
  item,
  ways,
  tables,
  confirmDue,
  onDeposit,
  subject = "pull request",
}: {
  item: string;
  /** Names what the deposit pays in the few sentences that mention it. */
  subject?: FeeSubject;
  /** What is due now; empty once the pull request is recorded as paid. */
  ways: readonly FeeWay[];
  tables: FeeTables;
  /** Reads the fee record again and refuses when this way is no longer due as shown. */
  confirmDue: (way: FeeWay) => Promise<void>;
  /** A deposit of this tab is on chain; the page reads the record again. */
  onDeposit: () => void;
}) {
  const key = feeDepositKey(item);
  const {
    mounted,
    saved,
    storedPending,
    pending,
    setPending,
    storageError,
    remember,
    clear,
    clearUnreadable,
  } = usePendingWalletAttempt<Pending>(
    key,
    (raw) => readPending(raw, item, tables),
    (error) => errorMessage(error, "The wallet request failed."),
  );
  const [wallet, setWallet] = useState<VaultConnection | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [review, setReview] = useState<{ way: FeeWay; facts: Review } | null>(
    null,
  );
  const [notice, setNotice] = useState("");
  const [deposited, setDeposited] = useState(() => readDeposited(item));
  const [now, setNow] = useState(() => Date.now());
  // The stored record is still unpaid and this tab's final deposit is recent.
  const awaitingRecord =
    deposited !== null &&
    ways.length > 0 &&
    now - deposited.at < RECORD_WAIT_MS;
  useEffect(() => {
    if (!awaitingRecord) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [awaitingRecord]);
  const [recoveryHash, setRecoveryHash] = useState(saved.pending?.hash ?? "");
  const wallets = usePayoutWallets().filter((entry) => entry.family === "evm");
  const { busy, error, setError, run: act } = useAction(saved.error || null);
  /** True while the shown error came from an automatic check, not a click. */
  const autoErrored = useRef(false);
  const run = (action: () => Promise<void>) => {
    setNotice("");
    autoErrored.current = false;
    return act(action, (caught) =>
      errorMessage(caught, "The wallet request failed."),
    );
  };
  const way =
    pending?.way ??
    ways.find((entry) => wayKey(entry) === chosen) ??
    ways[0] ??
    null;
  const connect = (provider: PayoutWallet) =>
    run(async () => {
      const connection = await provider.connect();
      if (!mounted.current) return;
      if (
        pending &&
        connection.address.toLowerCase() !== pending.wallet.toLowerCase()
      )
        throw new Error(
          `Reconnect the wallet that submitted this payment: ${pending.wallet}`,
        );
      setWallet(connection);
      setReview(null);
    });
  const inspect = () =>
    run(async () => {
      if (!wallet || !way) throw new Error("Choose a wallet first.");
      await switchFeeChain(way, wallet);
      const facts = await reviewFeeDeposit({ way, item }, wallet);
      if (mounted.current) setReview({ way, facts });
    });
  const send = (step: Step) =>
    run(async () => {
      if (!wallet || !review || pending || storageError) return;
      const earlier = readDeposited(item);
      if (earlier && Date.now() - earlier.at < RECORD_WAIT_MS)
        throw new Error(
          `A deposit from this browser tab is already on chain for this ${subject}. Nothing was sent.`,
        );
      const reviewed = review.way;
      // Someone else may have paid, or the SLOP amount may have changed.
      await confirmDue(reviewed);
      const intent: Pending = {
        attemptId: crypto.randomUUID(),
        version: 1,
        wallet: wallet.address,
        way: reviewed,
        item,
        step,
        hash: null,
      };
      let requested = false;
      try {
        const beforeSend = () => {
          if (!mounted.current)
            throw new Error(
              "The wallet view was closed. Review before sending.",
            );
          if (!remember(intent))
            throw new Error(
              "The saved request changed. Reload before continuing.",
            );
          if (mounted.current) setRecoveryHash("");
          requested = true;
        };
        const deposit = { way: reviewed, item };
        const reference =
          step === "batch"
            ? await sendFeeBatch(deposit, wallet, beforeSend)
            : await sendFeeDeposit(deposit, wallet, step, beforeSend);
        // A batch returns the wallet's reference, not a transaction hash.
        const submitted: Pending =
          step === "batch"
            ? { ...intent, batchId: reference }
            : { ...intent, hash: reference, hashSource: "wallet" };
        const kept = step === "batch" ? "batch reference" : "hash";
        try {
          if (!remember(submitted, intent) && mounted.current)
            setNotice(
              `Submitted ${reference}. Keep this ${kept}; the saved request changed.`,
            );
        } catch {
          if (mounted.current) {
            setPending(submitted);
            setNotice(
              `Submitted ${reference}. Keep this ${kept}; browser storage could not save it.`,
            );
          }
        }
        if (mounted.current) setReview(null);
      } catch (caught) {
        if (caught instanceof VaultBatchUnavailable) {
          // The wallet refused before sending: offer the two separate requests.
          if (requested) {
            if (mounted.current) clear(intent);
            else clearPendingAttempt(key, intent);
          }
          if (mounted.current)
            setReview({ ...review, facts: { ...review.facts, batch: false } });
          throw caught;
        }
        if ((caught as { code?: unknown } | null)?.code === 4001) {
          if (requested) {
            if (mounted.current) clear(intent);
            else clearPendingAttempt(key, intent);
          }
          throw new Error("You declined the wallet request. Nothing was sent.");
        }
        if (requested)
          throw new Error(
            "The wallet result is unclear. Check wallet activity and enter its transaction hash below before another attempt.",
          );
        throw caught;
      }
    });
  const checking = useRef(false);
  /** Whether the notice now says the deposit arrived but is not final. */
  const receivedShown = useRef(false);
  /**
   * Reads the chain for the pending request. An automatic check signs nothing,
   * shows no busy state and leaves the notice alone while the result is pending.
   */
  const verify = async (automatic: boolean) => {
    if (!pending || !wallet || checking.current) return;
    checking.current = true;
    try {
      let captured = storedPending.current;
      if (!captured)
        throw new Error("The saved request changed. Reload before continuing.");
      const deposit = { way: pending.way, item };
      // A click may ask the wallet to move to the fee's network; a timer never does.
      if (!automatic) await switchFeeChain(pending.way, wallet);
      const entered =
        pending.hashSource === "wallet" ? pending.hash : recoveryHash.trim();
      let hash = entered ?? "";
      let fromWallet = pending.hashSource === "wallet";
      let result: FeeDepositStatus;
      if (pending.step === "batch") {
        if (!entered && !pending.batchId)
          throw new Error("Enter the transaction from your wallet.");
        const checked = await checkFeeBatch(
          deposit,
          wallet,
          pending.batchId ?? null,
          entered || null,
        );
        if (!mounted.current) return;
        result = checked.status;
        hash = checked.transactionId ?? "";
        if (!entered && checked.transactionId) {
          // The wallet named the batch transaction: fix it like a returned hash.
          const named: Pending = {
            ...pending,
            hash: checked.transactionId,
            hashSource: "wallet",
          };
          fromWallet = true;
          let stored = false;
          try {
            stored = updatePendingRecord(key, captured, named);
          } catch {
            // Storage refused the write; this view still names the transaction.
            if (result === "pending" || result === "received")
              setPending(named);
          }
          if (stored) {
            captured = named;
            storedPending.current = named;
            if (result === "pending" || result === "received")
              setPending(named);
          }
        }
      } else {
        if (!hash) throw new Error("Enter the transaction from your wallet.");
        result = await checkFeeDeposit(deposit, wallet, hash, pending.step);
        if (!mounted.current) return;
      }
      if (result === "pending" || result === "received") {
        // In a canonical block but not final: say it arrived, keep the saved
        // request and keep checking.
        const waitingNotice =
          fromWallet || pending.batchId
            ? "Submitted. Waiting for the transaction to reach a block."
            : "Waiting for the transaction to reach a block.";
        if (result === "received" && !receivedShown.current) onDeposit();
        if (automatic) {
          // The check works again: withdraw the error an earlier one showed.
          if (autoErrored.current) setError(null);
          autoErrored.current = false;
          if (result === "received") {
            receivedShown.current = true;
            setNotice(receivedNotice(pending.way, hash, subject));
          } else if (receivedShown.current) {
            // The block that carried it was replaced; it is pending again.
            receivedShown.current = false;
            setNotice(waitingNotice);
          }
          return;
        }
        if (!fromWallet && hash) {
          const candidate: Pending = {
            ...pending,
            hash,
            hashSource: "recovery",
          };
          let stored: boolean;
          try {
            stored = updatePendingRecord(key, captured, candidate);
          } catch {
            setPending(candidate);
            setNotice(`Not saved on this device. Keep this hash: ${hash}.`);
            return;
          }
          if (!stored)
            throw new Error(
              "The saved request changed. Reload before continuing.",
            );
          storedPending.current = candidate;
          setPending(candidate);
        }
        receivedShown.current = result === "received";
        setNotice(
          result === "received"
            ? receivedNotice(pending.way, hash, subject)
            : waitingNotice,
        );
        return;
      }
      receivedShown.current = false;
      clear(captured);
      setRecoveryHash("");
      setReview(null);
      if (automatic) setError(null);
      autoErrored.current = false;
      if (result === "failed")
        setNotice(
          "The transaction failed and no tokens moved. Review the payment, then retry.",
        );
      else if (result === "not-sent")
        setNotice(
          "Your wallet reports that this request was not sent. Review the payment, then retry.",
        );
      else if (result === "approval-confirmed") {
        setNotice(
          "Token approval confirmed. Review the deposit to continue; nothing has been deposited yet.",
        );
        // Open the next review; a failed read leaves the form as it was.
        const next = await reviewFeeDeposit(deposit, wallet).catch(() => null);
        if (mounted.current && next && storedPending.current === null) {
          setChosen(wayKey(pending.way));
          setReview({ way: pending.way, facts: next });
        }
      } else {
        setNotice(
          `Deposit verified on the finalized ${networkLabel(pending.way.network)} chain. ${hash}`,
        );
        const made = { hash, network: pending.way.network, at: Date.now() };
        setDeposited(made);
        setNow(made.at);
        try {
          sessionStorage.setItem(depositedKey(item), JSON.stringify(made));
        } catch {
          // This view still holds it; only a reload forgets it.
        }
        onDeposit();
      }
    } finally {
      checking.current = false;
    }
  };
  const check = () => run(() => verify(false));
  const latestVerify = useRef(verify);
  useLayoutEffect(() => {
    latestVerify.current = verify;
  });
  // Only a hash this wallet interaction returned is checked automatically.
  const [autoCheck, setAutoCheck] = useState({
    hash: "",
    attempts: 0,
    ticks: 0,
  });
  const autoHash =
    wallet && !busy && !storageError && pending
      ? pending.hashSource === "wallet"
        ? pending.hash
        : (pending.batchId ?? null)
      : null;
  const autoAttempts = autoCheck.hash === autoHash ? autoCheck.attempts : 0;
  const autoTicks = autoCheck.ticks;
  useEffect(() => {
    if (autoHash === null || autoAttempts >= AUTO_CHECK_ATTEMPTS) return;
    const timer = window.setTimeout(
      () => {
        const done = (checked: boolean) => {
          if (mounted.current)
            setAutoCheck({
              hash: autoHash,
              attempts: autoAttempts + (checked ? 1 : 0),
              ticks: autoTicks + 1,
            });
        };
        // A hidden tab reads nothing and uses no attempt; the next tick retries.
        if (document.visibilityState === "hidden") done(false);
        else
          void latestVerify
            .current(true)
            .catch((caught) => {
              // Show why the check fails; the next attempt still runs and a
              // later success withdraws the message.
              if (!mounted.current) return;
              autoErrored.current = true;
              setError(errorMessage(caught, "The wallet request failed."));
            })
            .then(() => done(true));
      },
      autoAttempts < AUTO_CHECK_FAST_ATTEMPTS
        ? AUTO_CHECK_FAST_MS
        : AUTO_CHECK_SLOW_MS,
    );
    return () => window.clearTimeout(timer);
  }, [autoHash, autoAttempts, autoTicks, mounted, setError]);
  const link = pending
    ? transactionUrl(pending.way.network, pending.hash)
    : null;
  const facts = review?.facts;
  return (
    <section
      className="admin-card vault-actions"
      aria-label={WORDS[subject].label}
    >
      <h2>Pay from a wallet</h2>
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
      {deposited && ways.length > 0 && !awaitingRecord ? (
        <p>
          Slop did not record this tab's earlier deposit within an hour, so{" "}
          {WORDS[subject].uncounted}. A deposit that does not count is sent back
          to the wallet that paid it.
        </p>
      ) : null}
      {pending || (ways.length > 0 && !awaitingRecord) ? (
        <WalletConnection
          address={wallet?.address ?? null}
          wallets={wallets}
          disabled={busy || storageError}
          className="admin-fieldset"
          legend={
            pending ? "Reconnect to check this transaction" : "Choose a wallet"
          }
          empty={<NoWalletFound solana={false} />}
          onConnect={(provider) => void connect(provider)}
        />
      ) : null}
      {pending ? (
        <PendingWalletCheck
          link={link}
          hashSource={pending.hashSource}
          solana={false}
          recoveryHash={recoveryHash}
          onRecoveryHash={setRecoveryHash}
          busy={busy}
          canCheck={!!wallet}
          onCheck={() => void check()}
          unsent={!pending.hash && !pending.batchId && !recoveryHash.trim()}
          onClear={() =>
            void run(async () => {
              clear(storedPending.current ?? pending);
              setReview(null);
              setNotice("Local request cleared. Review again before sending.");
            })
          }
        >
          <p>
            {pending.step === "send" || pending.step === "batch"
              ? "Deposit"
              : "Token approval"}{" "}
            awaiting verification. Do not send it again.
          </p>
          <p>
            {feeAmountText(pending.way)} on {networkLabel(pending.way.network)}
          </p>
        </PendingWalletCheck>
      ) : awaitingRecord ? (
        <p>
          The deposit from this browser tab is final on chain, and Slop has not
          recorded it yet. That usually takes a few minutes, and this page reads
          the record again by itself. Do not pay again.{" "}
          <a
            href={
              transactionUrl(deposited.network, deposited.hash) ?? undefined
            }
            target="_blank"
            rel="noreferrer"
          >
            Deposit transaction
          </a>
        </p>
      ) : wallet && way && !storageError ? (
        <>
          <fieldset className="admin-fieldset" disabled={busy}>
            <fieldset className="vault-operation">
              <legend>Pay with</legend>
              {ways.map((entry) => (
                <label key={wayKey(entry)}>
                  <input
                    type="radio"
                    name={`fee-way-${item}`}
                    value={wayKey(entry)}
                    checked={wayKey(entry) === wayKey(way)}
                    onChange={() => {
                      setChosen(wayKey(entry));
                      setReview(null);
                    }}
                  />
                  <span>
                    {feeAmountText(entry)} on {networkLabel(entry.network)}
                  </span>
                </label>
              ))}
            </fieldset>
            <button
              type="button"
              className="button secondary-button"
              onClick={() => void inspect()}
            >
              Review deposit
            </button>
          </fieldset>
          {review && facts ? (
            <section aria-label="Review deposit">
              <dl className="vault-addresses">
                <div>
                  <dt>Amount</dt>
                  <dd>{feeAmountText(review.way)}</dd>
                </div>
                <div>
                  <dt>Network</dt>
                  <dd>{networkLabel(review.way.network)}</dd>
                </div>
                <div>
                  <dt>Deposit contract</dt>
                  <dd>
                    <code>{review.way.contract}</code>
                  </dd>
                </div>
                <div>
                  <dt>Token</dt>
                  <dd>
                    <code>{review.way.token}</code>
                  </dd>
                </div>
                <div>
                  <dt>If kept, it goes to</dt>
                  <dd>
                    {keptToText(review.way.kind)}{" "}
                    <code>{review.way.keptTo}</code>
                  </dd>
                </div>
                <div>
                  <dt>Refund goes to</dt>
                  <dd>
                    <code>{wallet.address}</code>
                  </dd>
                </div>
              </dl>
              {facts.resetAllowance && !facts.batch ? (
                <p>Reset the existing token allowance to zero first.</p>
              ) : null}
              <button
                type="button"
                className="button primary-button"
                disabled={busy}
                onClick={() =>
                  void send(
                    facts.batch
                      ? "batch"
                      : facts.resetAllowance
                        ? "reset"
                        : facts.approvalNeeded
                          ? "approve"
                          : "send",
                  )
                }
              >
                {facts.batch
                  ? "Approve and deposit in wallet"
                  : facts.resetAllowance
                    ? "Reset token allowance in wallet"
                    : facts.approvalNeeded
                      ? "Approve exact token amount in wallet"
                      : "Confirm deposit in wallet"}
              </button>
            </section>
          ) : null}
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => {
              setWallet(null);
              setReview(null);
            }}
          >
            Choose another wallet
          </button>
        </>
      ) : null}
      {busy && <p role="status">Waiting for wallet or chain response…</p>}
    </section>
  );
}
