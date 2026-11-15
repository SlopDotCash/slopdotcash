import { useEffect, useRef, useState } from "react";
import { errorMessage } from "./lib/errors";
import type { EscrowDeployment } from "./lib/escrow-policy.mjs";
import {
  checkMonthLock,
  LOCK_MONTH_COUNTS,
  lockEnds,
  type MonthLockReview,
  reviewMonthLock,
  sendMonthLock,
} from "./lib/evm-month-lock";
import { checkVaultBatch, type VaultConnection } from "./lib/evm-vault-actions";
import { networkLabel } from "./lib/network-names";
import { formatAssetAmount, formatBaseUnits } from "./lib/payments/contracts";
import { type MonthPledge, monthName } from "./lib/pool-funding";
import { useAction } from "./lib/use-action";

/** A sent lock is checked every 5 seconds for about an hour. */
const CHECK_MS = 5_000;
const CHECK_ATTEMPTS = 720;

const utcDay = (date: Date) =>
  new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);

/** Months the vault keeps locked, from the finalized vault read. */
export function LockedMonths({
  pledges,
  decimals,
  deployment,
}: {
  pledges: readonly MonthPledge[];
  decimals: number;
  deployment: EscrowDeployment;
}) {
  const open = pledges.filter((pledge) => pledge.open);
  if (open.length === 0) return <p>No months are locked in this vault.</p>;
  return (
    <ul className="vault-locked-months">
      {open.map((pledge) => (
        <li key={pledge.period}>
          {monthName(pledge.period)}:{" "}
          {formatAssetAmount(pledge.amount, {
            network: deployment.network,
            assetAddress: deployment.asset,
            assetDecimals: decimals,
          })}
          , locked until it is paid out, and no later than{" "}
          {utcDay(lockEnds(pledge.period))}
        </li>
      ))}
    </ul>
  );
}

/**
 * The owner locks this month and the next ones in a vault with month locks
 * (operator decision, 15 November 2026). Each locked month's amount stays in
 * the vault until that month is paid out.
 */
export function VaultMonthLock({
  deployment,
  wallet,
  pledges,
  decimals,
  monthlyMinor,
  onLocked,
}: {
  deployment: EscrowDeployment;
  /** The wallet connected in the vault's funding form. */
  wallet: VaultConnection | null;
  pledges: readonly MonthPledge[];
  decimals: number;
  /** The project's monthly amount: the smallest lock that funds a month. */
  monthlyMinor: bigint;
  onLocked: () => void;
}) {
  const [count, setCount] = useState<number>(1);
  // A lock can only be raised: start at the monthly amount or the highest
  // month already locked, whichever is more.
  const highest = pledges
    .filter((pledge) => pledge.open)
    .reduce(
      (most, pledge) =>
        BigInt(pledge.amount) > most ? BigInt(pledge.amount) : most,
      monthlyMinor,
    );
  const [amount, setAmount] = useState(
    formatBaseUnits(highest.toString(), decimals, { grouping: false }),
  );
  const [deposit, setDeposit] = useState("");
  const [review, setReview] = useState<MonthLockReview | null>(null);
  const [sent, setSent] = useState<{
    kind: "transaction" | "batch";
    id: string;
    review: MonthLockReview;
    transactionId: string | null;
  } | null>(null);
  const [notice, setNotice] = useState("");
  const { busy, error, setError, run } = useAction("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const owner =
    wallet !== null &&
    wallet.address.toLowerCase() === deployment.owner.toLowerCase();
  const formatted = (value: string) =>
    formatAssetAmount(value, {
      network: deployment.network,
      assetAddress: deployment.asset,
      assetDecimals: decimals,
    });

  const inspect = () =>
    run(
      async () => {
        setNotice("");
        if (!wallet) throw new Error("Connect the vault owner's wallet first.");
        const result = await reviewMonthLock({
          deployment,
          wallet,
          count,
          amount,
          minimumMinor: monthlyMinor,
          deposit,
        });
        if (mounted.current) setReview(result);
      },
      (caught) => errorMessage(caught, "The lock could not be reviewed."),
    );
  const send = () =>
    run(
      async () => {
        if (!wallet || !review) return;
        let requested = false;
        try {
          const result = await sendMonthLock(deployment, wallet, review, () => {
            requested = true;
          });
          if (!mounted.current) return;
          setSent({ ...result, review, transactionId: null });
          setReview(null);
          setNotice(
            result.kind === "batch"
              ? "Deposit and lock sent. Checking the chain."
              : "Lock sent. Checking the chain.",
          );
        } catch (caught) {
          if ((caught as { code?: unknown } | null)?.code === 4001)
            throw new Error(
              "You declined the wallet request. Nothing was sent.",
            );
          if (requested)
            throw new Error(
              "The wallet result is unclear. Check wallet activity before another attempt; locking the same months again at the same amount changes nothing.",
            );
          throw caught;
        }
      },
      (caught) => errorMessage(caught, "The wallet request failed."),
    );

  const [attempts, setAttempts] = useState(0);
  useEffect(() => {
    if (!sent || !wallet || attempts >= CHECK_ATTEMPTS) return;
    const timer = window.setTimeout(async () => {
      try {
        if (sent.kind === "transaction") {
          const status = await checkMonthLock(
            deployment,
            wallet,
            sent.review,
            sent.id,
          );
          if (!mounted.current) return;
          if (status === "failed") {
            setSent(null);
            setNotice("");
            setError("The lock transaction failed. Nothing was locked.");
            return;
          }
          if (status === "included") {
            setSent(null);
            setNotice(
              "The lock is in a block. The locked months show here once the block is final.",
            );
            onLocked();
            return;
          }
        } else {
          const status = await checkVaultBatch(
            deployment,
            wallet,
            sent.review.deposit?.gross ?? "0",
            sent.transactionId ? null : sent.id,
            sent.transactionId,
          );
          if (!mounted.current) return;
          if (status.status === "failed" || status.status === "not-sent") {
            setSent(null);
            setNotice("");
            setError(
              "The deposit and lock were not completed. Nothing was locked.",
            );
            return;
          }
          if (status.status === "finalized") {
            setSent(null);
            setNotice("Deposited and locked. The locked months show here.");
            onLocked();
            return;
          }
          if (status.transactionId !== sent.transactionId)
            setSent({ ...sent, transactionId: status.transactionId });
        }
      } catch (caught) {
        if (mounted.current)
          setError(errorMessage(caught, "The lock could not be checked."));
      }
      if (mounted.current) setAttempts((value) => value + 1);
    }, CHECK_MS);
    return () => window.clearTimeout(timer);
  }, [sent, wallet, attempts, deployment, onLocked, setError]);

  return (
    <section
      className="admin-card vault-month-lock"
      aria-label={`Lock months · ${networkLabel(deployment.network)}`}
    >
      <h3>Lock months · {networkLabel(deployment.network)}</h3>
      <LockedMonths
        pledges={pledges}
        decimals={decimals}
        deployment={deployment}
      />
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!owner ? (
        <p>Connect the vault owner's wallet above to lock months.</p>
      ) : sent ? (
        <p>
          Waiting for{" "}
          {sent.kind === "batch" ? "the deposit and lock" : "the lock"}. Do not
          send it again.
        </p>
      ) : (
        <>
          <fieldset className="admin-fieldset" disabled={busy}>
            <label>
              Months
              <select
                value={count}
                onChange={(event) => {
                  setCount(Number(event.target.value));
                  setReview(null);
                }}
              >
                {LOCK_MONTH_COUNTS.map((value) => (
                  <option key={value} value={value}>
                    {value === 1 ? "This month" : `${value} months`}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Amount per month
              <input
                inputMode="decimal"
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setReview(null);
                }}
              />
            </label>
            <label>
              Deposit in the same request (optional)
              <input
                inputMode="decimal"
                value={deposit}
                onChange={(event) => {
                  setDeposit(event.target.value);
                  setReview(null);
                }}
              />
            </label>
            <button
              type="button"
              className="button secondary-button"
              onClick={() => void inspect()}
            >
              Review lock
            </button>
          </fieldset>
          {review ? (
            <section aria-label="Review month lock">
              <dl>
                <dt>Months</dt>
                <dd>
                  {review.periods.length === 1
                    ? monthName(review.periods[0])
                    : `${monthName(review.periods[0])} to ${monthName(review.periods.at(-1) as string)}`}
                </dd>
                <dt>Locked each month</dt>
                <dd>{formatted(review.amountMinor)}</dd>
                <dt>Added to locked funds</dt>
                <dd>{formatted(review.addedMinor)}</dd>
                {review.deposit ? (
                  <>
                    <dt>Deposit</dt>
                    <dd>{formatted(review.deposit.gross)}</dd>
                  </>
                ) : null}
              </dl>
              <p>
                A locked month cannot be withdrawn or lowered. It stays in the
                vault until it is paid out, or until{" "}
                {utcDay(lockEnds(review.periods.at(-1) as string))} if it is
                never reserved.
              </p>
              <button
                type="button"
                className="button primary-button"
                disabled={busy}
                onClick={() => void send()}
              >
                {review.deposit
                  ? "Deposit and lock in wallet"
                  : "Confirm lock in wallet"}
              </button>
            </section>
          ) : null}
        </>
      )}
      {busy && <p role="status">Waiting for wallet or chain response…</p>}
    </section>
  );
}
