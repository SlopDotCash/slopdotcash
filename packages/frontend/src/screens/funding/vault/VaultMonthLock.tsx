// spec/frontend/monthLock.md, "Story: Lock months from the owner's wallet"; spec/frontend/monthLock.md, "The card appears only once the finalized read shows pledge support"; spec/frontend/monthLock.md, "A review runs the lock refusals against the card's own read, and only the owner's accepted review can be sent"; spec/frontend/monthLock.md, "A lapsed month stays locked until any connected wallet sends its release"; spec/frontend/monthLock.md, "A failed transaction locks or releases nothing, and an included one waits for the finalized read before the card shows it"; spec/frontend/vaultLocks.md, "A lock covers its count of months from the vault's current month, and an unreserved month is releasable from 00:00 UTC on the 4th of the second month after it"
import { formatBaseUnits, fromAmount, toAmount } from "@repo/settlement/kernels/amounts";
import { Alert, Button, Card, CardTitle, Field, Input, RadioGroup, Status } from "@repo/ui";
import { Effect } from "effect";
import { useState } from "react";
import type { LockNotice, MonthLock } from "../../../../gen/frontend__monthLock.ts";
import { useMachine } from "../../../../gen/frontend__monthLock.react.ts";
import { type LockRefusal, lockedLine, noLockedMonthsText } from "../../../../gen/frontend__vaultLocks.ts";
import { lockMonthCounts } from "../../../../gen/settlement__monthPledges.ts";
import { formatAssetAmount, networkLabel } from "../../../kernels/assetText.ts";
import type { FundingVault } from "../../../kernels/poolFunding.ts";
import { familyOf } from "../../../wallets/owner/commitments.vibe";
import { monthName, releaseDay, siteMonth } from "../../../wallets/owner/monthLockPeriods.ts";
import { type Connection, vaultRuntime } from "./funding.vibe";
import { useNow } from "../../../app/hooks.ts";
import { useAction } from "./hooks.ts";
import { type LockReview, connectCard, readCard, releaseCard, reviewCard, sendCard, sendsDeposit, watchCard } from "./monthLock.vibe";
import type { FundingDeployment, FundingProject } from "./project.schema.ts";
import { useFollowed } from "./VaultActions.tsx";

export type VaultMonthLockProps = {
  /** The project whose vault this is. */
  project: FundingProject;
  /** The registered vault on one network. */
  deployment: FundingDeployment;
  /** The UTC month, `YYYY-MM`, of the page's vault runtime. */
  period: string;
  /** The vault's row in the cached finalized pool-funding read. */
  row: FundingVault;
  /** The vault's free funds in the finalized totals snapshot, or null where it reports none. */
  free: bigint | null;
  /** The vault asset's decimals from the totals snapshot. */
  decimals: number;
  /** The wallet connected in the vault's funding form. */
  wallet: Connection | undefined;
  /** The project's monthly amount: the smallest lock that funds a month. */
  monthlyMinor: bigint;
  /** Called once a lock or release is included, to read the vault again. */
  onLocked: () => void;
};

const refusalText: Readonly<Record<Exclude<LockRefusal, "NoLockRefusal" | "LowersLockedMonth">, string>> = {
  LockCountRefused: "Choose 1, 3, 6 or 12 months.",
  NotVaultOwner: "Only the vault owner's wallet can lock months.",
  BelowMonthlyAmount: "Lock at least the project's monthly amount, or the month is not funded.",
  FreeFundsShort: "The vault's free funds cannot cover these months. Deposit more first, or lock fewer months.",
  DepositNotBatched: "Your wallet cannot send the deposit and the lock as one request. Deposit first, then lock.",
};

function refusalOf(refusal: LockRefusal, review: LockReview | undefined): string | undefined {
  if (refusal === "NoLockRefusal") return undefined;
  if (refusal !== "LowersLockedMonth") return refusalText[refusal];
  const lowered = review?.existing.find((month) => month.open && month.amount > review.amountMinor);
  return `${lowered === undefined ? "A month" : siteMonth(lowered.period)} is already locked at a higher amount. A lock can be raised, never lowered.`;
}

function noticeOf(state: MonthLock, releasing: number | undefined): string {
  const deposit = sendsDeposit(state);
  const release = state.kind === "ReleasingMonth";
  const texts: Readonly<Record<LockNotice, string>> = {
    LockQuiet: "",
    LockSentNotice: release ? `Release of ${releasing === undefined ? "the month" : monthName(releasing)} sent. Checking the chain.` : deposit ? "Deposit and lock sent. Checking the chain." : "Lock sent. Checking the chain.",
    WalletDeclinedNotice: "You declined the wallet request. Nothing was sent.",
    WalletUnclearNotice: "The wallet result is unclear. Check wallet activity before another attempt.",
    LockFailedNotice: deposit ? "The deposit and lock were not completed. Nothing was locked." : "The lock transaction failed. Nothing was locked.",
    ReleaseFailedNotice: "The release failed. The month is still locked.",
    LockedNotice: deposit ? "Deposited and locked. The locked months show here." : "Locked. The locked months show here once the block is final.",
    ReleasedNotice: "Released. The vault's free funds update once the block is final.",
    CheckUnreadableNotice: "The transaction could not be checked.",
  };
  return texts[state.notice];
}

export function VaultMonthLock({ project, deployment, period, row, free, decimals, wallet, monthlyMinor, onLocked }: VaultMonthLockProps) {
  const runtime = vaultRuntime(project, deployment, period);
  const lock = useMachine(runtime);
  const nowSeconds = Math.floor(useNow() / 1000);
  const readKey = [row.openPledgedGross ?? "none", free ?? "none", ...(row.pledges ?? []).map((pledge) => `${pledge.period}:${pledge.amount}:${pledge.open}`)].join(",");
  useFollowed(runtime, `lock-read:${readKey}`, () => readCard(row, free, nowSeconds));
  useFollowed(runtime, `lock-connect:${wallet?.address ?? ""}`, () => (wallet === undefined ? Effect.void : connectCard(wallet)));
  const { busy, error, act } = useAction(runtime);
  const open = (row.pledges ?? []).filter((pledge) => pledge.open);
  const highest = open.reduce((most, pledge) => (pledge.amount > most ? pledge.amount : most), monthlyMinor);
  const [count, setCount] = useState(1);
  const [amount, setAmount] = useState(formatBaseUnits({ value: highest, decimals, grouping: false }));
  const [deposit, setDeposit] = useState("");
  const [review, setReview] = useState<LockReview>();
  const [releasing, setReleasing] = useState<number>();
  const state = lock.state;
  if (state === undefined || state.phase === "LockHidden") return null;
  const solana = familyOf(deployment) === "solana";
  const network = networkLabel(deployment.network);
  const owner = wallet !== undefined && (solana ? wallet.address === deployment.owner : wallet.address.toLowerCase() === deployment.owner.toLowerCase());
  const checking = state.phase === "LockAwaiting" || state.phase === "LockChecking";
  const formatted = (value: bigint) => formatAssetAmount(value, { network: deployment.network, assetAddress: deployment.asset, assetDecimals: decimals });
  const refusal = refusalOf(state.refusal, review);
  const notice = noticeOf(state, releasing);
  const watch = (connection: Connection) => runtime.runFork(watchCard(connection, Effect.sync(onLocked)));
  const edited = (change: () => void) => {
    change();
    setReview(undefined);
  };
  const months = review?.periods ?? [];
  const first = months[0];
  const last = months.at(-1);

  return (
    <Card className="flex flex-col gap-4" aria-label={`Lock months · ${network}`}>
      <CardTitle>Lock months · {network}</CardTitle>
      <p className="text-sm text-foreground">Locked in this vault: {formatted(fromAmount(state.shownLocked))}</p>
      {open.length === 0 ? (
        <p className="text-sm text-muted-foreground">{noLockedMonthsText}</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm text-foreground">
          {open.map((pledge) =>
            lockedLine({ period: pledge.period, amount: toAmount(pledge.amount), open: pledge.open }, nowSeconds) === "ReleasableMonth" ? (
              <li key={pledge.period} className="flex flex-wrap items-center gap-2">
                <span>
                  {monthName(pledge.period)}: {formatted(pledge.amount)}, never reserved for payout. Release it to return it to the vault's free funds.
                </span>
                {wallet !== undefined && !checking ? (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      setReleasing(pledge.period);
                      void act(releaseCard(wallet, pledge.period, pledge.amount), () => watch(wallet));
                    }}
                  >
                    Release {monthName(pledge.period)} in wallet
                  </Button>
                ) : null}
              </li>
            ) : (
              <li key={pledge.period}>
                {monthName(pledge.period)}: {formatted(pledge.amount)}, locked until it is paid out. If it is never reserved for payout, it can be released from {releaseDay(pledge.period)}.
              </li>
            ),
          )}
        </ul>
      )}
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {refusal ? <Alert variant="destructive">{refusal}</Alert> : null}
      {notice ? <Alert variant="info">{notice}</Alert> : null}
      {!owner ? (
        <p className="text-sm text-muted-foreground">{wallet === undefined ? "Connect the vault owner's wallet first." : "Only the vault owner's wallet can lock months."}</p>
      ) : checking ? (
        <p className="text-sm text-muted-foreground">Waiting for the chain. Do not send it again.</p>
      ) : (
        <>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void act(reviewCard(wallet, count, amount, solana ? "" : deposit, monthlyMinor), setReview);
            }}
          >
            <RadioGroup
              legend="Months"
              value={String(count)}
              disabled={busy}
              options={lockMonthCounts.map((value) => ({ value: String(value), label: value === 1 ? "This month" : `${value} months` }))}
              onValueChange={(value) => edited(() => setCount(Number(value)))}
            />
            <Field label="Amount per month">
              <Input inputMode="decimal" value={amount} disabled={busy} onChange={(event) => edited(() => setAmount(event.target.value))} />
            </Field>
            {solana ? null : (
              <Field label="Deposit in the same request (optional)">
                <Input inputMode="decimal" value={deposit} disabled={busy} onChange={(event) => edited(() => setDeposit(event.target.value))} />
              </Field>
            )}
            <Button type="submit" variant="secondary" loading={busy} disabled={amount.trim() === ""}>
              Review lock
            </Button>
          </form>
          {review && state.phase === "LockReviewed" && first !== undefined && last !== undefined ? (
            <section aria-label="Review month lock" className="flex flex-col gap-3">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Months</dt>
                <dd className="text-foreground">{first === last ? monthName(first) : `${monthName(first)} to ${monthName(last)}`}</dd>
                <dt className="text-muted-foreground">Locked each month</dt>
                <dd className="text-foreground tabular-nums">{formatted(review.amountMinor)}</dd>
                {solana ? null : (
                  <>
                    <dt className="text-muted-foreground">Added to locked funds</dt>
                    <dd className="text-foreground tabular-nums">{formatted(fromAmount(state.added))}</dd>
                  </>
                )}
                {review.depositGross > 0n ? (
                  <>
                    <dt className="text-muted-foreground">Deposit</dt>
                    <dd className="text-foreground tabular-nums">{formatted(review.depositGross)}</dd>
                  </>
                ) : null}
              </dl>
              {review.alreadyLocked ? (
                <p className="text-sm text-foreground">These months are already locked at this amount.</p>
              ) : (
                <>
                  <p className="text-sm text-foreground">
                    A locked month cannot be withdrawn or lowered. It stays in the vault until it is paid out. A month never reserved for payout can be released from {releaseDay(last)}.
                  </p>
                  <Button
                    loading={busy}
                    onClick={() =>
                      act(sendCard(wallet), (after) => {
                        setReview(undefined);
                        if (after.phase === "LockChecking") watch(wallet);
                      })
                    }
                  >
                    {review.depositGross > 0n ? "Deposit and lock in wallet" : "Confirm lock in wallet"}
                  </Button>
                </>
              )}
            </section>
          ) : null}
        </>
      )}
      {busy ? <Status presentation={{ tone: "Neutral", icon: "Spinner", label: "Waiting for wallet or chain response…" }} /> : null}
    </Card>
  );
}
