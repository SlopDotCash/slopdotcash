/** Tests adversarial Base USDC payout reconciliation using RPC-shaped receipts. */

import { describe, expect, it } from "vitest";
import { EVM_FUNDING_USDC_CONTRACTS } from "./evm-funding";
import {
  assertConfirmedUsdcSettlementTransfer,
  type ExpectedEvmTransfer,
  MAX_EVM_SETTLEMENT_TRANSFERS,
} from "./evm-settlement";

const SOURCE = `0x${"2".repeat(40)}`;
const RECIPIENT = `0x${"1".repeat(40)}`;
const SECOND = `0x${"4".repeat(40)}`;
const ATTACKER = `0x${"3".repeat(40)}`;
const ROUTER = `0x${"5".repeat(40)}`;
const ZERO = `0x${"0".repeat(40)}`;
const HASH = `0x${"a".repeat(64)}`;
const BLOCK_HASH = `0x${"b".repeat(64)}`;
const FINALIZED = { number: 0x1000n, hash: `0x${"c".repeat(64)}` };
const RECEIPT_BLOCK = { number: 0x100n, hash: BLOCK_HASH };
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function topic(address: string) {
  return `0x${"0".repeat(24)}${address.slice(2)}`;
}

function transferLog(
  from: string,
  to: string,
  value: bigint,
  address: string = EVM_FUNDING_USDC_CONTRACTS.base,
) {
  return {
    address,
    topics: [TRANSFER_TOPIC, topic(from), topic(to)],
    data: `0x${value.toString(16).padStart(64, "0")}`,
    removed: false,
    transactionHash: HASH,
    blockHash: BLOCK_HASH,
    blockNumber: "0x100",
  };
}

function receipt(logs: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    status: "0x1",
    transactionHash: HASH,
    blockNumber: "0x100",
    blockHash: BLOCK_HASH,
    logs,
    ...overrides,
  };
}

function verify(
  receiptValue: unknown,
  transfers: readonly ExpectedEvmTransfer[],
  options: { hash?: string; source?: string; network?: string } = {},
) {
  return assertConfirmedUsdcSettlementTransfer(
    receiptValue,
    (options.network ?? "base") as "base",
    options.hash ?? HASH,
    options.source ?? SOURCE,
    transfers,
    FINALIZED,
    RECEIPT_BLOCK,
  );
}

const ONE = [{ recipient: RECIPIENT, amountMinor: "1000000" }];

describe("confirmed Base settlement", () => {
  it("accepts only the exact USDC debit and credit", () => {
    expect(
      verify(receipt([transferLog(SOURCE, RECIPIENT, 1_000_000n)]), ONE),
    ).toEqual({
      transactionHash: HASH,
      blockHash: BLOCK_HASH,
      blockNumber: 0x100,
      confirmations: 0x1000 - 0x100 + 1,
    });
  });

  it("reconciles a smart-account batch and sums a repeated recipient", () => {
    const batch = receipt([
      transferLog(SOURCE, RECIPIENT, 1_000_000n),
      transferLog(SOURCE, SECOND, 2_500_000n),
      transferLog(SOURCE, RECIPIENT, 250_000n),
    ]);
    expect(
      verify(batch, [
        { recipient: RECIPIENT, amountMinor: "1000000" },
        { recipient: SECOND, amountMinor: "2500000" },
        { recipient: RECIPIENT, amountMinor: "250000" },
      ]).transactionHash,
    ).toBe(HASH);
    expect(() =>
      verify(batch, [
        { recipient: RECIPIENT, amountMinor: "1000000" },
        { recipient: SECOND, amountMinor: "2500000" },
      ]),
    ).toThrow(/source USDC debit/u);
  });

  it("rejects failed, underpaid, overpaid, and replay-labeled receipts", () => {
    const paid = receipt([transferLog(SOURCE, RECIPIENT, 1_000_000n)]);
    expect(() => verify(receipt(paid.logs, { status: "0x0" }), ONE)).toThrow(
      /did not execute successfully/u,
    );
    expect(() =>
      verify(paid, [{ recipient: RECIPIENT, amountMinor: "1000001" }]),
    ).toThrow(/source USDC debit/u);
    expect(() =>
      verify(paid, [{ recipient: RECIPIENT, amountMinor: "999999" }]),
    ).toThrow(/source USDC debit/u);
    expect(() => verify(paid, ONE, { hash: `0x${"d".repeat(64)}` })).toThrow(
      /does not match the settlement record/u,
    );
  });

  it("rejects a payment sent from any wallet other than the declared source", () => {
    expect(() =>
      verify(receipt([transferLog(ATTACKER, RECIPIENT, 1_000_000n)]), ONE),
    ).toThrow(/source USDC debit/u);
  });

  it("rejects padded transactions that move USDC to an undeclared account", () => {
    expect(() =>
      verify(
        receipt([
          transferLog(SOURCE, RECIPIENT, 1_000_000n),
          transferLog(SOURCE, ATTACKER, 100_000n),
        ]),
        ONE,
      ),
    ).toThrow(/source USDC debit/u);
    expect(() =>
      verify(
        receipt([
          transferLog(SOURCE, RECIPIENT, 1_000_000n),
          transferLog(ROUTER, ATTACKER, 100_000n),
        ]),
        ONE,
      ),
    ).toThrow(/undeclared USDC delta/u);
  });

  it("rejects a credit that is clawed back inside the same transaction", () => {
    expect(() =>
      verify(
        receipt([
          transferLog(SOURCE, RECIPIENT, 1_000_000n),
          transferLog(RECIPIENT, SOURCE, 1_000_000n),
        ]),
        ONE,
      ),
    ).toThrow(/source USDC debit/u);
  });

  it("allows a pass-through hop whose net USDC delta is zero", () => {
    expect(
      verify(
        receipt([
          transferLog(SOURCE, ROUTER, 1_000_000n),
          transferLog(ROUTER, RECIPIENT, 1_000_000n),
        ]),
        ONE,
      ).transactionHash,
    ).toBe(HASH);
  });

  it("ignores look-alike Transfer events from any other token contract", () => {
    expect(() =>
      verify(
        receipt([transferLog(SOURCE, RECIPIENT, 1_000_000n, ATTACKER)]),
        ONE,
      ),
    ).toThrow(/source USDC debit/u);
    expect(() =>
      verify(
        receipt([
          transferLog(
            SOURCE,
            RECIPIENT,
            1_000_000n,
            EVM_FUNDING_USDC_CONTRACTS.ethereum,
          ),
        ]),
        ONE,
      ),
    ).toThrow(/source USDC debit/u);
  });

  it("rejects mints, reorged logs, and unfinalized or unbound receipts", () => {
    expect(() =>
      verify(receipt([transferLog(ZERO, RECIPIENT, 1_000_000n)]), ONE),
    ).toThrow(/mints or burns/u);
    expect(() =>
      verify(
        receipt([
          { ...transferLog(SOURCE, RECIPIENT, 1_000_000n), removed: true },
        ]),
        ONE,
      ),
    ).toThrow(/reorged/u);
    expect(() =>
      assertConfirmedUsdcSettlementTransfer(
        receipt([transferLog(SOURCE, RECIPIENT, 1_000_000n)]),
        "base",
        HASH,
        SOURCE,
        ONE,
        { number: 0x105n, hash: FINALIZED.hash },
        RECEIPT_BLOCK,
      ),
    ).toThrow(/finality policy/u);
    expect(() =>
      assertConfirmedUsdcSettlementTransfer(
        receipt([transferLog(SOURCE, RECIPIENT, 1_000_000n)]),
        "base",
        HASH,
        SOURCE,
        ONE,
        FINALIZED,
        { number: 0x100n, hash: `0x${"e".repeat(64)}` },
      ),
    ).toThrow(/canonical block/u);
  });

  it("refuses malformed expectations before reading the receipt", () => {
    const paid = receipt([transferLog(SOURCE, RECIPIENT, 1_000_000n)]);
    expect(() => verify(paid, ONE, { network: "ethereum" })).toThrow(
      /must be base/u,
    );
    expect(() => verify(paid, ONE, { source: ZERO })).toThrow(
      /source is not a canonical/u,
    );
    expect(() => verify(paid, ONE, { source: `0x${"A".repeat(40)}` })).toThrow(
      /source is not a canonical/u,
    );
    expect(() => verify(paid, [])).toThrow(/1 to 200 transfers/u);
    expect(() =>
      verify(
        paid,
        Array.from({ length: MAX_EVM_SETTLEMENT_TRANSFERS + 1 }, () => ONE[0]),
      ),
    ).toThrow(/1 to 200 transfers/u);
    expect(() =>
      verify(paid, [{ recipient: SOURCE, amountMinor: "1000000" }]),
    ).toThrow(/expected transfer 0/u);
    expect(() =>
      verify(paid, [{ recipient: RECIPIENT, amountMinor: "0" }]),
    ).toThrow(/expected transfer 0/u);
    expect(() =>
      verify(paid, [{ recipient: RECIPIENT, amountMinor: "1.5" }]),
    ).toThrow(/expected transfer 0/u);
  });

  it("verifies a pinned Base mainnet USDC transfer receipt", () => {
    // https://basescan.org/tx/0x84d617b2c33f6d3b03eba0db19fa7e228b095f20779864f0a13ac463ec6fef7d
    // Relayed transfer: the transaction sender is not the USDC source, which
    // is why reconciliation reads Transfer deltas and never `receipt.from`.
    const transactionHash =
      "0x84d617b2c33f6d3b03eba0db19fa7e228b095f20779864f0a13ac463ec6fef7d";
    const blockHash =
      "0x17df794e0615e77910028e847eb96e26c0cd29dfb8aca8029ee5aaf759060801";
    const mainnetReceipt = {
      status: "0x1",
      transactionHash,
      blockNumber: "0x312cd4d",
      blockHash,
      from: "0x511808449be470efaf4131838b2d4998500a6f72",
      to: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      logs: [
        {
          address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
          topics: [
            TRANSFER_TOPIC,
            "0x000000000000000000000000f70da97812cb96acdf810712aa562db8dfa3dbef",
            "0x000000000000000000000000952a7a4856184583788666f0dab28f09b37227be",
          ],
          data: "0x0000000000000000000000000000000000000000000000000000000004831f43",
          removed: false,
          transactionHash,
          blockHash,
          blockNumber: "0x312cd4d",
          logIndex: "0x14a",
        },
      ],
    };
    const check = (source: string, amountMinor: string) =>
      assertConfirmedUsdcSettlementTransfer(
        mainnetReceipt,
        "base",
        transactionHash,
        source,
        [
          {
            recipient: "0x952a7a4856184583788666f0dab28f09b37227be",
            amountMinor,
          },
        ],
        { number: 0x312e0d5n, hash: FINALIZED.hash },
        { number: 0x312cd4dn, hash: blockHash },
      );
    expect(
      check("0xf70da97812cb96acdf810712aa562db8dfa3dbef", "75702083"),
    ).toEqual({
      transactionHash,
      blockHash,
      blockNumber: 51_563_853,
      confirmations: 5_001,
    });
    expect(() =>
      check("0x511808449be470efaf4131838b2d4998500a6f72", "75702083"),
    ).toThrow(/source USDC debit/u);
    expect(() =>
      check("0xf70da97812cb96acdf810712aa562db8dfa3dbef", "75702082"),
    ).toThrow(/source USDC debit/u);
  });
});
