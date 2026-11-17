import { useEffect, useRef, useState } from "react";
import { errorMessage } from "./lib/errors";
import {
  ESCROW_NETWORKS,
  type EscrowDeployment,
} from "./lib/escrow-policy.mjs";
import {
  checkLockRelease,
  checkMonthLock,
  type MonthLockReview,
  reviewMonthLock,
  sendLockRelease,
  sendMonthLock,
} from "./lib/evm-month-lock";
import { checkVaultBatch, type VaultConnection } from "./lib/evm-vault-actions";
import { LOCK_MONTH_COUNTS, lockEnds, lockReleasable } from "./lib/month-lock";
import { networkLabel } from "./lib/network-names";
import { formatAssetAmount, formatBaseUnits } from "./lib/payments/contracts";
import { parseVaultAmount } from "./lib/payments/vault-amount";
import { type MonthPledge, monthName } from "./lib/pool-funding";
import {
  checkSolanaMonthLock,
  reviewSolanaLockRelease,
  reviewSolanaMonthLock,
  type SolanaMonthLockPlan,
  sendSolanaMonthLock,
} from "./lib/solana-month-lock";
import { useAction } from "./lib/use-action";

/** A sent lock or release is checked every 5 seconds for about an hour. */
const CHECK_MS = 5_000;
const CHECK_ATTEMPTS = 720;

const utcDay = (date: Date) =>
  new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);

const siteMonth = (period: number) =>
  `${String(period).slice(0, 4)}-${String(period).slice(4)}`;

/**
 * Months the vault keeps locked, from the finalized vault read. A lock whose
 * month was never reserved and whose payout window closed stays locked until
 * a release is sent; anyone may send it.
 */
export function LockedMonths({
  pledges,
  decimals,
  deployment,
  now,
  onRelease,
  releaseDisabled,
}: {
  pledges: readonly MonthPledge[];
  decimals: number;
  deployment: EscrowDeployment;
  now: Date;
  onRelease?: (period: string) => void;
  releaseDisabled?: boolean;
}) {
  const open = pledges.filter((pledge) => pledge.open);
  if (open.length === 0) return <p>No months are locked in this vault.</p>;
  const amount = (value: string) =>
    formatAssetAmount(value, {
      network: deployment.network,
      assetAddress: deployment.asset,
      assetDecimals: decimals,
    });
  return (
    <ul className="vault-locked-months">
      {open.map((pledge) =>
        lockReleasable(pledge.period, now) ? (
          <li key={pledge.period}>
            {monthName(pledge.period)}: {amount(pledge.amount)}, never reserved
            for payout. Release it to return it to the vault's free funds.{" "}
            {onRelease ? (
              <button
                type="button"
                className="button secondary-button"
                disabled={releaseDisabled}
                onClick={() => onRelease(pledge.period)}
              >
                Release {monthName(pledge.period)} in wallet
              </button>
            ) : null}
          </li>
        ) : (
          <li key={pledge.period}>
            {monthName(pledge.period)}: {amount(pledge.amount)}, locked until it
            is paid out. If it is never reserved for payout, it can be released
            from {utcDay(lockEnds(pledge.period))}.
          </li>
        ),
      )}
    </ul>
  );
}

type Review =
  | { family: "evm"; review: MonthLockReview }
  | { family: "solana"; plan: SolanaMonthLockPlan };
type Sent =
  | { kind: "evm-lock"; id: string; review: MonthLockReview }
  | {
      kind: "evm-batch";
      id: string;
      review: MonthLockReview;
      transactionId: string | null;
    }
  | { kind: "evm-release"; id: string; period: string }
  | { kind: "solana"; id: string; plan: SolanaMonthLockPlan };

/**
 * The owner locks this month and the next ones in a vault with month locks
 * (operator decision, 15 November 2026). Each locked month's amount stays in
 * the vault until that month is paid out; a lock that was never reserved can
 * be released once its payout window closes.
 */
export function VaultMonthLock({
  projectId,
  deployment,
  wallet,
  pledges,
  decimals,
  monthlyMinor,
  onLocked,
}: {
  projectId: string;
  deployment: EscrowDeployment;
  /** The wallet connected in the vault's funding form. */
  wallet: VaultConnection | null;
  pledges: readonly MonthPledge[];
  decimals: number;
  /** The project's monthly amount: the smallest lock that funds a month. */
  monthlyMinor: bigint;
  onLocked: () => void;
}) {
  const solana = ESCROW_NETWORKS[deployment.network].family === "solana";
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
  const [review, setReview] = useState<Review | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
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
    (solana
      ? wallet.address === deployment.owner
      : wallet.address.toLowerCase() === deployment.owner.toLowerCase());
  const formatted = (value: string) =>
    formatAssetAmount(value, {
      network: deployment.network,
      assetAddress: deployment.asset,
      assetDecimals: decimals,
    });
  const declined = (caught: unknown, requested: boolean) => {
    if ((caught as { code?: unknown } | null)?.code === 4001)
      return new Error("You declined the wallet request. Nothing was sent.");
    if (requested)
      return new Error(
        "The wallet result is unclear. Check wallet activity before another attempt.",
      );
    return caught;
  };

  const inspect = () =>
    run(
      async () => {
        setNotice("");
        if (!wallet) throw new Error("Connect the vault owner's wallet first.");
        if (parseVaultAmount(amount, decimals) < monthlyMinor)
          throw new Error(
            "Lock at least the project's monthly amount, or the month is not funded.",
          );
        const result: Review = solana
          ? {
              family: "solana",
              plan: await reviewSolanaMonthLock(
                projectId,
                deployment,
                wallet,
                count,
                amount,
              ),
            }
          : {
              family: "evm",
              review: await reviewMonthLock({
                deployment,
                wallet,
                count,
                amount,
                minimumMinor: monthlyMinor,
                deposit,
              }),
            };
        if (mounted.current) setReview(result);
      },
      (caught) => errorMessage(caught, "The lock could not be reviewed."),
    );
  const send = () =>
    run(
      async () => {
        if (!wallet || !review) return;
        let requested = false;
        const beforeSend = () => {
          requested = true;
        };
        try {
          let next: Sent;
          if (review.family === "solana")
            next = {
              kind: "solana",
              id: await sendSolanaMonthLock(
                deployment,
                wallet,
                review.plan,
                beforeSend,
              ),
              plan: review.plan,
            };
          else {
            const result = await sendMonthLock(
              deployment,
              wallet,
              review.review,
              beforeSend,
            );
            next =
              result.kind === "batch"
                ? {
                    kind: "evm-batch",
                    id: result.id,
                    review: review.review,
                    transactionId: null,
                  }
                : { kind: "evm-lock", id: result.id, review: review.review };
          }
          if (!mounted.current) return;
          setSent(next);
          setReview(null);
          setNotice(
            next.kind === "evm-batch"
              ? "Deposit and lock sent. Checking the chain."
              : "Lock sent. Checking the chain.",
          );
        } catch (caught) {
          throw declined(caught, requested);
        }
      },
      (caught) => errorMessage(caught, "The wallet request failed."),
    );
  const release = (period: string) =>
    run(
      async () => {
        setNotice("");
        if (!wallet) throw new Error("Connect a wallet first.");
        let requested = false;
        const beforeSend = () => {
          requested = true;
        };
        try {
          let next: Sent;
          if (solana) {
            const plan = await reviewSolanaLockRelease(
              projectId,
              deployment,
              wallet,
              period,
            );
            next = {
              kind: "solana",
              id: await sendSolanaMonthLock(
                deployment,
                wallet,
                plan,
                beforeSend,
              ),
              plan,
            };
          } else
            next = {
              kind: "evm-release",
              id: await sendLockRelease(deployment, wallet, period, beforeSend),
              period,
            };
          if (!mounted.current) return;
          setSent(next);
          setNotice(
            `Release of ${monthName(period)} sent. Checking the chain.`,
          );
        } catch (caught) {
          throw declined(caught, requested);
        }
      },
      (caught) => errorMessage(caught, "The release could not be sent."),
    );

  const [attempts, setAttempts] = useState(0);
  useEffect(() => {
    if (!sent || !wallet || attempts >= CHECK_ATTEMPTS) return;
    const timer = window.setTimeout(async () => {
      const done = (text: string) => {
        setSent(null);
        setNotice(text);
        onLocked();
      };
      const failed = (text: string) => {
        setSent(null);
        setNotice("");
        setError(text);
      };
      try {
        if (sent.kind === "evm-batch") {
          const status = await checkVaultBatch(
            deployment,
            wallet,
            sent.review.deposit?.gross ?? "0",
            sent.transactionId ? null : sent.id,
            sent.transactionId,
          );
          if (!mounted.current) return;
          if (status.status === "failed" || status.status === "not-sent")
            return failed(
              "The deposit and lock were not completed. Nothing was locked.",
            );
          if (status.status === "finalized")
            return done("Deposited and locked. The locked months show here.");
          if (status.transactionId !== sent.transactionId)
            setSent({ ...sent, transactionId: status.transactionId });
        } else {
          const status =
            sent.kind === "solana"
              ? await checkSolanaMonthLock(
                  projectId,
                  deployment,
                  wallet,
                  sent.plan,
                  sent.id,
                )
              : sent.kind === "evm-release"
                ? await checkLockRelease(
                    deployment,
                    wallet,
                    sent.period,
                    sent.id,
                  )
                : await checkMonthLock(
                    deployment,
                    wallet,
                    sent.review,
                    sent.id,
                  );
          if (!mounted.current) return;
          const releasing =
            sent.kind === "evm-release" ||
            (sent.kind === "solana" && sent.plan.action === "release");
          if (status === "failed")
            return failed(
              releasing
                ? "The release failed. The month is still locked."
                : "The lock transaction failed. Nothing was locked.",
            );
          if (status !== "pending")
            return done(
              releasing
                ? "Released. The vault's free funds update once the block is final."
                : "Locked. The locked months show here once the block is final.",
            );
        }
      } catch (caught) {
        if (mounted.current)
          setError(
            errorMessage(caught, "The transaction could not be checked."),
          );
      }
      if (mounted.current) setAttempts((value) => value + 1);
    }, CHECK_MS);
    return () => window.clearTimeout(timer);
  }, [sent, wallet, attempts, deployment, projectId, onLocked, setError]);

  const reviewedPeriods =
    review?.family === "solana"
      ? review.plan.requested.map(siteMonth)
      : (review?.review.periods ?? []);
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
        now={new Date()}
        onRelease={
          wallet && !sent ? (period) => void release(period) : undefined
        }
        releaseDisabled={busy}
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
        <p>Waiting for the chain. Do not send it again.</p>
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
            {solana ? null : (
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
            )}
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
                  {reviewedPeriods.length === 1
                    ? monthName(reviewedPeriods[0])
                    : `${monthName(reviewedPeriods[0])} to ${monthName(reviewedPeriods.at(-1) as string)}`}
                </dd>
                <dt>Locked each month</dt>
                <dd>
                  {formatted(
                    review.family === "solana"
                      ? review.plan.amountMinor
                      : review.review.amountMinor,
                  )}
                </dd>
                {review.family === "evm" ? (
                  <>
                    <dt>Added to locked funds</dt>
                    <dd>{formatted(review.review.addedMinor)}</dd>
                  </>
                ) : null}
                {review.family === "evm" && review.review.deposit ? (
                  <>
                    <dt>Deposit</dt>
                    <dd>{formatted(review.review.deposit.gross)}</dd>
                  </>
                ) : null}
              </dl>
              {review.family === "solana" &&
              review.plan.transaction === null ? (
                <p>These months are already locked at this amount.</p>
              ) : (
                <>
                  <p>
                    A locked month cannot be withdrawn or lowered. It stays in
                    the vault until it is paid out. A month never reserved for
                    payout can be released from{" "}
                    {utcDay(lockEnds(reviewedPeriods.at(-1) as string))}.
                  </p>
                  <button
                    type="button"
                    className="button primary-button"
                    disabled={busy}
                    onClick={() => void send()}
                  >
                    {review.family === "evm" && review.review.deposit
                      ? "Deposit and lock in wallet"
                      : "Confirm lock in wallet"}
                  </button>
                </>
              )}
            </section>
          ) : null}
        </>
      )}
      {busy && <p role="status">Waiting for wallet or chain response…</p>}
    </section>
  );
}
