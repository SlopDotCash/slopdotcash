/** Tests adversarial USDC transaction reconciliation using RPC-shaped records. */

import { describe, expect, it } from "vitest";
import { SOLANA_MAINNET_USDC_MINT } from "./settlement-plan";
import {
  assertFinalizedUsdcFundingTransfer,
  assertFinalizedUsdcTransfer,
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
