/** The owner's month pledges (`pledge_month`) and their lapse (`expire_pledge`). Plans only. */
import {
  readSolanaMonthPledges,
  type SolanaEscrowConfig,
  solanaExpirePledgeInstruction,
  solanaPledgeMonthsInstructions,
  verifySolanaDeployment,
} from "./adapter";
import { message } from "./transactions";
import {
  prepareSolanaWalletTransaction,
  SolanaWalletActionError,
} from "./wallet-transactions";

interface SolanaPledgePlan {
  wallet: string;
  /** UTC periods written YYYYMM: the current one up to 11 months ahead. */
  periods: readonly number[];
  /** Asset base units pledged to each period. */
  amountMinor: bigint;
}
// Project account offset of the u8 purpose; 0 is an ordinary project.
const PURPOSE = 306;

function instructions(config: SolanaEscrowConfig, plan: SolanaPledgePlan) {
  try {
    return solanaPledgeMonthsInstructions(config, plan);
  } catch (error) {
    throw new SolanaWalletActionError(
      error instanceof Error ? error.message : "Invalid pledge",
    );
  }
}
/** The exact unsigned message a wallet signs for `plan`, for local rebuild and comparison. */
export function solanaPledgeMonthsMessage(
  config: SolanaEscrowConfig,
  plan: SolanaPledgePlan & { blockhash: string },
) {
  return message(plan.wallet, plan.blockhash, instructions(config, plan));
}
/**
 * Verifies the deployment, reads the finalized pledges and plans one transaction that pledges
 * `amountMinor` to every period not already pledged at that amount. It refuses a period whose
 * open pledge is larger (pledges can only rise) and a project that is not yet migrated. The
 * transaction is null when every period already holds this amount. It never signs or sends.
 */
export async function prepareSolanaPledgeMonths(
  input: SolanaEscrowConfig & SolanaPledgePlan,
) {
  instructions(input, input);
  const project = await verifySolanaDeployment(input);
  if (project[PURPOSE] !== 0)
    throw new SolanaWalletActionError(
      "Only an ordinary project vault takes month pledges.",
    );
  const current = await readSolanaMonthPledges({
    ...input,
    periods: input.periods,
  });
  if (current === null)
    throw new SolanaWalletActionError(
      "This vault must be migrated before it can lock months.",
    );
  const lower = current.pledges.filter(
    (pledge) => pledge.open && pledge.amount > input.amountMinor,
  );
  if (lower.length > 0)
    throw new SolanaWalletActionError(
      `A locked month can only be raised: ${lower.map((p) => p.period).join(", ")}.`,
    );
  const periods = current.pledges
    .filter((pledge) => !pledge.open || pledge.amount < input.amountMinor)
    .map((pledge) => pledge.period);
  return {
    wallet: input.wallet,
    amountMinor: input.amountMinor.toString(),
    current: current.pledges.map((pledge) => ({
      period: pledge.period,
      amountMinor: pledge.amount.toString(),
      open: pledge.open,
    })),
    periods,
    transaction:
      periods.length === 0
        ? null
        : await prepareSolanaWalletTransaction(
            input,
            input.wallet,
            instructions(input, { ...input, periods }),
          ),
  };
}
/**
 * Plans anyone's `expire_pledge` for a period whose window has closed without a commit, or
 * whose month was committed without naming the pledge. The simulation refuses any other case.
 */
export async function prepareSolanaExpirePledge(
  input: SolanaEscrowConfig & { wallet: string; period: number },
) {
  let instruction: ReturnType<typeof solanaExpirePledgeInstruction>;
  try {
    instruction = solanaExpirePledgeInstruction(input, input.period);
  } catch (error) {
    throw new SolanaWalletActionError(
      error instanceof Error ? error.message : "Invalid period",
    );
  }
  await verifySolanaDeployment(input);
  const current = await readSolanaMonthPledges({
    ...input,
    periods: [input.period],
  });
  if (current === null || !current.pledges[0]?.open)
    throw new SolanaWalletActionError("This month has no open pledge.");
  return {
    wallet: input.wallet,
    period: input.period,
    amountMinor: current.pledges[0].amount.toString(),
    transaction: await prepareSolanaWalletTransaction(input, input.wallet, [
      instruction,
    ]),
  };
}
