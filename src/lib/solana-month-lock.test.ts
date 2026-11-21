import { expect, test } from "bun:test";
import { solanaPledgeMonthsMessage } from "../../contracts/solana/month-pledge";
import type { EscrowDeployment } from "./escrow-policy.mjs";
import { solanaMonthLockMessage } from "./solana-month-lock";

const OWNER = "So11111111111111111111111111111111111111112";
const PROGRAM = "11111111111111111111111111111112";
const PROJECT = "SysvarRent111111111111111111111111111111111";
const BLOCKHASH = "SysvarC1ock11111111111111111111111111111111";

test("the browser rebuilds exactly the message the lock route plans", () => {
  const deployment = {
    network: "solana-mainnet",
    programId: PROGRAM,
    projectPda: PROJECT,
    owner: OWNER,
  } as EscrowDeployment;
  const plan = {
    action: "lock" as const,
    periods: [202612, 202701],
    amountMinor: "250000000",
  };
  expect(
    Buffer.from(solanaMonthLockMessage(deployment, OWNER, plan, BLOCKHASH)),
  ).toEqual(
    Buffer.from(
      solanaPledgeMonthsMessage(
        { programId: PROGRAM, projectPda: PROJECT, owner: OWNER } as never,
        {
          wallet: OWNER,
          periods: plan.periods,
          amountMinor: 250000000n,
          blockhash: BLOCKHASH,
        },
      ),
    ),
  );
});
