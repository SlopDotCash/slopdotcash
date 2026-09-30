/** Tests adversarial USDC transaction reconciliation using RPC-shaped records. */

import { describe, expect, it } from "vitest";
import { assertRewardAllocationManifest } from "./rewards";
import {
  createSettlementExecutionPlan,
  SOLANA_MAINNET_USDC_MINT,
} from "./settlement-plan";
import {
  assertFinalizedUsdcFundingTransfer,
  assertFinalizedUsdcTransfer,
  assertSettlementChronology,
  verifyRewardSettlementOnchain,
} from "./solana-settlement";

const SOURCE = "Vote111111111111111111111111111111111111111";
const RECIPIENT = "11111111111111111111111111111111";
const ATTACKER = "Stake11111111111111111111111111111111111111";
const SIGNATURE = "3".repeat(88);

function balance(accountIndex: number, owner: string, amount: string) {
  return {
    accountIndex,
    mint: SOLANA_MAINNET_USDC_MINT,
    owner,
    uiTokenAmount: {
      amount,
      decimals: 6,
      uiAmount: Number(amount) / 1_000_000,
      uiAmountString: (Number(amount) / 1_000_000).toString(),
    },
  };
}

function transaction() {
  return {
    slot: 123,
    blockTime: 1_786_000_000,
    meta: {
      err: null as unknown,
      preTokenBalances: [
        balance(0, SOURCE, "2000000"),
        balance(1, RECIPIENT, "0"),
      ],
      postTokenBalances: [
        balance(0, SOURCE, "1000000"),
        balance(1, RECIPIENT, "1000000"),
      ],
    },
    transaction: { signatures: [SIGNATURE] },
  };
}

describe("finalized Solana settlement", () => {
  it("rejects a settlement timestamp before its finalized transaction", () => {
    expect(() =>
      assertSettlementChronology("2026-08-01T00:00:00.000Z", [
        { signature: SIGNATURE, slot: 123, blockTime: 1_786_000_000 },
      ]),
    ).toThrow(/predates its finalized transaction/u);
  });

  it("accepts only the exact raw USDC debit and credit", () => {
    expect(
      assertFinalizedUsdcTransfer(transaction(), SIGNATURE, SOURCE, [
        { recipientOwner: RECIPIENT, amountMinor: "1000000" },
      ]),
    ).toEqual({ signature: SIGNATURE, slot: 123, blockTime: 1_786_000_000 });
  });

  it("rejects base58 strings that do not decode to 64-byte signatures", () => {
    const malformedSignature = "2".repeat(64);
    const mislabeled = transaction();
    mislabeled.transaction.signatures = [malformedSignature];

    expect(() =>
      assertFinalizedUsdcTransfer(mislabeled, malformedSignature, SOURCE, [
        { recipientOwner: RECIPIENT, amountMinor: "1000000" },
      ]),
    ).toThrow(/signature/u);
    expect(() =>
      assertFinalizedUsdcFundingTransfer(
        mislabeled,
        malformedSignature,
        RECIPIENT,
        "1000000",
      ),
    ).toThrow(/signature/u);
  });

  it("rejects failed, underpaid, replay-labeled, and padded transactions", () => {
    const failed = transaction();
    failed.meta.err = { InstructionError: [0, "Custom"] };
    expect(() =>
      assertFinalizedUsdcTransfer(failed, SIGNATURE, SOURCE, [
        { recipientOwner: RECIPIENT, amountMinor: "1000000" },
      ]),
    ).toThrow(/successfully/u);

    expect(() =>
      assertFinalizedUsdcTransfer(transaction(), SIGNATURE, SOURCE, [
        { recipientOwner: RECIPIENT, amountMinor: "1000001" },
      ]),
    ).toThrow(/source USDC debit/u);

    expect(() =>
      assertFinalizedUsdcTransfer(transaction(), "4".repeat(88), SOURCE, [
        { recipientOwner: RECIPIENT, amountMinor: "1000000" },
      ]),
    ).toThrow(/signature/u);

    const padded = transaction();
    padded.meta.preTokenBalances.push(balance(2, ATTACKER, "0"));
    padded.meta.postTokenBalances[0] = balance(0, SOURCE, "900000");
    padded.meta.postTokenBalances.push(balance(2, ATTACKER, "100000"));
    expect(() =>
      assertFinalizedUsdcTransfer(padded, SIGNATURE, SOURCE, [
        { recipientOwner: RECIPIENT, amountMinor: "1000000" },
      ]),
    ).toThrow(/source USDC debit|undeclared/u);
  });

  it("requires the receipt signature to be the transaction identifier", () => {
    const cosigned = transaction();
    cosigned.transaction.signatures = ["4".repeat(88), SIGNATURE];

    expect(() =>
      assertFinalizedUsdcTransfer(cosigned, SIGNATURE, SOURCE, [
        { recipientOwner: RECIPIENT, amountMinor: "1000000" },
      ]),
    ).toThrow(/signature/u);
    expect(() =>
      assertFinalizedUsdcFundingTransfer(
        cosigned,
        SIGNATURE,
        RECIPIENT,
        "1000000",
      ),
    ).toThrow(/signature/u);
  });

  it("verifies an exact direct-funding credit without trusting the sender", () => {
    expect(
      assertFinalizedUsdcFundingTransfer(
        transaction(),
        SIGNATURE,
        RECIPIENT,
        "1000000",
      ),
    ).toEqual({ signature: SIGNATURE, slot: 123, blockTime: 1_786_000_000 });

    const padded = transaction();
    padded.meta.preTokenBalances.push(balance(2, ATTACKER, "0"));
    padded.meta.postTokenBalances[0] = balance(0, SOURCE, "900000");
    padded.meta.postTokenBalances.push(balance(2, ATTACKER, "100000"));
    expect(() =>
      assertFinalizedUsdcFundingTransfer(
        padded,
        SIGNATURE,
        RECIPIENT,
        "1000000",
      ),
    ).toThrow(/undeclared credit/u);
  });
});

describe("project vault fee outside the vault (RFC #500 section 8)", () => {
  const VAULT = SOURCE;
  const CREATOR = "SysvarC1ock11111111111111111111111111111111";
  const FEE_WALLET = ATTACKER;
  const PAYOUT_SIGNATURE = "2".repeat(88);
  const FEE_SIGNATURE = SIGNATURE;
  const COMMIT = "a".repeat(40);

  function allocation(instrumentId: string) {
    return assertRewardAllocationManifest({
      schemaVersion: "1",
      kind: "reward-allocation",
      projectId: "eliza",
      cycleId: "2026-07",
      status: "approved",
      generatedAt: "2026-08-01T00:00:00.000Z",
      approvedAt: "2026-08-15T00:00:00.000Z",
      contributionWindow: {
        from: "2026-07-07T00:00:00.000Z",
        to: "2026-08-01T00:00:00.000Z",
      },
      review: {
        days: 14,
        lastMaterialChangeAt: "2026-08-01T00:00:00.000Z",
        endsAt: "2026-08-15T00:00:00.000Z",
      },
      currency: "USDC",
      chain: "solana",
      capMinor: "10000000000",
      feeBasisPoints: 100,
      scoringRuleVersion: "gitarmy-v1",
      sourceSnapshotSha256: "b".repeat(64),
      fundingBasis: {
        cycleId: "2026-07",
        fundingState: "committed",
        committedMinor: "10000000000",
        monthlyCapMinor: "10000000000",
        instrumentId,
      },
      allocations: [
        {
          intentId: "pay_eliza_2026_07_u1",
          actor: { id: "U_1", login: "contributor" },
          score: 100,
          suggestedMinor: "1000000",
          approvedMinor: "1000000",
          state: "approved",
          wallet: {
            address: RECIPIENT,
            chain: "solana",
            observedAt: "2026-08-01T00:00:00.000Z",
            sourceCommit: COMMIT,
            sourceUrl: `https://github.com/contributor/contributor/blob/${COMMIT}/README.md`,
          },
          evidenceEventIds: ["event_1"],
          adjustmentReason: null,
          relatedParty: false,
          platformApproval: null,
        },
      ],
      totals: {
        suggestedMinor: "1000000",
        approvedMinor: "1000000",
        feeMinor: "10000",
      },
    });
  }

  function usdcTransaction(
    signature: string,
    from: string,
    to: string,
    amount: bigint,
    blockTime: number,
  ) {
    const before = 5_000_000n;
    return {
      slot: 123,
      blockTime,
      meta: {
        err: null as unknown,
        preTokenBalances: [
          balance(0, from, before.toString()),
          balance(1, to, "0"),
        ],
        postTokenBalances: [
          balance(0, from, (before - amount).toString()),
          balance(1, to, amount.toString()),
        ],
      },
      transaction: { signatures: [signature] },
    };
  }

  function fixture(instrumentId: string) {
    const manifest = allocation(instrumentId);
    const plan = createSettlementExecutionPlan({
      allocation: manifest,
      allocationSha256: "c".repeat(64),
      createdAt: "2026-08-15T00:01:00.000Z",
      feeRecipient: FEE_WALLET,
      sourceOwner: VAULT,
    });
    const settlement = {
      schemaVersion: "1",
      kind: "reward-settlement",
      projectId: "eliza",
      cycleId: "2026-07",
      allocationSha256: "c".repeat(64),
      settledAt: "2026-08-20T00:00:00.000Z",
      currency: "USDC",
      chain: "solana",
      status: "paid",
      recipients: [
        {
          intentId: "pay_eliza_2026_07_u1",
          approvedMinor: "1000000",
          paidMinor: "1000000",
          state: "paid",
        },
      ],
      attempts: [
        {
          attemptId: "attempt_01",
          intentIds: ["pay_eliza_2026_07_u1"],
          signature: PAYOUT_SIGNATURE,
          state: "finalized",
        },
      ],
      platformFee: {
        recipient: FEE_WALLET,
        dueMinor: "10000",
        paidMinor: "10000",
        signature: FEE_SIGNATURE,
        state: "paid",
      },
      totals: {
        approvedMinor: "1000000",
        paidMinor: "1000000",
        feeMinor: "10000",
      },
    };
    return { allocation: manifest, plan, settlement };
  }

  function verify(
    f: ReturnType<typeof fixture>,
    transactions: Record<string, unknown>,
  ) {
    return verifyRewardSettlementOnchain({
      allocation: f.allocation,
      expectedAllocationSha256: "c".repeat(64),
      getTransaction: async (signature) => {
        const transaction = transactions[signature];
        if (!transaction) throw new Error(`unexpected ${signature}`);
        return transaction;
      },
      plan: f.plan,
      settlement: f.settlement,
    });
  }

  const PROJECT_VAULT = `squads-project-vault:solana:${RECIPIENT}:0:${VAULT}`;
  const TWO_OF_TWO = `squads-v4-vault:solana:${RECIPIENT}:0:${VAULT}`;

  it("refuses a funding credit that moves the excluded vault's USDC", () => {
    expect(
      assertFinalizedUsdcFundingTransfer(
        transaction(),
        SIGNATURE,
        RECIPIENT,
        "1000000",
        { excludedOwner: ATTACKER },
      ),
    ).toEqual({ signature: SIGNATURE, slot: 123, blockTime: 1_786_000_000 });
    expect(() =>
      assertFinalizedUsdcFundingTransfer(
        transaction(),
        SIGNATURE,
        RECIPIENT,
        "1000000",
        { excludedOwner: SOURCE },
      ),
    ).toThrow(/moves USDC of the excluded vault/u);
    expect(() =>
      assertFinalizedUsdcFundingTransfer(
        transaction(),
        SIGNATURE,
        RECIPIENT,
        "1000000",
        { excludedOwner: RECIPIENT },
      ),
    ).toThrow(/distinct Solana public key/u);
  });

  it("verifies the creator's separate fee transfer after the payout, never from the vault", async () => {
    const f = fixture(PROJECT_VAULT);
    expect(f.plan.transfers.map((t) => t.kind)).toEqual(["contributor"]);
    const payout = usdcTransaction(
      PAYOUT_SIGNATURE,
      VAULT,
      RECIPIENT,
      1_000_000n,
      1_786_000_000,
    );
    const feeFromCreator = usdcTransaction(
      FEE_SIGNATURE,
      CREATOR,
      FEE_WALLET,
      10_000n,
      1_786_000_100,
    );
    await expect(
      verify(f, {
        [PAYOUT_SIGNATURE]: payout,
        [FEE_SIGNATURE]: feeFromCreator,
      }),
    ).resolves.toEqual([
      { signature: PAYOUT_SIGNATURE, slot: 123, blockTime: 1_786_000_000 },
      { signature: FEE_SIGNATURE, slot: 123, blockTime: 1_786_000_100 },
    ]);

    // The fee paid out of the vault is refused even though the amount and
    // recipient are exact: the vault holds contributor principal only.
    await expect(
      verify(f, {
        [PAYOUT_SIGNATURE]: payout,
        [FEE_SIGNATURE]: usdcTransaction(
          FEE_SIGNATURE,
          VAULT,
          FEE_WALLET,
          10_000n,
          1_786_000_100,
        ),
      }),
    ).rejects.toThrow(/moves USDC of the excluded vault/u);

    // The fee is payable only once the contributor payout is complete.
    await expect(
      verify(f, {
        [PAYOUT_SIGNATURE]: payout,
        [FEE_SIGNATURE]: usdcTransaction(
          FEE_SIGNATURE,
          CREATOR,
          FEE_WALLET,
          10_000n,
          1_785_999_999,
        ),
      }),
    ).rejects.toThrow(/before the contributor payout completed/u);

    // Wrong recipient or amount still fails exactly.
    await expect(
      verify(f, {
        [PAYOUT_SIGNATURE]: payout,
        [FEE_SIGNATURE]: usdcTransaction(
          FEE_SIGNATURE,
          CREATOR,
          RECIPIENT,
          10_000n,
          1_786_000_100,
        ),
      }),
    ).rejects.toThrow(/did not receive the exact amount/u);
    await expect(
      verify(f, {
        [PAYOUT_SIGNATURE]: payout,
        [FEE_SIGNATURE]: usdcTransaction(
          FEE_SIGNATURE,
          CREATOR,
          FEE_WALLET,
          9_999n,
          1_786_000_100,
        ),
      }),
    ).rejects.toThrow(/did not receive the exact amount/u);
  });

  it("keeps the 2-of-2 fee inside the vault's own plan", async () => {
    const f = fixture(TWO_OF_TWO);
    expect(f.plan.transfers.map((t) => t.kind)).toEqual([
      "contributor",
      "platform-fee",
    ]);
    const payout = usdcTransaction(
      PAYOUT_SIGNATURE,
      VAULT,
      RECIPIENT,
      1_000_000n,
      1_786_000_000,
    );
    await expect(
      verify(f, {
        [PAYOUT_SIGNATURE]: payout,
        [FEE_SIGNATURE]: usdcTransaction(
          FEE_SIGNATURE,
          VAULT,
          FEE_WALLET,
          10_000n,
          1_786_000_100,
        ),
      }),
    ).resolves.toHaveLength(2);
    // On a 2-of-2 vault a fee sent from elsewhere is not the planned transfer.
    await expect(
      verify(f, {
        [PAYOUT_SIGNATURE]: payout,
        [FEE_SIGNATURE]: usdcTransaction(
          FEE_SIGNATURE,
          CREATOR,
          FEE_WALLET,
          10_000n,
          1_786_000_100,
        ),
      }),
    ).rejects.toThrow(/source USDC debit is not exact/u);
  });
});
