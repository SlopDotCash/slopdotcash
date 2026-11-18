import {
  type SolanaEscrowConfig,
  solanaExpirePledgeInstruction,
  solanaMintDecimals,
} from "../../contracts/solana/adapter";
import {
  prepareSolanaExpirePledge,
  prepareSolanaPledgeMonths,
  solanaPledgeMonthsMessage,
} from "../../contracts/solana/month-pledge";
import { message } from "../../contracts/solana/transactions";
import {
  checkSolanaWalletTransaction,
  SolanaWalletActionError,
} from "../../contracts/solana/wallet-transactions";
import {
  chainMonth,
  LOCK_MONTH_COUNTS,
  lockPeriods,
} from "../../src/lib/month-lock";
import { parseVaultAmount } from "../../src/lib/payments/vault-amount";
import { isWalletAddress } from "../../src/lib/wallets";
import { json, readJsonObject } from "../http";

/**
 * Plans the owner's month lock (`pledge_month`) and anyone's release of a
 * lapsed lock (`expire_pledge`) on a Solana vault, and checks the signed
 * transaction (operator decision, 15 November 2026). It plans and simulates
 * only: the wallet signs and sends, and the browser rebuilds the exact
 * message before asking it. The program checks owner, amount and months.
 */
export async function handleSolanaMonthLock(
  request: Request,
  resolve: (network: string, vault: string) => Promise<SolanaEscrowConfig>,
  now: Date = new Date(),
): Promise<Response> {
  const body = await readJsonObject(request, 4096, "vault month lock");
  if (
    !body ||
    (body.step !== "review" && body.step !== "check") ||
    (body.action !== "lock" && body.action !== "release") ||
    typeof body.network !== "string" ||
    typeof body.vault !== "string" ||
    typeof body.wallet !== "string" ||
    !isWalletAddress("solana", body.wallet) ||
    (body.step === "review" &&
      body.action === "lock" &&
      (!LOCK_MONTH_COUNTS.includes(body.count as 1) ||
        typeof body.amount !== "string" ||
        body.amount.length > 80)) ||
    (body.step === "review" &&
      body.action === "release" &&
      (typeof body.period !== "string" ||
        !/^\d{4}-(0[1-9]|1[0-2])$/u.test(body.period))) ||
    (body.step === "check" &&
      (typeof body.transactionId !== "string" ||
        body.transactionId.length > 100 ||
        typeof body.blockhash !== "string" ||
        !isWalletAddress("solana", body.blockhash) ||
        !Array.isArray(body.periods) ||
        body.periods.length < 1 ||
        body.periods.length > 12 ||
        (body.action === "release" && body.periods.length !== 1) ||
        !body.periods.every(
          (period) => Number.isSafeInteger(period) && (period as number) > 0,
        ) ||
        (body.action === "lock" &&
          (typeof body.amountMinor !== "string" ||
            !/^[1-9][0-9]{0,19}$/u.test(body.amountMinor)))))
  )
    return json(400, { error: "invalid_month_lock" });
  const config = await resolve(body.network, body.vault);
  const wallet = body.wallet;
  try {
    if (body.step === "check") {
      const periods = body.periods as number[];
      const msg =
        body.action === "lock"
          ? solanaPledgeMonthsMessage(config, {
              wallet,
              periods,
              amountMinor: BigInt(body.amountMinor as string),
              blockhash: body.blockhash as string,
            })
          : message(wallet, body.blockhash as string, [
              solanaExpirePledgeInstruction(config, periods[0] as number),
            ]);
      const checked = await checkSolanaWalletTransaction(
        config,
        wallet,
        msg,
        body.transactionId as string,
      );
      return json(200, { status: checked.status });
    }
    if (body.action === "release") {
      const plan = await prepareSolanaExpirePledge({
        ...config,
        wallet,
        period: chainMonth(body.period as string),
      });
      return json(200, { plan: { ...plan, periods: [plan.period] } });
    }
    const decimals = await solanaMintDecimals(config, config.mint);
    let amountMinor: bigint;
    try {
      amountMinor = parseVaultAmount(body.amount as string, decimals);
    } catch {
      return json(422, {
        error: "invalid_month_lock_amount",
        message:
          "Enter a positive amount within this token's decimal precision.",
      });
    }
    // Starts at the current UTC month, as the program's clock does.
    const periods = lockPeriods(
      now.toISOString().slice(0, 7),
      body.count as number,
    ).map(chainMonth);
    const plan = await prepareSolanaPledgeMonths({
      ...config,
      wallet,
      periods,
      amountMinor,
    });
    return json(200, { plan: { ...plan, decimals, requested: periods } });
  } catch (error) {
    if (error instanceof SolanaWalletActionError)
      return json(422, {
        error: "month_lock_rejected",
        message: error.message,
      });
    throw error;
  }
}
