/** Proves EVM funding credits verify by exact USDC deltas and fail closed. */

import { describe, expect, it } from "vitest";
import {
  assertConfirmedUsdcFundingTransfer,
  EVM_FUNDING_MIN_CONFIRMATIONS,
  EVM_FUNDING_USDC_CONTRACTS,
  EVM_FUNDING_VERIFIER_VERSIONS,
  type EvmFundingNetwork,
} from "./evm-funding";
import {
  assertProjectFundingAddresses,
  assertProjectFundingRecord,
} from "./funding";

const RECIPIENT = `0x${"1".repeat(40)}`;
const SENDER = `0x${"2".repeat(40)}`;
const OTHER = `0x${"3".repeat(40)}`;
const ZERO = `0x${"0".repeat(40)}`;
const HASH = `0x${"a".repeat(64)}`;
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function topic(address: string) {
  return `0x${"0".repeat(24)}${address.slice(2)}`;
}

function amountData(value: bigint) {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

function transferLog(
  network: EvmFundingNetwork,
  from: string,
  to: string,
  value: bigint,
) {
  return {
    address: EVM_FUNDING_USDC_CONTRACTS[network],
    topics: [TRANSFER_TOPIC, topic(from), topic(to)],
    data: amountData(value),
    removed: false,
  };
}

function receipt(
  network: EvmFundingNetwork,
  overrides: Record<string, unknown> = {},
) {
  return {
    status: "0x1",
    transactionHash: HASH,
    blockNumber: "0x100",
    logs: [transferLog(network, SENDER, RECIPIENT, 1_000_000n)],
    ...overrides,
  };
}

const FINALIZED = 0x1000n;

describe("EVM funding transfer verification", () => {
  it("verifies an exact confirmed USDC credit on both networks", () => {
    for (const network of ["base", "ethereum"] as const) {
      expect(
        assertConfirmedUsdcFundingTransfer(
          receipt(network),
          network,
          HASH,
          RECIPIENT,
          "1000000",
          FINALIZED,
        ),
      ).toEqual({
        transactionHash: HASH,
        blockNumber: 0x100,
        confirmations: 0x1000 - 0x100 + 1,
      });
    }
  });

  it("sums multiple USDC credits and ignores unrelated logs and events", () => {
    const logs = [
      transferLog("ethereum", SENDER, RECIPIENT, 400_000n),
      transferLog("ethereum", SENDER, RECIPIENT, 600_000n),
      {
        address: `0x${"9".repeat(40)}`,
        topics: [TRANSFER_TOPIC, topic(SENDER), topic(OTHER)],
        data: amountData(5n),
      },
      {
        address: EVM_FUNDING_USDC_CONTRACTS.ethereum,
        topics: [`0x${"b".repeat(64)}`, topic(SENDER), topic(OTHER)],
        data: amountData(5n),
      },
    ];
    expect(
      assertConfirmedUsdcFundingTransfer(
        receipt("ethereum", { logs }),
        "ethereum",
        HASH,
        RECIPIENT,
        "1000000",
        FINALIZED,
      ).confirmations,
    ).toBeGreaterThanOrEqual(EVM_FUNDING_MIN_CONFIRMATIONS.ethereum);
  });

  it("rejects failed, mismatched, unconfirmed, or unfinalized transactions", () => {
    expect(() =>
      assertConfirmedUsdcFundingTransfer(
        receipt("ethereum", { status: "0x0" }),
        "ethereum",
        HASH,
        RECIPIENT,
        "1000000",
        FINALIZED,
      ),
    ).toThrow(/did not execute successfully/u);
    expect(() =>
      assertConfirmedUsdcFundingTransfer(
        receipt("ethereum", { transactionHash: `0x${"b".repeat(64)}` }),
        "ethereum",
        HASH,
        RECIPIENT,
        "1000000",
        FINALIZED,
      ),
    ).toThrow(/does not match/u);
    expect(() =>
      assertConfirmedUsdcFundingTransfer(
        receipt("ethereum", { blockNumber: "0x2000" }),
        "ethereum",
        HASH,
        RECIPIENT,
        "1000000",
        FINALIZED,
      ),
    ).toThrow(/not finalized/u);
    expect(() =>
      assertConfirmedUsdcFundingTransfer(
        receipt("ethereum"),
        "ethereum",
        HASH,
        RECIPIENT,
        "1000000",
        0x100n + BigInt(EVM_FUNDING_MIN_CONFIRMATIONS.ethereum) - 2n,
      ),
    ).toThrow(/finality policy/u);
    expect(() =>
      assertConfirmedUsdcFundingTransfer(
        receipt("base"),
        "base",
        HASH,
        RECIPIENT,
        "1000000",
        0x100n + BigInt(EVM_FUNDING_MIN_CONFIRMATIONS.base) - 2n,
      ),
    ).toThrow(/finality policy/u);
  });

  it("rejects wrong amounts, undeclared credits, mints, and reorged logs", () => {
    expect(() =>
      assertConfirmedUsdcFundingTransfer(
        receipt("ethereum"),
        "ethereum",
        HASH,
        RECIPIENT,
        "999999",
        FINALIZED,
      ),
    ).toThrow(/exact amount/u);
    expect(() =>
      assertConfirmedUsdcFundingTransfer(
        receipt("ethereum", {
          logs: [
            transferLog("ethereum", SENDER, RECIPIENT, 1_000_000n),
            transferLog("ethereum", SENDER, OTHER, 1n),
          ],
        }),
        "ethereum",
        HASH,
        RECIPIENT,
        "1000000",
        FINALIZED,
      ),
    ).toThrow(/undeclared credit/u);
    expect(() =>
      assertConfirmedUsdcFundingTransfer(
        receipt("ethereum", {
          logs: [transferLog("ethereum", ZERO, RECIPIENT, 1_000_000n)],
        }),
        "ethereum",
        HASH,
        RECIPIENT,
        "1000000",
        FINALIZED,
      ),
    ).toThrow(/mints or burns/u);
    expect(() =>
      assertConfirmedUsdcFundingTransfer(
        receipt("ethereum", {
          logs: [
            {
              ...transferLog("ethereum", SENDER, RECIPIENT, 1_000_000n),
              removed: true,
            },
          ],
        }),
        "ethereum",
        HASH,
        RECIPIENT,
        "1000000",
        FINALIZED,
      ),
    ).toThrow(/reorged/u);
    expect(() =>
      assertConfirmedUsdcFundingTransfer(
        receipt("ethereum", { logs: [] }),
        "ethereum",
        HASH,
        RECIPIENT,
        "1000000",
        FINALIZED,
      ),
    ).toThrow(/exact amount/u);
  });

  it("rejects malformed expectations before reading the receipt", () => {
    expect(() =>
      assertConfirmedUsdcFundingTransfer(
        receipt("ethereum"),
        "ethereum",
        HASH,
        RECIPIENT.toUpperCase(),
        "1000000",
        FINALIZED,
      ),
    ).toThrow(/expectation is invalid/u);
    expect(() =>
      assertConfirmedUsdcFundingTransfer(
        receipt("ethereum"),
        "ethereum",
        HASH,
        RECIPIENT,
        "1".repeat(41),
        FINALIZED,
      ),
    ).toThrow(/expectation is invalid/u);
    expect(() =>
      assertConfirmedUsdcFundingTransfer(
        receipt("ethereum"),
        "ethereum",
        HASH,
        ZERO,
        "1000000",
        FINALIZED,
      ),
    ).toThrow(/expectation is invalid/u);
  });

  it("produces verifier fields the funding record schema accepts", () => {
    for (const network of ["base", "ethereum"] as const) {
      const routes = assertProjectFundingAddresses([
        {
          network,
          asset: "USDC",
          address: RECIPIENT,
          effectiveAt: "2026-08-01T00:00:00.000Z",
          replacedAt: null,
        },
      ]);
      const verified = assertConfirmedUsdcFundingTransfer(
        receipt(network),
        network,
        HASH,
        RECIPIENT,
        "1000000",
        FINALIZED,
      );
      const host = network === "base" ? "basescan.org" : "etherscan.io";
      expect(
        assertProjectFundingRecord(
          {
            schemaVersion: "1",
            kind: "project-funding",
            recordId: "fund_fixture_01",
            projectId: "eliza",
            manifestRevision: "b".repeat(40),
            network,
            asset: "USDC",
            transactionId: HASH,
            recipient: RECIPIENT,
            amountMinor: "1000000",
            observedAt: "2026-08-02T00:00:00.000Z",
            state: "verified-on-chain",
            donor: { attribution: "anonymous" },
            finality: {
              kind: "confirmations",
              confirmations: verified.confirmations,
            },
            verifier: {
              version: EVM_FUNDING_VERIFIER_VERSIONS[network],
              checkedAt: "2026-08-02T01:00:00.000Z",
              evidenceUrl: `https://${host}/tx/${HASH}`,
              reason: null,
            },
            supersedes: null,
          },
          routes,
        ),
      ).toMatchObject({ state: "verified-on-chain" });
    }
  });
});
