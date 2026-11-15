import {
  decodeFunctionResult,
  encodeFunctionData,
  parseAbi,
  toFunctionSelector,
} from "viem";
import * as evmAdapter from "../../contracts/evm/adapter";
import type { EscrowDeployment } from "./escrow-policy.mjs";
import {
  assertVaultWalletAccount,
  readFinalizedWalletTransaction,
  reviewVaultAction,
  sendVaultBatch,
  type VaultConnection,
  walletVaultConfig,
} from "./evm-vault-actions";
import { chainMonth, LOCK_MONTH_COUNTS, lockPeriods } from "./month-lock";
import { parseVaultAmount } from "./payments/vault-amount";

export { LOCK_MONTH_COUNTS, lockEnds, lockPeriods } from "./month-lock";

/**
 * Month locks on an upgraded EVM vault (operator decision, 15 November 2026).
 * The owner pledges an amount for each of 1 to 12 months from the current
 * UTC month (`pledgeMonths`). The contract keeps a pledged month's amount in
 * the vault until the month is reserved for payout, or until the month's
 * commit window closes without a reservation.
 */

const pledgeAbi = parseAbi([
  "function openPledgedGross() view returns (uint128)",
  "function monthPledges(uint32) view returns (uint128 amount, bool open)",
  "function pledgeMonths(uint32 fromPeriod, uint8 count, uint128 amount)",
  "function currentPeriod() view returns (uint32)",
  "function expirePledge(uint32 period)",
]);

/** The contract's refusal of a withdrawal that would take locked funds. */
export const PLEDGED_FUNDS_SELECTOR = toFunctionSelector("PledgedFunds()");

type BuildExpire = (period: number) => `0x${string}`;

/**
 * `buildExpirePledgeCalldata` from the EVM adapter once the contract change
 * is merged; until then the frozen signature is encoded here.
 */
function expireCalldata(period: number) {
  const build = (
    evmAdapter as unknown as { buildExpirePledgeCalldata?: BuildExpire }
  ).buildExpirePledgeCalldata;
  return build
    ? build(period)
    : encodeFunctionData({
        abi: pledgeAbi,
        functionName: "expirePledge",
        args: [period],
      });
}

type BuildPledge = (
  fromPeriod: number,
  count: number,
  amountMinor: bigint,
) => `0x${string}`;

/**
 * `buildPledgeMonthsCalldata` comes from the EVM adapter once the contract
 * change is merged; until then the same frozen signature is encoded here.
 */
function pledgeCalldata(fromPeriod: number, count: number, amount: bigint) {
  const build = (
    evmAdapter as unknown as { buildPledgeMonthsCalldata?: BuildPledge }
  ).buildPledgeMonthsCalldata;
  return build
    ? build(fromPeriod, count, amount)
    : encodeFunctionData({
        abi: pledgeAbi,
        functionName: "pledgeMonths",
        args: [fromPeriod, count, amount],
      });
}

/** The text of a wallet or RPC error and everything nested in it. */
function errorText(caught: unknown): string[] {
  const seen = new Set<unknown>();
  const text: string[] = [];
  const collect = (value: unknown, depth: number) => {
    if (depth > 4 || value === null || seen.has(value)) return;
    if (typeof value === "string") text.push(value);
    if (typeof value !== "object") return;
    seen.add(value);
    for (const key of ["data", "message", "cause", "error", "details"])
      collect((value as Record<string, unknown>)[key], depth + 1);
  };
  collect(caught, 0);
  return text;
}

/** One of the contract's custom errors, by selector or by name. */
function contractError(caught: unknown, name: string): boolean {
  const selector = toFunctionSelector(`${name}()`);
  return errorText(caught).some(
    (part) => part.toLowerCase().includes(selector) || part.includes(name),
  );
}

const LOCKED_FUNDS =
  "These funds are locked for a month that has not been paid out yet. Withdraw only funds above the locked months.";

/** Plain words for the contract's refusal to release locked funds. */
export function pledgedFundsRefusal(caught: unknown): Error | null {
  return contractError(caught, "PledgedFunds") ? new Error(LOCKED_FUNDS) : null;
}

/** Plain words for the contract's refusal of a lock. */
export function lockRefusal(caught: unknown): Error | null {
  const words: [string, string][] = [
    [
      "PledgeTooLow",
      "A month in this range is already locked at a higher amount. A lock can be raised, never lowered.",
    ],
    [
      "InsufficientFreeBalance",
      "The vault's free funds cannot cover these months. Deposit more first, or lock fewer months.",
    ],
    [
      "InvalidInput",
      "The months changed while the lock was sent, for example at the start of a new month. Review the lock again.",
    ],
    [
      "MonthlyAlreadyCommitted",
      "A month in this range is already reserved for payout.",
    ],
    ["WrongPurpose", "This vault cannot lock months."],
    [
      "PledgeNotLapsed",
      "This month's lock cannot be released yet: its payout window is still open.",
    ],
  ];
  for (const [name, text] of words)
    if (contractError(caught, name)) return new Error(text);
  return null;
}

/**
 * True when the call reverted with no data: a vault contract without the
 * pledge functions. A wallet or RPC failure is not that.
 */
function emptyRevert(caught: unknown): boolean {
  const data = (caught as { data?: unknown } | null)?.data;
  const nested = (caught as { error?: { data?: unknown } } | null)?.error?.data;
  if (data === "0x" || nested === "0x") return true;
  return (
    data === undefined &&
    nested === undefined &&
    /^execution reverted\.?$/iu.test(
      String((caught as { message?: unknown } | null)?.message ?? "").trim(),
    )
  );
}

async function call(
  wallet: VaultConnection,
  deployment: EscrowDeployment,
  data: `0x${string}`,
) {
  const request = wallet.evmRequest;
  if (!request) throw new Error("Choose an EVM wallet.");
  const result = await request("eth_call", [
    { to: deployment.vault, data },
    "latest",
  ]);
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]+$/.test(result))
    throw new Error("The wallet returned an invalid vault read.");
  return result as `0x${string}`;
}

/**
 * The vault's open pledged total and its pledge for each month, read through
 * the wallet. Null when the vault's contract has no pledge support.
 */
export async function readWalletPledges(
  deployment: EscrowDeployment,
  wallet: VaultConnection,
  periods: readonly string[],
): Promise<{
  openPledgedGross: bigint;
  pledges: Map<string, { amount: bigint; open: boolean }>;
} | null> {
  let raw: `0x${string}`;
  try {
    raw = await call(
      wallet,
      deployment,
      encodeFunctionData({ abi: pledgeAbi, functionName: "openPledgedGross" }),
    );
  } catch (caught) {
    // Only an empty revert means the vault has no pledge support.
    if (emptyRevert(caught)) return null;
    throw caught;
  }
  const open = decodeFunctionResult({
    abi: pledgeAbi,
    functionName: "openPledgedGross",
    data: raw,
  });
  const pledges = new Map<string, { amount: bigint; open: boolean }>();
  for (const period of periods) {
    const [amount, isOpen] = decodeFunctionResult({
      abi: pledgeAbi,
      functionName: "monthPledges",
      data: await call(
        wallet,
        deployment,
        encodeFunctionData({
          abi: pledgeAbi,
          functionName: "monthPledges",
          args: [Number(period.replace("-", ""))],
        }),
      ),
    });
    pledges.set(period, { amount, open: isOpen });
  }
  return { openPledgedGross: open, pledges };
}

/**
 * Refuses a withdrawal that would take locked funds, before the wallet is
 * asked. True when the vault supports locks, so the page's own guard for
 * older vaults does not apply.
 */
export async function assertWithdrawalOutsideLocks(
  deployment: EscrowDeployment,
  wallet: VaultConnection,
  freeBalance: string | null,
  gross: string,
): Promise<boolean> {
  let read: Awaited<ReturnType<typeof readWalletPledges>>;
  try {
    read = await readWalletPledges(deployment, wallet, []);
  } catch {
    // Unreadable now: the contract still refuses locked funds when sent.
    return false;
  }
  if (!read) return false;
  if (
    freeBalance !== null &&
    BigInt(freeBalance) - BigInt(gross) < read.openPledgedGross
  )
    throw new Error(LOCKED_FUNDS);
  return true;
}

export type MonthLockReview = {
  fromPeriod: string;
  periods: string[];
  amount: string;
  amountMinor: string;
  /** What the lock adds to the vault's locked total. */
  addedMinor: string;
  decimals: number;
  deposit: { amount: string; gross: string } | null;
};

/**
 * Checks a lock of `count` months at `amount` each, optionally sent with a
 * deposit in one wallet request. `minimumMinor` is the project's monthly
 * amount; a smaller lock would not fund the month.
 */
export async function reviewMonthLock(input: {
  deployment: EscrowDeployment;
  wallet: VaultConnection;
  count: number;
  amount: string;
  minimumMinor: bigint;
  deposit: string;
}): Promise<MonthLockReview> {
  const { deployment, wallet } = input;
  if (!LOCK_MONTH_COUNTS.includes(input.count as 1))
    throw new Error("Choose 1, 3, 6 or 12 months.");
  const config = walletVaultConfig(deployment, wallet);
  await assertVaultWalletAccount(wallet, config);
  if (wallet.address.toLowerCase() !== deployment.owner.toLowerCase())
    throw new Error("Only the vault owner's wallet can lock months.");
  const withDeposit = input.deposit.trim() !== "";
  // The deposit review reads the finalized vault and the wallet's balance
  // and allowance, and says whether the wallet can batch.
  const depositReview = withDeposit
    ? await reviewVaultAction(
        deployment,
        wallet,
        "deposit",
        input.deposit,
        "ordinary",
        "finalized",
        true,
      )
    : null;
  const vault = depositReview ?? (await reviewWithoutDeposit(input));
  const decimals = vault.decimals;
  const amountMinor = parseVaultAmount(input.amount, decimals);
  if (amountMinor < input.minimumMinor)
    throw new Error(
      "Lock at least the project's monthly amount, or the month is not funded.",
    );
  // The contract's own month: a lock must start at or after it, and a month
  // computed in the browser can already be past by the time it is mined.
  const current = decodeFunctionResult({
    abi: pledgeAbi,
    functionName: "currentPeriod",
    data: await call(
      wallet,
      deployment,
      encodeFunctionData({ abi: pledgeAbi, functionName: "currentPeriod" }),
    ),
  });
  const currentText = String(current);
  if (!/^\d{4}(0[1-9]|1[0-2])$/u.test(currentText))
    throw new Error("The vault returned an invalid month.");
  const periods = lockPeriods(
    `${currentText.slice(0, 4)}-${currentText.slice(4)}`,
    input.count,
  );
  const read = await readWalletPledges(deployment, wallet, periods);
  if (!read) throw new Error("This vault cannot lock months yet.");
  let added = 0n;
  for (const period of periods) {
    const existing = read.pledges.get(period);
    if (!existing?.open) {
      added += amountMinor;
      continue;
    }
    if (existing.amount > amountMinor)
      throw new Error(
        `${period} is already locked at a higher amount. A lock can be raised, never lowered.`,
      );
    added += amountMinor - existing.amount;
  }
  const free =
    BigInt(vault.freeBalance ?? "0") +
    (depositReview ? BigInt(depositReview.gross) : 0n);
  if (free < read.openPledgedGross + added)
    throw new Error(
      "The vault's free funds cannot cover these months. Deposit more first, or lock fewer months.",
    );
  if (depositReview && !depositReview.batch)
    throw new Error(
      "Your wallet cannot send the deposit and the lock as one request. Deposit first, then lock.",
    );
  return {
    fromPeriod: periods[0],
    periods,
    amount: input.amount,
    amountMinor: amountMinor.toString(),
    addedMinor: added.toString(),
    decimals,
    deposit: depositReview
      ? { amount: input.deposit, gross: depositReview.gross }
      : null,
  };
}

async function reviewWithoutDeposit(input: {
  deployment: EscrowDeployment;
  wallet: VaultConnection;
}) {
  // A zero-amount deposit is refused; read the vault through a 1 base-unit
  // review only for its decimals and free balance, never sent.
  const { readVaultTotals } = evmAdapter;
  const config = walletVaultConfig(input.deployment, input.wallet);
  await evmAdapter.verifyEvmDeployment(config, "finalized");
  const totals = await readVaultTotals(
    { ...config, network: input.deployment.network },
    "finalized",
  );
  return { decimals: totals.decimals, freeBalance: totals.freeBalance };
}

function lockCall(deployment: EscrowDeployment, review: MonthLockReview) {
  return {
    to: deployment.vault,
    data: pledgeCalldata(
      Number(review.fromPeriod.replace("-", "")),
      review.periods.length,
      BigInt(review.amountMinor),
    ),
    value: "0x0" as const,
  };
}

/**
 * Sends the reviewed lock. With a deposit it goes as one atomic wallet
 * request after the approval and the deposit; the result is the wallet's
 * batch reference. Without one it is a single transaction hash.
 */
export async function sendMonthLock(
  deployment: EscrowDeployment,
  wallet: VaultConnection,
  review: MonthLockReview,
  beforeSend: () => void,
): Promise<{ kind: "transaction" | "batch"; id: string }> {
  const call = lockCall(deployment, review);
  if (review.deposit)
    try {
      return {
        kind: "batch",
        id: await sendVaultBatch(
          deployment,
          wallet,
          review.deposit.amount,
          beforeSend,
          "ordinary",
          "finalized",
          [call],
        ),
      };
    } catch (caught) {
      throw lockRefusal(caught) ?? caught;
    }
  const request = wallet.evmRequest;
  if (!request) throw new Error("Choose an EVM wallet.");
  const transaction = { from: wallet.address, ...call };
  try {
    await request("eth_estimateGas", [transaction]);
  } catch (caught) {
    throw lockRefusal(caught) ?? caught;
  }
  await assertVaultWalletAccount(wallet, walletVaultConfig(deployment, wallet));
  beforeSend();
  const hash = await request("eth_sendTransaction", [transaction]);
  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash))
    throw new Error(
      "The wallet did not return a transaction hash. Check wallet activity before another attempt.",
    );
  return { kind: "transaction", id: hash };
}

/**
 * The lock transaction's state. "included" means it succeeded in a canonical
 * block; the locked months show here once the block is final and the vault is
 * read again.
 */
export async function checkMonthLock(
  deployment: EscrowDeployment,
  wallet: VaultConnection,
  review: MonthLockReview,
  transactionId: string,
): Promise<"pending" | "included" | "failed"> {
  const checked = await readFinalizedWalletTransaction(
    deployment,
    wallet,
    transactionId,
    deployment.vault,
    lockCall(deployment, review).data,
    0n,
    "included",
  );
  if (checked.status === "pending") return "pending";
  if (checked.status === "failed" || checked.receipt?.status === "0x0")
    return "failed";
  return "included";
}

/**
 * Releases a lapsed lock: a month that was never reserved for payout and
 * whose commit window has closed (`expirePledge`). Anyone may send it; the
 * funds return to the vault's free funds. Returns the transaction hash.
 */
export async function sendLockRelease(
  deployment: EscrowDeployment,
  wallet: VaultConnection,
  period: string,
  beforeSend: () => void,
): Promise<string> {
  const request = wallet.evmRequest;
  if (!request) throw new Error("Choose an EVM wallet.");
  await assertVaultWalletAccount(wallet, walletVaultConfig(deployment, wallet));
  const transaction = {
    from: wallet.address,
    to: deployment.vault,
    data: expireCalldata(chainMonth(period)),
    value: "0x0",
  };
  try {
    await request("eth_estimateGas", [transaction]);
  } catch (caught) {
    throw lockRefusal(caught) ?? caught;
  }
  beforeSend();
  const hash = await request("eth_sendTransaction", [transaction]);
  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash))
    throw new Error(
      "The wallet did not return a transaction hash. Check wallet activity before another attempt.",
    );
  return hash;
}

/** The release transaction's state, as `checkMonthLock` reports a lock's. */
export async function checkLockRelease(
  deployment: EscrowDeployment,
  wallet: VaultConnection,
  period: string,
  transactionId: string,
): Promise<"pending" | "included" | "failed"> {
  const checked = await readFinalizedWalletTransaction(
    deployment,
    wallet,
    transactionId,
    deployment.vault,
    expireCalldata(chainMonth(period)),
    0n,
    "included",
  );
  if (checked.status === "pending") return "pending";
  if (checked.status === "failed") return "failed";
  return "included";
}
